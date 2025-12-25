// Partition shrink operations
//
// This module implements safe partition shrinking with platform-specific implementations.
// Shrinking is more complex than expansion as it requires filesystem checks and data movement.

use crate::partition::types::*;
use anyhow::{anyhow, Result};
use std::process::Command;

#[cfg(target_os = "windows")]
pub async fn shrink_partition(partition: &PartitionInfo, target_size: u64) -> Result<()> {
    shrink_windows(partition, target_size).await
}

#[cfg(target_os = "macos")]
pub async fn shrink_partition(partition: &PartitionInfo, target_size: u64) -> Result<()> {
    shrink_macos(partition, target_size).await
}

#[cfg(target_os = "linux")]
pub async fn shrink_partition(partition: &PartitionInfo, target_size: u64) -> Result<()> {
    shrink_linux(partition, target_size).await
}

/// Windows NTFS shrink implementation
#[cfg(target_os = "windows")]
async fn shrink_windows(partition: &PartitionInfo, target_size: u64) -> Result<()> {
    use std::fs;
    use std::io::Write;

    // Convert bytes to MB for diskpart
    let shrink_amount_mb = (partition.total_size - target_size) / (1024 * 1024);

    // Create diskpart script
    // If partition is mounted (has drive letter), use volume selection
    // If unmounted, we need to use disk and partition number
    let script_content = if let Some(mount_point) = &partition.mount_point {
        // Extract drive letter from mount point (e.g., "C:" -> "C")
        let drive_letter = mount_point.chars().next()
            .ok_or_else(|| anyhow!("Invalid mount point format"))?;
        format!(
            "select volume {}\nShrink desired={}\n",
            drive_letter,
            shrink_amount_mb
        )
    } else {
        // For unmounted partitions, we need disk number and partition number
        // Parse device_path to get these (e.g., "\\.\PHYSICALDRIVE0" and partition number)
        // Note: This is a simplified approach - may need refinement
        return Err(anyhow!(
            "Cannot shrink unmounted partition on Windows. Please mount the partition first or use Disk Management."
        ));
    };

    let script_path = std::env::temp_dir().join("shrink_partition.txt");
    let mut file = fs::File::create(&script_path)?;
    file.write_all(script_content.as_bytes())?;
    drop(file);

    // Execute diskpart
    let output = Command::new("diskpart")
        .arg("/s")
        .arg(&script_path)
        .output()?;

    // Clean up script file
    let _ = fs::remove_file(&script_path);

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!(
            "Diskpart shrink failed.\nStdout: {}\nStderr: {}",
            stdout,
            stderr
        ));
    }

    // Verify the operation
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("successfully") || stdout.contains("completed") {
        Ok(())
    } else {
        Err(anyhow!("Shrink operation may have failed. Output: {}", stdout))
    }
}

/// macOS APFS shrink implementation
#[cfg(target_os = "macos")]
async fn shrink_macos(partition: &PartitionInfo, target_size: u64) -> Result<()> {
    // APFS volumes can be resized online
    // diskutil resizeVolume /dev/diskXsY size
    
    // Convert bytes to human-readable format for diskutil
    let size_str = format_size_for_diskutil(target_size);

    let output = Command::new("diskutil")
        .arg("resizeVolume")
        .arg(&partition.device_path)
        .arg(&size_str)
        .output()?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("diskutil resize failed: {}", error));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("Finished") || stdout.contains("successfully") {
        Ok(())
    } else {
        Err(anyhow!("Resize operation may have failed. Output: {}", stdout))
    }
}

/// Linux ext4 shrink implementation
#[cfg(target_os = "linux")]
async fn shrink_linux(partition: &PartitionInfo, target_size: u64) -> Result<()> {
    // For ext4, we need to:
    // 1. Ensure partition is unmounted
    // 2. Run e2fsck to check filesystem
    // 3. Resize filesystem with resize2fs
    // 4. Update partition table (not implemented yet - requires libparted)

    // Check if mounted
    if partition.is_mounted {
        return Err(anyhow!("Partition must be unmounted before shrinking"));
    }

    // Step 1: Force filesystem check
    let fsck_output = Command::new("e2fsck")
        .arg("-f")
        .arg("-y")
        .arg(&partition.device_path)
        .output()?;

    if !fsck_output.status.success() {
        let error = String::from_utf8_lossy(&fsck_output.stderr);
        return Err(anyhow!("Filesystem check failed: {}", error));
    }

    // Step 2: Resize filesystem
    // Convert bytes to 4K blocks (ext4 default block size)
    let target_blocks = target_size / 4096;
    
    let resize_output = Command::new("resize2fs")
        .arg(&partition.device_path)
        .arg(format!("{}s", target_blocks)) // 's' suffix means 512-byte sectors
        .output()?;

    if !resize_output.status.success() {
        let error = String::from_utf8_lossy(&resize_output.stderr);
        return Err(anyhow!("resize2fs failed: {}", error));
    }

    // Step 3: Update partition table
    // TODO: This requires libparted or parted command
    // For now, we'll just resize the filesystem and leave partition table as-is
    // The partition will show as larger than the filesystem, which is safe

    Ok(())
}

/// Format size for diskutil (e.g., "100G", "500M")
#[cfg(target_os = "macos")]
fn format_size_for_diskutil(bytes: u64) -> String {
    const GB: u64 = 1024 * 1024 * 1024;
    const MB: u64 = 1024 * 1024;

    if bytes >= GB && bytes % GB == 0 {
        format!("{}G", bytes / GB)
    } else if bytes >= MB {
        format!("{}M", bytes / MB)
    } else {
        format!("{}B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn test_format_size_for_diskutil() {
        assert_eq!(format_size_for_diskutil(100 * 1024 * 1024 * 1024), "100G");
        assert_eq!(format_size_for_diskutil(500 * 1024 * 1024), "500M");
        assert_eq!(format_size_for_diskutil(1024), "1024B");
    }
}
