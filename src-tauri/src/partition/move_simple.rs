// Simplified partition moving using backup/delete/recreate approach
// This is safer and more reliable than low-level sector manipulation

use crate::partition::types::*;
use crate::partition::delete::delete_partition;
use anyhow::{anyhow, Result};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MoveOperation {
    pub partition_id: String,
    pub from_offset: u64,
    pub to_offset: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MoveExecutionPlan {
    pub operations: Vec<MoveOperation>,
    pub estimated_duration_minutes: u32,
    pub requires_backup: bool,
    pub affected_partitions: Vec<String>,
}

/// Validate a partition move operation
pub fn validate_move_operation(
    partition: &PartitionInfo,
    new_offset: u64,
    disk_size: u64,
) -> Result<Vec<String>> {
    let mut warnings = Vec::new();

    // Check if partition can be moved
    if partition.flags.contains(&PartitionFlag::Boot) {
        return Err(anyhow!(
            "Cannot move boot partition - this would make the system unbootable!"
        ));
    }

    if partition.flags.contains(&PartitionFlag::System) {
        return Err(anyhow!(
            "Cannot move system/EFI partition - this would make the system unbootable!"
        ));
    }

    // Check if new location is within disk bounds
    if new_offset + partition.total_size > disk_size {
        return Err(anyhow!(
            "New location would exceed disk size. Cannot move partition."
        ));
    }

    // Check if partition has data
    if let Some(used_space) = partition.used_space {
        if used_space > 0 {
            let gb = used_space as f64 / (1024.0 * 1024.0 * 1024.0);
            warnings.push(format!(
                "⚠️ This partition contains {:.2} GB of data. Backup is REQUIRED before moving!",
                gb
            ));
        }
    }

    // Warn about mount status
    if partition.is_mounted {
        warnings.push(
            "⚠️ Partition is currently mounted and will need to be unmounted during the move.".to_string()
        );
    }

    Ok(warnings)
}

/// Create a backup of partition data using robocopy (Windows) or rsync (Linux/macOS)
#[cfg(target_os = "windows")]
pub fn backup_partition_data(partition: &PartitionInfo, backup_path: &PathBuf) -> Result<()> {
    let source = partition
        .mount_point
        .as_ref()
        .ok_or_else(|| anyhow!("Partition must be mounted to backup"))?;

    // Create backup directory if it doesn't exist
    std::fs::create_dir_all(backup_path)?;

    // Use robocopy for efficient file copying on Windows
    let output = Command::new("robocopy")
        .arg(source)
        .arg(backup_path)
        .arg("/E") // Copy subdirectories, including empty ones
        .arg("/COPYALL") // Copy all file information
        .arg("/R:3") // Retry 3 times on failed copies
        .arg("/W:5") // Wait 5 seconds between retries
        .arg("/MT:8") // Multi-threaded with 8 threads
        .arg("/NP") // No progress display
        .output()?;

    // Robocopy returns exit codes 0-7 for success (various levels)
    let exit_code = output.status.code().unwrap_or(-1);
    if exit_code < 0 || exit_code > 7 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Backup failed: {}", stderr));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn backup_partition_data(partition: &PartitionInfo, backup_path: &PathBuf) -> Result<()> {
    let source = partition
        .mount_point
        .as_ref()
        .ok_or_else(|| anyhow!("Partition must be mounted to backup"))?;

    // Create backup directory
    std::fs::create_dir_all(backup_path)?;

    // Use rsync for efficient copying
    let output = Command::new("rsync")
        .arg("-av") // Archive mode, verbose
        .arg("--progress")
        .arg(format!("{}/", source)) // Trailing slash = copy contents
        .arg(backup_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Backup failed: {}", stderr));
    }

    Ok(())
}

/// Restore partition data from backup
#[cfg(target_os = "windows")]
pub fn restore_partition_data(backup_path: &PathBuf, partition: &PartitionInfo) -> Result<()> {
    let dest = partition
        .mount_point
        .as_ref()
        .ok_or_else(|| anyhow!("Partition must be mounted to restore"))?;

    let output = Command::new("robocopy")
        .arg(backup_path)
        .arg(dest)
        .arg("/E")
        .arg("/COPYALL")
        .arg("/R:3")
        .arg("/W:5")
        .arg("/MT:8")
        .arg("/NP")
        .output()?;

    let exit_code = output.status.code().unwrap_or(-1);
    if exit_code < 0 || exit_code > 7 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Restore failed: {}", stderr));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn restore_partition_data(backup_path: &PathBuf, partition: &PartitionInfo) -> Result<()> {
    let dest = partition
        .mount_point
        .as_ref()
        .ok_or_else(|| anyhow!("Partition must be mounted to restore"))?;

    let output = Command::new("rsync")
        .arg("-av")
        .arg("--progress")
        .arg(format!("{}/", backup_path.display()))
        .arg(dest)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Restore failed: {}", stderr));
    }

    Ok(())
}

/// Simple partition move: backup -> delete -> recreate -> restore
/// This is safer than low-level sector manipulation
pub async fn execute_simple_move(
    partition: &PartitionInfo,
    new_offset: u64,
    disk_size: u64,
) -> Result<()> {
    // Validate the move
    let warnings = validate_move_operation(partition, new_offset, disk_size)?;

    if !warnings.is_empty() {
        eprintln!("Move warnings: {:?}", warnings);
    }

    // For now, this is a stub that requires manual intervention
    // Full implementation would require:
    // 1. Create temporary backup location
    // 2. Backup partition data
    // 3. Delete old partition
    // 4. Create new partition at new offset
    // 5. Format new partition
    // 6. Restore data
    // 7. Clean up backup

    Err(anyhow!(
        "Partition moving requires manual backup and restore. \
         Please use this feature as a planning tool, then:\n\
         1. Backup your data manually\n\
         2. Use Windows Disk Management or other tools to move the partition\n\
         3. Restore your data if needed"
    ))
}
