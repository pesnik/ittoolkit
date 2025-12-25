// Partition expansion functionality

use crate::partition::types::*;
use anyhow::{anyhow, Result};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Expand a partition to the specified size
pub async fn expand_partition(
    partition: &PartitionInfo,
    target_size: u64,
) -> Result<()> {
    // Step 1: Expand the partition table entry
    expand_partition_table(partition, target_size).await?;

    // Step 2: Expand the filesystem
    expand_filesystem(partition, target_size).await?;

    Ok(())
}

/// Expand the partition table entry
async fn expand_partition_table(
    partition: &PartitionInfo,
    target_size: u64,
) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        expand_partition_table_windows(partition, target_size).await
    }

    #[cfg(target_os = "linux")]
    {
        expand_partition_table_linux(partition, target_size).await
    }

    #[cfg(target_os = "macos")]
    {
        // macOS uses diskutil resizeVolume which handles both partition and filesystem
        // So we don't need separate partition table expansion
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        Err(anyhow!("Partition table expansion not yet implemented for this platform"))
    }
}

/// Expand partition table on Windows using diskpart
#[cfg(target_os = "windows")]
async fn expand_partition_table_windows(
    partition: &PartitionInfo,
    target_size: u64,
) -> Result<()> {
    // Extract drive letter
    let drive_letter = partition.mount_point.as_ref()
        .and_then(|m| m.chars().next())
        .ok_or_else(|| anyhow!("No drive letter found for partition"))?;

    // Calculate size increase in MB (diskpart extend uses size increase, not absolute size)
    let current_size = partition.total_size;
    let size_increase_mb = (target_size.saturating_sub(current_size)) / (1024 * 1024);

    if size_increase_mb == 0 {
        return Err(anyhow!("Target size must be larger than current size"));
    }

    // Create diskpart script
    let script = format!(
        "select volume {}\nextend size={}\n",
        drive_letter,
        size_increase_mb
    );

    // Write script to temp file
    let script_path = std::env::temp_dir().join("diskpart_expand.txt");
    std::fs::write(&script_path, &script)?;

    // Execute diskpart
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let output = Command::new("diskpart")
        .arg("/s")
        .arg(&script_path)
        .creation_flags(CREATE_NO_WINDOW)
        .output()?;

    // Clean up temp file
    let _ = std::fs::remove_file(&script_path);

    // Capture both stdout and stderr for better error reporting
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() || stdout.contains("failed") || stdout.contains("error") {
        let error_msg = if !stderr.is_empty() {
            stderr.to_string()
        } else if !stdout.is_empty() {
            stdout.to_string()
        } else {
            "Unknown diskpart error".to_string()
        };

        return Err(anyhow!(
            "Diskpart failed: {}\n\nScript used:\n{}\n\nFull output:\n{}",
            error_msg.trim(),
            script,
            stdout
        ));
    }

    Ok(())
}

/// Expand partition table on Linux using parted
#[cfg(target_os = "linux")]
async fn expand_partition_table_linux(
    partition: &PartitionInfo,
    target_size: u64,
) -> Result<()> {
    let device = &partition.device_path;
    let size_mb = target_size / (1024 * 1024);

    // Use parted to resize the partition
    // Format: parted /dev/sda resizepart 1 100%
    // or: parted /dev/sda resizepart 1 500MB

    // Extract partition number from device path (e.g., /dev/sda1 -> 1)
    let part_num = device
        .chars()
        .rev()
        .take_while(|c| c.is_numeric())
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();

    // Extract base device (e.g., /dev/sda1 -> /dev/sda)
    let base_device = device.trim_end_matches(&part_num);

    let output = Command::new("parted")
        .arg(base_device)
        .arg("resizepart")
        .arg(&part_num)
        .arg(format!("{}MB", size_mb))
        .output()?;

    if !output.status.success() {
        return Err(anyhow!(
            "parted failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

/// Expand the filesystem to fill the partition
async fn expand_filesystem(
    partition: &PartitionInfo,
    target_size: u64,
) -> Result<()> {
    match partition.filesystem {
        FilesystemType::NTFS => expand_ntfs(partition, target_size).await,
        FilesystemType::Ext2 | FilesystemType::Ext3 | FilesystemType::Ext4 => {
            expand_ext4(partition, target_size).await
        }
        FilesystemType::APFS | FilesystemType::HFSPlus => {
            expand_apfs_hfs(partition, target_size).await
        }
        _ => Err(anyhow!(
            "Filesystem expansion not supported for {}",
            partition.filesystem.display_name()
        )),
    }
}

/// Expand NTFS filesystem
async fn expand_ntfs(
    partition: &PartitionInfo,
    _target_size: u64,
) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        // On Windows, NTFS expansion happens automatically with diskpart extend
        // No additional action needed
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On Linux/macOS, use ntfsresize
        let device = &partition.device_path;

        let output = Command::new("ntfsresize")
            .arg("--force")
            .arg("--no-action")  // Dry run first
            .arg(device)
            .output()?;

        if !output.status.success() {
            return Err(anyhow!(
                "NTFS dry-run failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        // Actual resize
        let output = Command::new("ntfsresize")
            .arg("--force")
            .arg(device)
            .output()?;

        if !output.status.success() {
            return Err(anyhow!(
                "NTFS resize failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(())
    }
}

/// Expand ext4 filesystem
async fn expand_ext4(
    partition: &PartitionInfo,
    _target_size: u64,
) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        let device = &partition.device_path;

        // resize2fs can expand online (while mounted) or offline
        let output = Command::new("resize2fs")
            .arg(device)
            .output()?;

        if !output.status.success() {
            return Err(anyhow!(
                "resize2fs failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    {
        Err(anyhow!("ext4 resize is only supported on Linux"))
    }
}

/// Expand APFS or HFS+ filesystem (macOS)
async fn expand_apfs_hfs(
    partition: &PartitionInfo,
    target_size: u64,
) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let device = &partition.device_path;

        // Convert target size to sectors or use "R" for maximum available
        // diskutil resizeVolume can take size in various formats
        // For expansion, we'll use the target size in bytes followed by "B"
        let size_arg = format!("{}B", target_size);

        // Use diskutil to resize the volume
        let output = Command::new("diskutil")
            .arg("resizeVolume")
            .arg(device)
            .arg(&size_arg)
            .output()?;

        if !output.status.success() {
            return Err(anyhow!(
                "diskutil resizeVolume failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(anyhow!("APFS/HFS+ resize is only supported on macOS"))
    }
}
