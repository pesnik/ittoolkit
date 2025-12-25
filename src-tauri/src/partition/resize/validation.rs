// Validation logic for resize operations

use crate::partition::types::*;
use anyhow::{anyhow, Result};

/// Result of a resize validation check
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ValidationResult {
    /// Whether the resize operation is valid
    pub is_valid: bool,

    /// List of validation errors (if any)
    pub errors: Vec<String>,

    /// List of warnings (operation can proceed but user should be aware)
    pub warnings: Vec<String>,

    /// Calculated safe size for the resize (may differ from requested)
    pub safe_size: Option<u64>,

    /// Minimum size the partition can be shrunk to
    pub minimum_size: Option<u64>,

    /// Maximum size the partition can be expanded to
    pub maximum_size: Option<u64>,

    /// Whether adjacent unallocated space exists
    pub has_adjacent_space: bool,

    /// Amount of adjacent unallocated space (bytes)
    pub adjacent_space: u64,
}

/// Validate a partition expansion request
pub fn validate_expand(
    partition: &PartitionInfo,
    disk: &DiskInfo,
    target_size: u64,
) -> Result<ValidationResult> {
    let mut result = ValidationResult {
        is_valid: true,
        errors: Vec::new(),
        warnings: Vec::new(),
        safe_size: Some(target_size),
        minimum_size: Some(partition.total_size),
        maximum_size: None,
        has_adjacent_space: false,
        adjacent_space: 0,
    };

    // Check 1: Target size must be larger than current size
    if target_size <= partition.total_size {
        result.is_valid = false;
        result.errors.push(format!(
            "Target size ({}) must be larger than current size ({})",
            format_bytes(target_size),
            format_bytes(partition.total_size)
        ));
        return Ok(result);
    }

    // Check 2: Calculate available space after this partition
    let partition_end = partition.start_offset + partition.total_size;
    let next_partition = find_next_partition(disk, partition);

    let available_space = if let Some(next) = next_partition {
        // Space between this partition and the next one
        next.start_offset.saturating_sub(partition_end)
    } else {
        // Space between this partition and end of disk
        disk.total_size.saturating_sub(partition_end)
    };

    result.adjacent_space = available_space;
    result.has_adjacent_space = available_space > 0;

    // Check 3: Verify there's enough adjacent space
    let size_increase = target_size - partition.total_size;
    if size_increase > available_space {
        result.is_valid = false;
        result.errors.push(format!(
            "Not enough adjacent space. Requested increase: {}, Available: {}",
            format_bytes(size_increase),
            format_bytes(available_space)
        ));
    }

    // Calculate maximum safe size
    result.maximum_size = Some(partition.total_size + available_space);

    // Check 4: Ensure partition is not mounted (for safety)
    if partition.is_mounted {
        result.warnings.push(
            "Partition is currently mounted. Expansion may require unmounting or system restart.".to_string()
        );
    }

    // Check 5: Filesystem support check
    if !partition.filesystem.supports_resize() {
        result.is_valid = false;
        result.errors.push(format!(
            "Filesystem type '{}' does not support resize operations",
            partition.filesystem.display_name()
        ));
    }

    Ok(result)
}

/// Validate a partition shrink request
pub fn validate_shrink(
    partition: &PartitionInfo,
    target_size: u64,
) -> Result<ValidationResult> {
    let mut result = ValidationResult {
        is_valid: true,
        errors: Vec::new(),
        warnings: Vec::new(),
        safe_size: Some(target_size),
        minimum_size: None,
        maximum_size: Some(partition.total_size),
        has_adjacent_space: false,
        adjacent_space: 0,
    };

    // Check 1: Target size must be smaller than current size
    if target_size >= partition.total_size {
        result.is_valid = false;
        result.errors.push(format!(
            "Target size ({}) must be smaller than current size ({})",
            format_bytes(target_size),
            format_bytes(partition.total_size)
        ));
        return Ok(result);
    }

    // Check 2: Ensure target size is larger than used space
    if let Some(used_space) = partition.used_space {
        // Add 20% buffer for safety
        let min_safe_size = (used_space as f64 * 1.2) as u64;
        result.minimum_size = Some(min_safe_size);

        if target_size < min_safe_size {
            result.is_valid = false;
            result.errors.push(format!(
                "Target size ({}) is too small. Used space: {}, Minimum safe size: {}",
                format_bytes(target_size),
                format_bytes(used_space),
                format_bytes(min_safe_size)
            ));
        } else if target_size < used_space + (100 * 1024 * 1024) {
            // Less than 100MB free space
            result.warnings.push(
                "Target size leaves less than 100MB free space. This is not recommended.".to_string()
            );
        }
    } else {
        result.warnings.push(
            "Cannot determine used space. Shrink operation may fail if target size is too small.".to_string()
        );
    }

    // Check 3: Filesystem support check
    // Note: On Windows, diskpart can shrink mounted NTFS volumes
    // On Linux/macOS, we may need to unmount first (handled in shrink operation)
    if !partition.filesystem.supports_resize() {
        result.is_valid = false;
        result.errors.push(format!(
            "Filesystem type '{}' does not support resize operations",
            partition.filesystem.display_name()
        ));
    }

    // Check 4: Mounted partition warnings (Windows can shrink mounted volumes)
    #[cfg(not(target_os = "windows"))]
    if partition.is_mounted {
        result.warnings.push(
            "This partition is mounted. You may need to unmount it before shrinking on this OS.".to_string()
        );
    }

    // Check 5: Boot partition warning
    if partition.flags.contains(&PartitionFlag::Boot) {
        result.warnings.push(
            "WARNING: This is a boot partition. Shrinking it may make the system unbootable!".to_string()
        );
    }

    // Check 6: System partition warning
    if partition.flags.contains(&PartitionFlag::System) {
        result.warnings.push(
            "WARNING: This is a system partition. Shrinking it requires extreme caution!".to_string()
        );
    }

    Ok(result)
}

/// Find the next partition after the given one on the same disk
fn find_next_partition<'a>(disk: &'a DiskInfo, current: &PartitionInfo) -> Option<&'a PartitionInfo> {
    let current_end = current.start_offset + current.total_size;

    disk.partitions
        .iter()
        .filter(|p| p.start_offset >= current_end)
        .min_by_key(|p| p.start_offset)
}

/// Format bytes to human-readable string
fn format_bytes(bytes: u64) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_expand_basic() {
        let partition = PartitionInfo {
            id: "test-1".to_string(),
            number: 1,
            device_path: "C:".to_string(),
            label: None,
            start_offset: 1024 * 1024,
            total_size: 100 * 1024 * 1024 * 1024, // 100GB
            used_space: Some(50 * 1024 * 1024 * 1024), // 50GB
            partition_type: PartitionType::Primary,
            filesystem: FilesystemType::NTFS,
            mount_point: Some("C:".to_string()),
            is_mounted: true,
            flags: vec![],
        };

        let disk = DiskInfo {
            id: "disk-0".to_string(),
            device_path: "\\\\.\\PhysicalDrive0".to_string(),
            model: "Test Disk".to_string(),
            total_size: 500 * 1024 * 1024 * 1024, // 500GB
            table_type: PartitionTableType::GPT,
            partitions: vec![partition.clone()],
            serial_number: None,
            status: DiskStatus {
                is_online: true,
                has_errors: false,
                smart_status: None,
            },
        };

        let target_size = 150 * 1024 * 1024 * 1024; // 150GB
        let result = validate_expand(&partition, &disk, target_size).unwrap();

        assert!(result.is_valid);
        assert!(result.has_adjacent_space);
        assert!(result.adjacent_space > 0);
    }

    #[test]
    fn test_validate_shrink_below_used_space() {
        let partition = PartitionInfo {
            id: "test-1".to_string(),
            number: 1,
            device_path: "C:".to_string(),
            label: None,
            start_offset: 1024 * 1024,
            total_size: 100 * 1024 * 1024 * 1024, // 100GB
            used_space: Some(80 * 1024 * 1024 * 1024), // 80GB used
            partition_type: PartitionType::Primary,
            filesystem: FilesystemType::NTFS,
            mount_point: Some("C:".to_string()),
            is_mounted: false,
            flags: vec![],
        };

        let target_size = 70 * 1024 * 1024 * 1024; // 70GB (less than used)
        let result = validate_shrink(&partition, target_size).unwrap();

        assert!(!result.is_valid);
        assert!(!result.errors.is_empty());
    }
}
