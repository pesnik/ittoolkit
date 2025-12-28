// Tauri commands for partition management

use crate::partition::{self, DiskInfo, PartitionInfo, ValidationResult, ResizeProgress, ReallocationPlan};
use tauri::{command, AppHandle, Emitter};

/// Get all disks available on the system
#[command]
pub async fn get_disks() -> Result<Vec<DiskInfo>, String> {
    partition::get_all_disks().map_err(|e| e.to_string())
}

/// Get all partitions for a specific disk
#[command]
pub async fn get_partitions(disk_path: String) -> Result<Vec<PartitionInfo>, String> {
    partition::get_partitions(&disk_path).map_err(|e| e.to_string())
}

/// Get detailed information about a specific partition
#[command]
pub async fn get_partition_info(partition_id: String) -> Result<PartitionInfo, String> {
    partition::get_partition_info(&partition_id).map_err(|e| e.to_string())
}

/// Validate a partition expand request
#[command]
pub async fn validate_expand_partition(
    partition_id: String,
    target_size: u64,
) -> Result<ValidationResult, String> {
    let partition = partition::get_partition_info(&partition_id)
        .map_err(|e| e.to_string())?;

    // Find the disk containing this partition
    let disks = partition::get_all_disks().map_err(|e| e.to_string())?;
    let disk = disks
        .iter()
        .find(|d| d.partitions.iter().any(|p| p.id == partition_id))
        .ok_or_else(|| "Disk not found for partition".to_string())?;

    partition::validation::validate_expand(&partition, disk, target_size)
        .map_err(|e| e.to_string())
}

/// Validate a partition shrink request
#[command]
pub async fn validate_shrink_partition(
    partition_id: String,
    target_size: u64,
) -> Result<ValidationResult, String> {
    let partition = partition::get_partition_info(&partition_id)
        .map_err(|e| e.to_string())?;

    partition::validation::validate_shrink(&partition, target_size)
        .map_err(|e| e.to_string())
}

/// Expand a partition to the specified size
#[command]
pub async fn expand_partition(
    app: AppHandle,
    partition_id: String,
    target_size: u64,
) -> Result<(), String> {
    // Emit progress: Validating
    let _ = app.emit("resize-progress", ResizeProgress::validating("Starting validation..."));

    // Get partition info
    let partition = partition::get_partition_info(&partition_id)
        .map_err(|e| e.to_string())?;

    // Emit progress: Expanding
    let _ = app.emit("resize-progress", ResizeProgress::expanding_filesystem(
        0.0,
        format!("Expanding partition {} to {}...", partition.device_path, format_size(target_size))
    ));

    // Perform expansion
    partition::expand::expand_partition(&partition, target_size)
        .await
        .map_err(|e| e.to_string())?;

    // Emit progress: Complete
    let _ = app.emit("resize-progress", ResizeProgress::complete("Partition expanded successfully!"));

    Ok(())
}

/// Shrink a partition to the specified size
#[command]
pub async fn shrink_partition(
    app: AppHandle,
    partition_id: String,
    target_size: u64,
) -> Result<(), String> {
    // Emit progress: Validating
    let _ = app.emit("resize-progress", ResizeProgress::validating("Starting validation..."));

    // Get partition info
    let partition = partition::get_partition_info(&partition_id)
        .map_err(|e| e.to_string())?;

    // Emit progress: Checking filesystem
    let _ = app.emit("resize-progress", ResizeProgress::checking_filesystem(
        "Checking filesystem integrity..."
    ));

    // Emit progress: Shrinking
    let _ = app.emit("resize-progress", ResizeProgress::resizing_filesystem(
        0.0,
        format!("Shrinking partition {} to {}...", partition.device_path, format_size(target_size))
    ));

    // Perform shrink
    partition::shrink::shrink_partition(&partition, target_size)
        .await
        .map_err(|e| e.to_string())?;

    // Emit progress: Complete
    let _ = app.emit("resize-progress", ResizeProgress::complete("Partition shrunk successfully!"));

    Ok(())
}

/// Create a space reallocation plan
/// This analyzes how to give more space to a partition by shrinking/deleting others
#[command]
pub async fn create_space_reallocation_plan(
    target_partition_id: String,
    desired_additional_space: u64,
) -> Result<ReallocationPlan, String> {
    // Get all disks
    let disks = partition::get_all_disks().map_err(|e| e.to_string())?;

    // Find the disk containing the target partition
    let disk = disks
        .iter()
        .find(|d| d.partitions.iter().any(|p| p.id == target_partition_id))
        .ok_or_else(|| "Disk not found for partition".to_string())?;

    // Create reallocation plan
    partition::reallocation_wizard::create_reallocation_plan(
        disk,
        &target_partition_id,
        desired_additional_space,
    )
    .map_err(|e| e.to_string())
}

/// Unmount a partition
#[command]
pub async fn unmount_partition(partition_id: String) -> Result<(), String> {
    let partition = partition::get_partition_info(&partition_id)
        .map_err(|e| e.to_string())?;

    partition::unmount_partition(&partition)
        .map_err(|e| e.to_string())
}

/// Mount a partition
#[command]
pub async fn mount_partition(partition_id: String) -> Result<(), String> {
    let partition = partition::get_partition_info(&partition_id)
        .map_err(|e| e.to_string())?;

    partition::mount_partition(&partition)
        .map_err(|e| e.to_string())
}

/// Validate that a partition can be safely deleted
#[command]
pub async fn validate_delete_partition(partition_id: String) -> Result<Vec<String>, String> {
    let partition = partition::get_partition_info(&partition_id)
        .map_err(|e| e.to_string())?;

    partition::validate_delete(&partition)
        .map_err(|e| e.to_string())
}

/// Delete a partition
/// WARNING: This destroys all data on the partition!
#[command]
pub async fn delete_partition(partition_id: String) -> Result<(), String> {
    let partition = partition::get_partition_info(&partition_id)
        .map_err(|e| e.to_string())?;

    partition::delete_partition(&partition)
        .map_err(|e| e.to_string())
}

/// Execute partition reorganization (move partitions)
/// Performs the actual move operations safe and securely
#[command]
pub async fn execute_partition_moves(
    app: AppHandle,
    move_operations: Vec<partition::MoveOperation>,
) -> Result<String, String> {
    // Get all disks once to find partitions
    // Note: We might need to refresh this inside the loop if disk structure changes significantly,
    // but for simple moves it might be okay. However, strictly speaking, after a delete/create, 
    // the old PartitionInfo objects are stale.
    // A better approach is to re-fetch disk info based on ID before each move.
    
    let total_ops = move_operations.len();
    
    for (i, op) in move_operations.iter().enumerate() {
        // Fetch fresh disk info
        let disks = partition::get_all_disks().map_err(|e| e.to_string())?;
        
        // Find the disk and partition
        let mut target_disk: Option<DiskInfo> = None;
        let mut target_partition: Option<PartitionInfo> = None;
        
        for disk in disks {
            if let Some(p) = disk.partitions.iter().find(|p| p.id == op.partition_id) {
                target_partition = Some(p.clone());
                target_disk = Some(disk.clone());
                break;
            }
        }
        
        let partition = target_partition.ok_or_else(|| format!("Partition {} not found", op.partition_id))?;
        let disk = target_disk.ok_or_else(|| "Disk not found".to_string())?;
        
        // Configure move options
        let options = partition::move_partition::MovePartitionOptions {
            target_offset: op.to_offset,
            verify_after_move: true, // Safety first
            backup_path: None, // Use default temp location
        };
        
        // Emitting progress closure
        let app_handle = app.clone();
        let partition_id = partition.id.clone();
        let current_op_index = i;
        
        let progress_callback = move |progress: partition::move_partition::MoveProgress| {
            // Calculate global progress
            // Each op is 1/total_ops of the total work
            // Current op progress is progress.percent
            let op_weight = 100.0 / total_ops as f32;
            let global_percent = (current_op_index as f32 * op_weight) + (progress.percent * op_weight / 100.0);
            
            // Emit event to frontend
            // We might need a new event type or reuse 'resize-progress'
            // For now let's reuse resize-progress as it's likely monitored
            let _ = app_handle.emit("resize-progress", ResizeProgress {
                phase: match progress.phase {
                    partition::move_partition::MovePhase::Validating => partition::resize::ResizePhase::Validating,
                    partition::move_partition::MovePhase::BackingUp => partition::resize::ResizePhase::CreatingBackup,
                    partition::move_partition::MovePhase::DeletingOldPartition => partition::resize::ResizePhase::UpdatingPartitionTable,
                    partition::move_partition::MovePhase::CreatingNewPartition => partition::resize::ResizePhase::UpdatingPartitionTable,
                    partition::move_partition::MovePhase::RestoringData => partition::resize::ResizePhase::ResizingFilesystem,
                    partition::move_partition::MovePhase::Verifying => partition::resize::ResizePhase::Verifying,
                    partition::move_partition::MovePhase::Complete => partition::resize::ResizePhase::Complete,
                    partition::move_partition::MovePhase::Error => partition::resize::ResizePhase::Error,
                },
                percent: global_percent,
                message: format!("Partition {}: {}", partition_id, progress.message),
                can_cancel: false,
            });
        };
        
        // Execute move
        partition::move_partition::move_partition(&partition, &disk, options, progress_callback)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok("All partition moves completed successfully!".to_string())
}

/// Format bytes to human-readable size
fn format_size(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    if bytes == 0 {
        return "0 B".to_string();
    }

    let base = 1024_f64;
    let exp = (bytes as f64).log(base).floor() as usize;
    let exp = exp.min(UNITS.len() - 1);
    let value = bytes as f64 / base.powi(exp as i32);

    format!("{:.2} {}", value, UNITS[exp])
}
