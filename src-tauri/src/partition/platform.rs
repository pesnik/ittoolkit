// Platform-specific implementations for partition operations

#[cfg(target_os = "windows")]
pub mod windows {
    use super::super::types::*;
    use anyhow::{anyhow, Result};
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;
    use wmi::{COMLibrary, Variant, WMIConnection};

    /// Get all disks on Windows using WMI
    pub fn get_disks() -> Result<Vec<DiskInfo>> {
        let com_con = COMLibrary::new()?;
        let wmi_con = WMIConnection::new(com_con)?;

        // Query physical disks
        let disks: Vec<HashMap<String, Variant>> = wmi_con
            .raw_query("SELECT * FROM Win32_DiskDrive")
            .map_err(|e| anyhow!("Failed to query disks: {}", e))?;

        let mut result = Vec::new();

        for (index, disk_data) in disks.iter().enumerate() {
            let device_id = get_string_property(disk_data, "DeviceID")
                .unwrap_or_else(|| format!("\\\\.\\PhysicalDrive{}", index));

            let model = get_string_property(disk_data, "Model")
                .unwrap_or_else(|| "Unknown Disk".to_string());

            let size = get_u64_property(disk_data, "Size").unwrap_or(0);

            let serial = get_string_property(disk_data, "SerialNumber");

            // Get partitions for this disk
            let partitions = get_partitions_for_disk(&wmi_con, &device_id, index as u32)?;

            // Determine partition table type
            let table_type = detect_partition_table_type(&device_id);

            let disk_info = DiskInfo {
                id: format!("disk-{}", index),
                device_path: device_id.clone(),
                model,
                total_size: size,
                table_type,
                partitions: partitions.clone(),
                serial_number: serial,
                status: DiskStatus {
                    is_online: true,
                    has_errors: false,
                    smart_status: None, // TODO: Add SMART status
                },
            };

            // Debug output
            eprintln!("DEBUG: Disk {} ({}) has {} partitions:", index, device_id, partitions.len());
            for part in &partitions {
                eprintln!(
                    "  Partition {}: {} offset={}GB size={}GB",
                    part.number,
                    part.mount_point.as_ref().unwrap_or(&"(no mount)".to_string()),
                    part.start_offset / (1024 * 1024 * 1024),
                    part.total_size / (1024 * 1024 * 1024)
                );
            }

            result.push(disk_info);
        }

        Ok(result)
    }

    /// Get partitions for a specific disk
    fn get_partitions_for_disk(
        wmi_con: &WMIConnection,
        disk_device_id: &str,
        disk_index: u32,
    ) -> Result<Vec<PartitionInfo>> {
        // Query disk partitions
        let query = format!(
            "SELECT * FROM Win32_DiskPartition WHERE DiskIndex = {}",
            disk_index
        );

        let partitions: Vec<HashMap<String, Variant>> = wmi_con
            .raw_query(&query)
            .map_err(|e| anyhow!("Failed to query partitions: {}", e))?;

        let mut result = Vec::new();

        for partition_data in partitions {
            let partition_number = get_u32_property(&partition_data, "Index").unwrap_or(0) + 1;
            let device_id = get_string_property(&partition_data, "DeviceID")
                .unwrap_or_else(|| format!("Partition {}", partition_number));

            let size = get_u64_property(&partition_data, "Size").unwrap_or(0);
            let start_offset = get_u64_property(&partition_data, "StartingOffset").unwrap_or(0);
            let is_boot = get_bool_property(&partition_data, "BootPartition").unwrap_or(false);
            let is_primary = get_bool_property(&partition_data, "PrimaryPartition").unwrap_or(false);

            // Get associated logical disk (drive letter)
            let (drive_letter, filesystem, used_space, label) =
                get_logical_disk_info(wmi_con, &device_id)?;

            let mut flags = Vec::new();
            if is_boot {
                flags.push(PartitionFlag::Boot);
            }

            let partition_type = if is_primary {
                PartitionType::Primary
            } else {
                PartitionType::Logical
            };

            let partition_info = PartitionInfo {
                id: format!("partition-{}-{}", disk_index, partition_number),
                number: partition_number,
                device_path: drive_letter.clone().unwrap_or(device_id),
                label,
                start_offset,
                total_size: size,
                used_space,
                partition_type,
                filesystem: parse_filesystem_type(&filesystem),
                mount_point: drive_letter.clone(),
                is_mounted: drive_letter.is_some(),
                flags,
            };

            result.push(partition_info);
        }

        Ok(result)
    }

    /// Get logical disk information (drive letter, filesystem, etc.)
    fn get_logical_disk_info(
        wmi_con: &WMIConnection,
        partition_device_id: &str,
    ) -> Result<(Option<String>, String, Option<u64>, Option<String>)> {
        // Query the association between partition and logical disk
        let query = format!(
            "ASSOCIATORS OF {{Win32_DiskPartition.DeviceID='{}'}} WHERE AssocClass = Win32_LogicalDiskToPartition",
            partition_device_id.replace("\\", "\\\\")
        );

        let logical_disks: Vec<HashMap<String, Variant>> = wmi_con
            .raw_query(&query)
            .unwrap_or_default();

        if let Some(logical_disk) = logical_disks.first() {
            let drive_letter = get_string_property(logical_disk, "DeviceID");
            let filesystem = get_string_property(logical_disk, "FileSystem")
                .unwrap_or_else(|| "Unknown".to_string());
            let size = get_u64_property(logical_disk, "Size");
            let free_space = get_u64_property(logical_disk, "FreeSpace");
            let volume_name = get_string_property(logical_disk, "VolumeName");

            let used_space = if let (Some(total), Some(free)) = (size, free_space) {
                Some(total - free)
            } else {
                None
            };

            Ok((drive_letter, filesystem, used_space, volume_name))
        } else {
            Ok((None, "Unknown".to_string(), None, None))
        }
    }

    /// Detect partition table type (MBR or GPT)
    fn detect_partition_table_type(device_path: &str) -> PartitionTableType {
        // Try to read the first sector to detect partition table type
        // For now, use WMI query
        let com_con = match COMLibrary::new() {
            Ok(c) => c,
            Err(_) => return PartitionTableType::Unknown,
        };

        let wmi_con = match WMIConnection::new(com_con) {
            Ok(w) => w,
            Err(_) => return PartitionTableType::Unknown,
        };

        // Extract disk index from device path
        let disk_index: u32 = device_path
            .trim_start_matches("\\\\.\\PhysicalDrive")
            .parse()
            .unwrap_or(0);

        let query = format!(
            "SELECT * FROM Win32_DiskPartition WHERE DiskIndex = {}",
            disk_index
        );

        let partitions: Vec<HashMap<String, Variant>> = wmi_con
            .raw_query(&query)
            .unwrap_or_default();

        // If we have partitions, check the type
        if let Some(partition) = partitions.first() {
            let partition_type = get_string_property(partition, "Type")
                .unwrap_or_default();

            if partition_type.contains("GPT") {
                PartitionTableType::GPT
            } else if partition_type.contains("MBR") || partition_type.contains("Installable File System") {
                PartitionTableType::MBR
            } else {
                PartitionTableType::Unknown
            }
        } else {
            PartitionTableType::Unknown
        }
    }

    /// Parse filesystem type string to enum
    fn parse_filesystem_type(fs_str: &str) -> FilesystemType {
        match fs_str.to_uppercase().as_str() {
            "NTFS" => FilesystemType::NTFS,
            "FAT32" => FilesystemType::FAT32,
            "EXFAT" => FilesystemType::ExFAT,
            "FAT" => FilesystemType::FAT32,
            "RAW" => FilesystemType::RAW,
            "" => FilesystemType::Unknown,
            _ => FilesystemType::Unknown,
        }
    }

    // Helper functions to extract WMI properties

    fn get_string_property(data: &HashMap<String, Variant>, key: &str) -> Option<String> {
        data.get(key).and_then(|v| match v {
            Variant::String(s) => Some(s.clone()),
            _ => None,
        })
    }

    fn get_u64_property(data: &HashMap<String, Variant>, key: &str) -> Option<u64> {
        data.get(key).and_then(|v| match v {
            Variant::UI8(n) => Some(*n as u64),
            Variant::I4(n) => Some(*n as u64),
            Variant::UI4(n) => Some(*n as u64),
            Variant::String(s) => s.parse().ok(),
            _ => None,
        })
    }

    fn get_u32_property(data: &HashMap<String, Variant>, key: &str) -> Option<u32> {
        data.get(key).and_then(|v| match v {
            Variant::UI8(n) => Some(*n as u32),
            Variant::I4(n) => Some(*n as u32),
            Variant::UI4(n) => Some(*n),
            Variant::String(s) => s.parse().ok(),
            _ => None,
        })
    }

    fn get_bool_property(data: &HashMap<String, Variant>, key: &str) -> Option<bool> {
        data.get(key).and_then(|v| match v {
            Variant::Bool(b) => Some(*b),
            _ => None,
        })
    }
}

#[cfg(target_os = "linux")]
pub mod linux {
    use super::super::types::*;
    use anyhow::{anyhow, Result};
    use std::process::Command;

    pub fn get_disks() -> Result<Vec<DiskInfo>> {
        let mut result = Vec::new();

        // Use lsblk to get block devices in JSON format
        let output = Command::new("lsblk")
            .args(&["-b", "-J", "-o", "NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,LABEL,PTTYPE,MODEL"])
            .output()?;

        if !output.status.success() {
            return Err(anyhow!("Failed to execute lsblk"));
        }

        let json_str = String::from_utf8_lossy(&output.stdout);

        // Parse JSON output
        // lsblk JSON format: {"blockdevices": [{"name": "sda", "size": 123, ...}, ...]}
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_str) {
            if let Some(blockdevices) = parsed["blockdevices"].as_array() {
                for device in blockdevices {
                    // Only process disk devices (not partitions, loops, etc.)
                    if let Some(dev_type) = device["type"].as_str() {
                        if dev_type == "disk" {
                            if let Ok(disk_info) = parse_disk_info(device) {
                                result.push(disk_info);
                            }
                        }
                    }
                }
            }
        }

        Ok(result)
    }

    fn parse_disk_info(device: &serde_json::Value) -> Result<DiskInfo> {
        let name = device["name"].as_str().unwrap_or("unknown").to_string();
        let device_path = format!("/dev/{}", name);
        let model = device["model"].as_str().unwrap_or("Unknown Disk").trim().to_string();
        let total_size = device["size"].as_u64().unwrap_or(0);

        let table_type = match device["pttype"].as_str() {
            Some("gpt") => PartitionTableType::GPT,
            Some("dos") | Some("mbr") => PartitionTableType::MBR,
            _ => PartitionTableType::Unknown,
        };

        // Get partitions for this disk
        let mut partitions = Vec::new();
        if let Some(children) = device["children"].as_array() {
            for (index, child) in children.iter().enumerate() {
                if let Ok(partition) = parse_partition_info(child, index as u32 + 1) {
                    partitions.push(partition);
                }
            }
        }

        Ok(DiskInfo {
            id: name.clone(),
            device_path,
            model,
            total_size,
            table_type,
            partitions,
            serial_number: None,
            status: DiskStatus {
                is_online: true,
                has_errors: false,
                smart_status: None,
            },
        })
    }

    fn parse_partition_info(partition: &serde_json::Value, number: u32) -> Result<PartitionInfo> {
        let name = partition["name"].as_str().unwrap_or("unknown").to_string();
        let device_path = format!("/dev/{}", name);
        let total_size = partition["size"].as_u64().unwrap_or(0);
        let label = partition["label"].as_str().map(|s| s.to_string());
        let mount_point = partition["mountpoint"].as_str().map(|s| s.to_string());
        let is_mounted = mount_point.is_some();

        let filesystem = match partition["fstype"].as_str() {
            Some("ext2") => FilesystemType::Ext2,
            Some("ext3") => FilesystemType::Ext3,
            Some("ext4") => FilesystemType::Ext4,
            Some("ntfs") => FilesystemType::NTFS,
            Some("vfat") => FilesystemType::FAT32,
            Some("exfat") => FilesystemType::ExFAT,
            Some("apfs") => FilesystemType::APFS,
            Some("hfsplus") | Some("hfs+") => FilesystemType::HFSPlus,
            None | Some("") => FilesystemType::Unknown,
            _ => FilesystemType::Unknown,
        };

        // Get used space if mounted
        let used_space = if let Some(ref mp) = mount_point {
            get_used_space(mp).ok()
        } else {
            None
        };

        Ok(PartitionInfo {
            id: name.clone(),
            number,
            device_path,
            label,
            start_offset: 0, // lsblk doesn't easily provide this in JSON
            total_size,
            used_space,
            partition_type: PartitionType::Normal,
            filesystem,
            mount_point,
            is_mounted,
            flags: vec![],
        })
    }

    fn get_used_space(mount_point: &str) -> Result<u64> {
        let output = Command::new("df")
            .args(&["-B1", mount_point])
            .output()?;

        if !output.status.success() {
            return Err(anyhow!("Failed to get disk usage"));
        }

        let output_str = String::from_utf8_lossy(&output.stdout);

        // Parse df output (skip header, get second line)
        if let Some(line) = output_str.lines().nth(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                // df output: Filesystem 1B-blocks Used Available Use% Mounted
                // We want the "Used" column (index 2)
                if let Ok(used) = parts[2].parse::<u64>() {
                    return Ok(used);
                }
            }
        }

        Err(anyhow!("Failed to parse df output"))
    }
}

#[cfg(target_os = "macos")]
pub mod macos {
    use super::super::types::*;
    use anyhow::{anyhow, Result};
    use std::process::Command;

    pub fn get_disks() -> Result<Vec<DiskInfo>> {
        let mut result = Vec::new();

        // Get list of all disks using diskutil
        let output = Command::new("diskutil")
            .arg("list")
            .arg("-plist")
            .output()?;

        if !output.status.success() {
            return Err(anyhow!("Failed to execute diskutil list"));
        }

        let plist_str = String::from_utf8_lossy(&output.stdout);

        // Parse disk identifiers from output
        // diskutil list returns something like: /dev/disk0, /dev/disk1, etc.
        let disk_output = Command::new("diskutil")
            .arg("list")
            .output()?;

        let disk_list = String::from_utf8_lossy(&disk_output.stdout);

        // Extract disk identifiers (disk0, disk1, etc.)
        // diskutil list output format:
        // /dev/disk0 (internal, physical):
        // /dev/disk3 (synthesized):
        let mut disk_ids = Vec::new();
        for line in disk_list.lines() {
            // Look for lines starting with /dev/disk that represent disks
            // Include physical (internal/external) and synthesized (APFS containers)
            if line.starts_with("/dev/disk") && line.contains("):") {
                // Extract disk identifier (e.g., "disk0" from "/dev/disk0 (internal, physical):")
                if let Some(disk_part) = line.split_whitespace().next() {
                    if let Some(disk_id) = disk_part.strip_prefix("/dev/") {
                        // Only add if it doesn't contain 's' after the 'disk' prefix (not a partition like disk0s1)
                        // disk0 -> ok
                        // disk0s1 -> skip
                        if let Some(rest) = disk_id.strip_prefix("disk") {
                            if !rest.contains('s') {
                                disk_ids.push(disk_id.to_string());
                            }
                        }
                    }
                }
            }
        }

        // Get detailed info for each disk
        for disk_id in disk_ids {
            if let Ok(disk_info) = get_disk_info(&disk_id) {
                result.push(disk_info);
            }
        }

        Ok(result)
    }

    fn get_disk_info(disk_id: &str) -> Result<DiskInfo> {
        // Get disk information using diskutil info
        let output = Command::new("diskutil")
            .arg("info")
            .arg(disk_id)
            .output()?;

        if !output.status.success() {
            return Err(anyhow!("Failed to get disk info for {}", disk_id));
        }

        let info_str = String::from_utf8_lossy(&output.stdout);

        // Parse disk information
        let mut model = String::from("Unknown Disk");
        let mut total_size: u64 = 0;
        let mut table_type = PartitionTableType::Unknown;

        for line in info_str.lines() {
            let line = line.trim();

            if line.starts_with("Device / Media Name:") {
                model = line.split(':').nth(1).unwrap_or("Unknown").trim().to_string();
            } else if line.starts_with("Disk Size:") {
                // Parse size (e.g., "500.1 GB (500107862016 Bytes)")
                if let Some(bytes_str) = line.split('(').nth(1) {
                    if let Some(bytes) = bytes_str.split_whitespace().next() {
                        total_size = bytes.parse().unwrap_or(0);
                    }
                }
            } else if line.starts_with("Content (IOContent):") {
                let content = line.split(':').nth(1).unwrap_or("").trim();
                table_type = match content {
                    s if s.contains("GUID_partition_scheme") => PartitionTableType::GPT,
                    s if s.contains("FDisk_partition_scheme") => PartitionTableType::MBR,
                    _ => PartitionTableType::Unknown,
                };
            }
        }

        // Get partitions for this disk
        let partitions = get_partitions_for_disk(disk_id)?;

        Ok(DiskInfo {
            id: disk_id.to_string(),
            device_path: format!("/dev/{}", disk_id),
            model,
            total_size,
            table_type,
            partitions,
            serial_number: None,
            status: DiskStatus {
                is_online: true,
                has_errors: false,
                smart_status: None,
            },
        })
    }

    fn get_partitions_for_disk(disk_id: &str) -> Result<Vec<PartitionInfo>> {
        let mut result = Vec::new();

        // List all volumes/partitions on this disk
        let output = Command::new("diskutil")
            .arg("list")
            .arg(disk_id)
            .output()?;

        if !output.status.success() {
            return Ok(result);
        }

        let list_str = String::from_utf8_lossy(&output.stdout);

        // Parse partition identifiers (e.g., disk0s1, disk0s2)
        let mut partition_ids = Vec::new();
        for line in list_str.lines() {
            // Look for lines with partition identifiers
            if let Some(part_id) = line.split_whitespace()
                .find(|s| s.starts_with(disk_id) && s.contains("s")) {
                partition_ids.push(part_id.to_string());
            }
        }

        // Get detailed info for each partition
        for (index, partition_id) in partition_ids.iter().enumerate() {
            if let Ok(partition_info) = get_partition_info(partition_id, index as u32 + 1) {
                result.push(partition_info);
            }
        }

        Ok(result)
    }

    fn get_partition_info(partition_id: &str, number: u32) -> Result<PartitionInfo> {
        let output = Command::new("diskutil")
            .arg("info")
            .arg(partition_id)
            .output()?;

        if !output.status.success() {
            return Err(anyhow!("Failed to get partition info for {}", partition_id));
        }

        let info_str = String::from_utf8_lossy(&output.stdout);

        let mut label: Option<String> = None;
        let mut total_size: u64 = 0;
        let mut used_space: Option<u64> = None;
        let mut filesystem = FilesystemType::Unknown;
        let mut mount_point: Option<String> = None;
        let mut is_mounted = false;

        for line in info_str.lines() {
            let line = line.trim();

            if line.starts_with("Volume Name:") {
                label = Some(line.split(':').nth(1).unwrap_or("").trim().to_string());
            } else if line.starts_with("Disk Size:") || line.starts_with("Volume Total Space:") {
                if let Some(bytes_str) = line.split('(').nth(1) {
                    if let Some(bytes) = bytes_str.split_whitespace().next() {
                        total_size = bytes.parse().unwrap_or(0);
                    }
                }
            } else if line.starts_with("Volume Used Space:") {
                if let Some(bytes_str) = line.split('(').nth(1) {
                    if let Some(bytes) = bytes_str.split_whitespace().next() {
                        used_space = Some(bytes.parse().unwrap_or(0));
                    }
                }
            } else if line.starts_with("Type (Bundle):") || line.starts_with("File System Personality:") {
                let fs_type = line.split(':').nth(1).unwrap_or("").trim();
                filesystem = match fs_type {
                    s if s.contains("APFS") => FilesystemType::APFS,
                    s if s.contains("HFS") => FilesystemType::HFSPlus,
                    s if s.contains("FAT32") || s.contains("MS-DOS FAT32") => FilesystemType::FAT32,
                    s if s.contains("ExFAT") => FilesystemType::ExFAT,
                    _ => FilesystemType::Unknown,
                };
            } else if line.starts_with("Mount Point:") {
                let mp = line.split(':').nth(1).unwrap_or("").trim();
                if !mp.is_empty() && mp != "Not Mounted" {
                    mount_point = Some(mp.to_string());
                    is_mounted = true;
                }
            } else if line.starts_with("Mounted:") {
                is_mounted = line.contains("Yes");
            }
        }

        Ok(PartitionInfo {
            id: partition_id.to_string(),
            number,
            device_path: format!("/dev/{}", partition_id),
            label,
            start_offset: 0, // diskutil doesn't easily provide this
            total_size,
            used_space,
            partition_type: PartitionType::Normal,
            filesystem,
            mount_point,
            is_mounted,
            flags: vec![],
        })
    }
}
