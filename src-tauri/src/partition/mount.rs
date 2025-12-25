// Partition mount/unmount operations
//
// This module handles mounting and unmounting partitions safely

use crate::partition::types::*;
use anyhow::{anyhow, Result};
use std::process::Command;

/// Unmount a partition (platform-specific)
#[cfg(target_os = "windows")]
pub fn unmount_partition(partition: &PartitionInfo) -> Result<()> {
    unmount_windows(partition)
}

#[cfg(target_os = "macos")]
pub fn unmount_partition(partition: &PartitionInfo) -> Result<()> {
    unmount_macos(partition)
}

#[cfg(target_os = "linux")]
pub fn unmount_partition(partition: &PartitionInfo) -> Result<()> {
    unmount_linux(partition)
}

/// Mount a partition (platform-specific)
#[cfg(target_os = "windows")]
pub fn mount_partition(partition: &PartitionInfo) -> Result<()> {
    mount_windows(partition)
}

#[cfg(target_os = "macos")]
pub fn mount_partition(partition: &PartitionInfo) -> Result<()> {
    mount_macos(partition)
}

#[cfg(target_os = "linux")]
pub fn mount_partition(partition: &PartitionInfo) -> Result<()> {
    mount_linux(partition)
}

// Windows implementations
#[cfg(target_os = "windows")]
fn unmount_windows(partition: &PartitionInfo) -> Result<()> {
    use std::fs;
    use std::io::Write;

    let drive_letter = partition
        .mount_point
        .as_ref()
        .and_then(|mp| mp.chars().next())
        .ok_or_else(|| anyhow!("No drive letter found for partition"))?;

    // Create diskpart script to remove drive letter (unmount)
    let script_content = format!(
        "select volume {}\nremove letter={}\n",
        drive_letter, drive_letter
    );

    let script_path = std::env::temp_dir().join("unmount_partition.txt");
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
            "Diskpart unmount failed.\nStdout: {}\nStderr: {}",
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("successfully") || stdout.contains("removed") {
        Ok(())
    } else {
        Err(anyhow!("Unmount may have failed. Output: {}", stdout))
    }
}

#[cfg(target_os = "windows")]
fn mount_windows(partition: &PartitionInfo) -> Result<()> {
    use std::fs;
    use std::io::Write;

    // For mounting, we need to assign a drive letter
    // This is more complex as we need to find an available letter
    // For now, just return an error suggesting manual mount
    Err(anyhow!(
        "Automatic mounting not yet implemented on Windows. Please use Disk Management to assign a drive letter."
    ))
}

// macOS implementations
#[cfg(target_os = "macos")]
fn unmount_macos(partition: &PartitionInfo) -> Result<()> {
    let output = Command::new("diskutil")
        .arg("unmount")
        .arg(&partition.device_path)
        .output()?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("diskutil unmount failed: {}", error));
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn mount_macos(partition: &PartitionInfo) -> Result<()> {
    let output = Command::new("diskutil")
        .arg("mount")
        .arg(&partition.device_path)
        .output()?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("diskutil mount failed: {}", error));
    }

    Ok(())
}

// Linux implementations
#[cfg(target_os = "linux")]
fn unmount_linux(partition: &PartitionInfo) -> Result<()> {
    let mount_point = partition
        .mount_point
        .as_ref()
        .ok_or_else(|| anyhow!("Partition is not mounted"))?;

    let output = Command::new("umount").arg(mount_point).output()?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("umount failed: {}", error));
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn mount_linux(partition: &PartitionInfo) -> Result<()> {
    // For Linux, we'd need a mount point
    // This is complex and should probably be done manually
    Err(anyhow!(
        "Automatic mounting not yet implemented on Linux. Please use mount command manually."
    ))
}
