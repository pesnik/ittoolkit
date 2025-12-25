// Partition management module
//
// This module provides functionality for reading and manipulating disk partitions.
// It supports multiple partition table formats (MBR, GPT) and filesystems (NTFS, ext4, FAT32).

pub mod types;
pub mod info;
pub mod platform;
pub mod resize;
pub mod move_partition;
pub mod reallocation_wizard;
pub mod mount;

// Re-export commonly used types
pub use types::*;
pub use info::*;
pub use resize::*;
pub use move_partition::*;
pub use reallocation_wizard::*;
pub use mount::*;
