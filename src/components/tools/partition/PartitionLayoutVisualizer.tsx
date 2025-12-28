// Visual partition layout editor with drag-and-drop
// Visual partition layout editor with drag-and-drop

import React, { useState } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Text,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { invoke } from '@tauri-apps/api/core';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    minWidth: '700px',
  },
  diskBar: {
    display: 'flex',
    height: '80px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    overflow: 'hidden',
    position: 'relative',
  },
  partition: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '8px',
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: 'grab',
    userSelect: 'none',
    transition: 'all 0.2s ease',
    '&:hover': {
      opacity: 0.8,
    },
    '&:active': {
      cursor: 'grabbing',
    },
  },
  unallocated: {
    backgroundColor: tokens.colorNeutralBackground3,
    fontStyle: 'italic',
    color: tokens.colorNeutralForeground3,
  },
  ntfs: {
    backgroundColor: '#0078d4',
    color: 'white',
  },
  fat32: {
    backgroundColor: '#107c10',
    color: 'white',
  },
  system: {
    backgroundColor: '#d13438',
    color: 'white',
  },
  dragging: {
    opacity: 0.5,
    boxShadow: tokens.shadow16,
  },
  dropTarget: {
    outline: `2px dashed ${tokens.colorBrandForeground1}`,
    backgroundColor: tokens.colorBrandBackground2,
  },
  legend: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  arrow: {
    textAlign: 'center',
    fontSize: '24px',
    color: tokens.colorBrandForeground1,
  },
  segmentActions: {
    display: 'flex',
    gap: tokens.spacingHorizontalXXS,
    marginTop: tokens.spacingVerticalXS,
    opacity: 0,
    transition: 'opacity 0.2s ease',
  },
  partitionHover: {
    ':hover .segmentActions': {
      opacity: 1,
    },
  },
});

interface PartitionSegment {
  id: string;
  label: string;
  size: number; // in bytes
  filesystem: string;
  isUnallocated: boolean;
  isSystem: boolean;
  startOffset: number;
  canMove: boolean;
}

interface PartitionLayoutVisualizerProps {
  open: boolean;
  onClose: () => void;
  diskId: string;
  partitions: Array<{
    id: string;
    label: string | null;
    total_size: number;
    filesystem: string;
    start_offset: number;
    flags: string[];
    mount_point: string | null;
  }>;
  diskSize: number;
  onExecuteMove: (moveOperations: MoveOperation[]) => void;
}

interface MoveOperation {
  partition_id: string;
  from_offset: number;
  to_offset: number;
}

export function PartitionLayoutVisualizer({
  open,
  onClose,
  diskId,
  partitions,
  diskSize,
  onExecuteMove,
}: PartitionLayoutVisualizerProps) {
  const styles = useStyles();

  // Build initial layout
  const buildLayout = (): PartitionSegment[] => {
    const segments: PartitionSegment[] = [];
    let currentOffset = 0;

    // Sort partitions by start offset
    const sortedPartitions = [...partitions].sort((a, b) => a.start_offset - b.start_offset);

    sortedPartitions.forEach((part, index) => {
      // Add unallocated space before this partition if any
      // Only show if > 10MB to avoid confusing "0.00 GB" alignment gaps
      if (part.start_offset > currentOffset + 10 * 1024 * 1024) {
        segments.push({
          id: `unalloc-${index}`,
          label: 'Unallocated',
          size: part.start_offset - currentOffset,
          filesystem: 'Unallocated',
          isUnallocated: true,
          isSystem: false,
          startOffset: currentOffset,
          canMove: false, // Don't allow moving empty space directly, it's confusing
        });
      }

      // Add the partition
      const isSystem = part.flags.includes('Boot') || part.flags.includes('System') || part.flags.includes('EFI');
      segments.push({
        id: part.id,
        label: part.label || part.mount_point || `Partition ${index + 1}`,
        size: part.total_size,
        filesystem: part.filesystem,
        isUnallocated: false,
        isSystem,
        startOffset: part.start_offset,
        canMove: !isSystem, // Can't move system/boot partitions
      });

      currentOffset = part.start_offset + part.total_size;
    });

    // Add trailing unallocated space if any (> 10MB)
    if (currentOffset < diskSize - 10 * 1024 * 1024) {
      segments.push({
        id: `unalloc-end`,
        label: 'Unallocated',
        size: diskSize - currentOffset,
        filesystem: 'Unallocated',
        isUnallocated: true,
        isSystem: false,
        startOffset: currentOffset,
        canMove: false,
      });
    }

    return segments;
  };

  const [currentLayout, setCurrentLayout] = useState<PartitionSegment[]>(buildLayout());
  const [proposedLayout, setProposedLayout] = useState<PartitionSegment[]>(buildLayout());
  const [hasChanges, setHasChanges] = useState(false);

  // Update layouts when partitions prop changes (e.g. data loaded)
  React.useEffect(() => {
    const layout = buildLayout();
    setCurrentLayout(layout);
    setProposedLayout(layout);
    setHasChanges(false);
  }, [partitions, diskSize]);

  const formatSize = (bytes: number): string => {
    const gb = bytes / (1024 ** 3);
    return `${gb.toFixed(2)} GB`;
  };

  const getPartitionClass = (segment: PartitionSegment): string => {
    if (segment.isUnallocated) return styles.unallocated;
    if (segment.isSystem) return styles.system;
    if (segment.filesystem === 'NTFS') return styles.ntfs;
    if (segment.filesystem === 'FAT32' || segment.filesystem === 'FAT') return styles.fat32;
    return styles.ntfs; // default
  };

  const getPartitionWidth = (segment: PartitionSegment): string => {
    const percentage = (segment.size / diskSize) * 100;
    // Ensure we return the percentage as a string for use in flexBasis or width
    return `${percentage}%`;
  };

  const updateOffsets = (layout: PartitionSegment[]): PartitionSegment[] => {
    let offset = 0;
    return layout.map(segment => {
      const newSegment = { ...segment, startOffset: offset };
      offset += segment.size;
      return newSegment;
    });
  };

  const handleMove = (index: number, direction: 'left' | 'right') => {
    const newLayout = [...proposedLayout];
    const targetIndex = direction === 'left' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newLayout.length) return;

    // Check if move is allowed
    // We prevent moving system partitions (always locked)
    // We ALSO prevent moving "locked" segments (like unallocated space if we decided to lock it)
    if (!newLayout[index].canMove) return;

    // NOTE: Swapping with unallocated space is what we usually want to do.
    // If the valid partition is moving into unallocated space, that's fine.
    // But if we are swapping two valid partitions, that might be weird?
    // The visualizer just swaps array positions. 
    // The actual "move" logic is derived later.

    // Swap elements
    [newLayout[index], newLayout[targetIndex]] = [newLayout[targetIndex], newLayout[index]];

    const finalLayout = updateOffsets(newLayout);
    setProposedLayout(finalLayout);
    setHasChanges(true);
  };

  const handleMoveToEnd = (identifier: string | number) => {
    // Move the selected partition/segment to the end
    const newLayout = [...proposedLayout];
    let index = -1;

    if (typeof identifier === 'number') {
      index = identifier;
    } else {
      index = newLayout.findIndex(p => p.id === identifier);
    }

    if (index === -1) return;

    const item = newLayout[index];
    if (!item.canMove) return;

    // Remove from current position
    newLayout.splice(index, 1);

    // Find last unallocated space or create one
    const lastUnallocIndex = newLayout.length - 1;

    // Insert partition at the end, before last unallocated if exists
    if (newLayout[lastUnallocIndex]?.isUnallocated) {
      newLayout.splice(lastUnallocIndex, 0, item);
    } else {
      newLayout.push(item);
    }

    // Recalculate all offsets
    const finalLayout = updateOffsets(newLayout);
    setProposedLayout(finalLayout);
    setHasChanges(true);
  };

  const calculateMoveOperations = (): MoveOperation[] => {
    const operations: MoveOperation[] = [];

    currentLayout.forEach(current => {
      if (current.isUnallocated || current.isSystem) return;

      const proposed = proposedLayout.find(p => p.id === current.id);
      if (proposed && proposed.startOffset !== current.startOffset) {
        operations.push({
          partition_id: current.id,
          from_offset: current.startOffset,
          to_offset: proposed.startOffset,
        });
      }
    });

    return operations;
  };

  const handleApply = () => {
    const operations = calculateMoveOperations();
    onExecuteMove(operations);
    onClose();
  };

  const handleReset = () => {
    setProposedLayout(buildLayout());
    setHasChanges(false);
  };



  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface style={{ maxWidth: '900px' }}>
        <DialogBody>
          <DialogTitle>Partition Layout Manager</DialogTitle>
          <DialogContent className={styles.container}>
            <MessageBar intent="info">
              <MessageBarBody>
                Move partitions to reorganize disk space. Click buttons below to move partitions to the end.
                This allows you to consolidate free space for other partitions.
              </MessageBarBody>
            </MessageBar>

            {/* Current Layout */}
            <div>
              <Text weight="semibold">Current Layout:</Text>
              <div className={styles.diskBar}>
                {currentLayout.map(segment => (
                  <div
                    key={segment.id}
                    className={`${styles.partition} ${getPartitionClass(segment)}`}
                    style={{ width: getPartitionWidth(segment) }}
                  >
                    <Text size={200} weight="semibold">{segment.label}</Text>
                    <Text size={100}>{formatSize(segment.size)}</Text>
                  </div>
                ))}
              </div>
            </div>

            {/* Arrow */}
            <div className={styles.arrow}>↓</div>

            {/* Proposed Layout (Editable) */}
            <div>
              <Text weight="semibold">Proposed layout (Use arrows to reorder):</Text>
              <div className={styles.diskBar}>
                {proposedLayout.map((segment, index) => (
                  <div
                    key={segment.id}
                    className={`${styles.partition} ${getPartitionClass(segment)} ${styles.partitionHover}`}
                    style={{
                      flex: `0 1 ${getPartitionWidth(segment)}`,
                      boxSizing: 'border-box',
                      minWidth: '50px', // Ensure everything is at least somewhat visible
                      overflow: 'hidden',
                    }}
                    title={segment.isSystem ? "Cannot move system partition" : ""}
                  >
                    <Text size={200} weight="semibold" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {segment.label}
                    </Text>
                    <Text size={100}>{formatSize(segment.size)}</Text>

                    {!segment.isSystem && (
                      <div className="segmentActions" style={{
                        display: 'flex',
                        gap: '4px',
                        marginTop: '4px',
                        backgroundColor: 'rgba(0,0,0,0.1)',
                        padding: '2px',
                        borderRadius: '4px'
                      }}>
                        <Button
                          size="small"
                          icon={<Text style={{ fontWeight: 'bold' }}>←</Text>}
                          disabled={index === 0}
                          onClick={() => handleMove(index, 'left')}
                          title="Move Left"
                        />
                        <Button
                          size="small"
                          icon={<Text style={{ fontWeight: 'bold' }}>→</Text>}
                          disabled={index === proposedLayout.length - 1}
                          onClick={() => handleMove(index, 'right')}
                          title="Move Right"
                        />
                        <Button
                          size="small"
                          icon={<Text style={{ fontWeight: 'bold' }}>⇥</Text>}
                          onClick={() => handleMoveToEnd(index)}
                          title="Move to End"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className={styles.legend}>
              <Text weight="semibold">Quick Actions:</Text>
              {currentLayout
                .filter(seg => !seg.isUnallocated && seg.canMove)
                .map(segment => (
                  <Button
                    key={segment.id}
                    size="small"
                    appearance="secondary"
                    onClick={() => handleMoveToEnd(segment.id)}
                  >
                    Move "{segment.label}" to End
                  </Button>
                ))}
            </div>

            {hasChanges && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  ⚠️ Moving partitions takes time and cannot be undone. Make sure you have backups!
                  Estimated time: {calculateMoveOperations().length * 15}-{calculateMoveOperations().length * 30} minutes.
                </MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              Cancel
            </Button>
            {hasChanges && (
              <Button appearance="secondary" onClick={handleReset}>
                Reset
              </Button>
            )}
            <Button
              appearance="primary"
              onClick={handleApply}
              disabled={!hasChanges}
            >
              Apply Changes
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
