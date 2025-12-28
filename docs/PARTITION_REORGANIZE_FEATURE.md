# Partition Reorganization Feature

## Feature Overview

The **Partition Layout Visualizer** allows you to:

1.  **Visualize** your current disk layout
2.  **Move partitions** to different positions on the disk
3.  **Consolidate free space** by moving partitions to the end

## How to Use It

### Step 1: Open the Visualizer

1.  Go to **Partition Manager**
2.  Select your disk
3.  Click the **"Reorganize Partitions"** button (top right, above the partition table)

### Step 2: Move Partitions

The visualizer shows:
-   **Current Layout**: Your disk as it is now
-   **Quick Actions**: Buttons to move partitions to the end
-   **Proposed Layout**: How the disk will look after moves

For your specific case (creating space for C:):
1.  Click **"Move E: to End"**
2.  Click **"Move F: to End"**

This will reorganize the disk to move free space adjacent to C:.

### Step 3: Apply Changes

1.  Review the **Proposed Layout** visualization
2.  Read the warning about backup and time estimate
3.  Click **"Apply Changes"**

The app will then execute the partition moves safely.

## Technical Details

The partition moving feature is implemented using safe, robust methods:

1.  **Safety First**: The system verifies partition integrity before any operation.
2.  **Data Protection**: A full backup of the partition data is created before any changes.
3.  **Atomic Operations**: The old partition is only removed after the backup is secured.
4.  **Verification**: Data is restored to the new location and verified.

## Warnings & Best Practices

⚠️ **ALWAYS BACKUP BEFORE RESIZING PARTITIONS**
-   Even though our process uses a backup-restore method, power loss during the operation can be risky.
-   Ensure you have enough free space on another drive for temporary backups if moving large partitions.
