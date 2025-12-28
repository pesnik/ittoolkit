'use client';

import React, { useState, useEffect } from 'react';
import {
  Card,
  Text,
  Button,
  Spinner,
  makeStyles,
  shorthands,
  tokens,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  mergeClasses,
} from '@fluentui/react-components';
import {
  HardDriveRegular,
  ArrowSyncRegular,
  ResizeRegular,
  ArrowSwap24Regular,
} from '@fluentui/react-icons';
import { invoke } from '@tauri-apps/api/core';
import { ResizeDialog } from './partition/ResizeDialog';
import { SpaceReallocationWizard } from './partition/SpaceReallocationWizard';
import { SpaceInputDialog } from './partition/SpaceInputDialog';
import { PartitionLayoutVisualizer } from './partition/PartitionLayoutVisualizer';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    ...shorthands.gap(tokens.spacingVerticalM),
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
  },
  diskCard: {
    marginBottom: tokens.spacingVerticalM,
    cursor: 'pointer',
    ...shorthands.transition('all', '0.2s', 'ease'),
    ':hover': {
      boxShadow: tokens.shadow8,
    },
  },
  diskCardSelected: {
    ...shorthands.borderColor(tokens.colorBrandForeground1),
    ...shorthands.borderWidth('2px'),
    boxShadow: tokens.shadow8,
  },
  diskCardContent: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalM),
    ...shorthands.padding(tokens.spacingVerticalL),
  },
  diskIcon: {
    fontSize: '32px',
    color: tokens.colorBrandForeground1,
  },
  diskInfo: {
    flex: 1,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    ...shorthands.padding(tokens.spacingVerticalXXXL),
    ...shorthands.gap(tokens.spacingVerticalM),
    color: tokens.colorNeutralForeground3,
  },
  loadingState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...shorthands.padding(tokens.spacingVerticalXXXL),
  },
});

interface DiskInfo {
  id: string;
  device_path: string;
  model: string;
  total_size: number;
  table_type: 'MBR' | 'GPT' | 'Unknown';
  partitions: PartitionInfo[];
  serial_number?: string;
  status: {
    is_online: boolean;
    has_errors: boolean;
  };
}

interface PartitionInfo {
  id: string;
  number: number;
  device_path: string;
  label: string | null;
  start_offset: number;
  total_size: number;
  used_space: number | null;
  partition_type: 'Primary' | 'Extended' | 'Logical' | 'Normal' | 'Unknown';
  filesystem: 'NTFS' | 'Ext2' | 'Ext3' | 'Ext4' | 'FAT32' | 'ExFAT' | 'APFS' | 'HFSPlus' | 'RAW' | 'Unknown';
  mount_point: string | null;
  is_mounted: boolean;
  flags: string[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function PartitionManager() {
  const styles = useStyles();
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [selectedDisk, setSelectedDisk] = useState<DiskInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [resizeDialogOpen, setResizeDialogOpen] = useState(false);
  const [selectedPartition, setSelectedPartition] = useState<PartitionInfo | null>(null);
  const [inputDialogOpen, setInputDialogOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDesiredSpace, setWizardDesiredSpace] = useState<number>(0);
  const [layoutVisualizerOpen, setLayoutVisualizerOpen] = useState(false);

  const loadDisks = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await invoke<DiskInfo[]>('get_disks');
      setDisks(result);
      if (selectedDisk) {
        // Update selected disk with fresh data
        const updated = result.find(d => d.id === selectedDisk.id);
        if (updated) {
          setSelectedDisk(updated);
        } else if (result.length > 0) {
          // If selected disk presumably disappeared (rare), select first
          setSelectedDisk(result[0]);
        } else {
          setSelectedDisk(null);
        }
      } else if (result.length > 0) {
        setSelectedDisk(result[0]);
      }
    } catch (err) {
      setError(`Failed to load disks: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDisks();
  }, []);

  const handleResizePartition = (partition: PartitionInfo) => {
    setSelectedPartition(partition);
    setResizeDialogOpen(true);
  };

  const handleReallocateSpace = (partition: PartitionInfo) => {
    setSelectedPartition(partition);
    setInputDialogOpen(true);
  };

  const handleSpaceInputConfirm = (spaceGB: number) => {
    setInputDialogOpen(false);
    setWizardDesiredSpace(spaceGB * 1024 * 1024 * 1024); // Convert GB to bytes
    setWizardOpen(true);
  };

  const handleResizeSuccess = () => {
    loadDisks(); // Reload disk data after successful resize
  };

  const handleWizardClose = () => {
    setWizardOpen(false);
    setSelectedPartition(null);
    loadDisks();
  };

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <Spinner label="Loading disk information..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.emptyState}>
        <Text size={500} weight="semibold">
          Error Loading Disks
        </Text>
        <Text>{error}</Text>
        <Button appearance="primary" onClick={loadDisks}>
          Retry
        </Button>
      </div>
    );
  }

  if (disks.length === 0) {
    return (
      <div className={styles.emptyState}>
        <HardDriveRegular style={{ fontSize: '48px' }} />
        <Text size={500} weight="semibold">
          No Disks Found
        </Text>
        <Text>No disk drives were detected on this system.</Text>
        <Button appearance="primary" icon={<ArrowSyncRegular />} onClick={loadDisks}>
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text size={500} weight="semibold">
          Partition Manager
        </Text>
        <Button
          appearance="subtle"
          icon={<ArrowSyncRegular />}
          onClick={loadDisks}
        >
          Refresh
        </Button>
      </div>

      <div className={styles.content}>
        <Text size={400} weight="semibold" style={{ marginBottom: tokens.spacingVerticalM }}>
          Available Disks
        </Text>

        {disks.map((disk) => (
          <Card
            key={disk.id}
            className={mergeClasses(styles.diskCard, selectedDisk?.id === disk.id && styles.diskCardSelected)}
            onClick={() => setSelectedDisk(disk)}
          >
            <div className={styles.diskCardContent}>
              <div className={styles.diskIcon}>
                <HardDriveRegular />
              </div>
              <div className={styles.diskInfo}>
                <Text size={400} weight="semibold">
                  {disk.model || 'Unknown Disk'}
                </Text>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  {disk.device_path} • {formatBytes(disk.total_size)} • {disk.table_type}
                </Text>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  {disk.partitions.length} partition{disk.partitions.length !== 1 ? 's' : ''}
                </Text>
              </div>
            </div>
          </Card>
        ))}

        {selectedDisk && selectedDisk.partitions.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: tokens.spacingVerticalL, marginBottom: tokens.spacingVerticalM }}>
              <Text size={400} weight="semibold">
                Partitions on {selectedDisk.model}
              </Text>
              <Button
                appearance="secondary"
                size="small"
                onClick={() => setLayoutVisualizerOpen(true)}
              >
                Reorganize Partitions
              </Button>
            </div>

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>#</TableHeaderCell>
                    <TableHeaderCell>Label</TableHeaderCell>
                    <TableHeaderCell>Size</TableHeaderCell>
                    <TableHeaderCell>Filesystem</TableHeaderCell>
                    <TableHeaderCell>Mount Point</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Actions</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedDisk.partitions.map((partition) => (
                    <TableRow key={partition.id}>
                      <TableCell>{partition.number}</TableCell>
                      <TableCell>{partition.label || '-'}</TableCell>
                      <TableCell>{formatBytes(partition.total_size)}</TableCell>
                      <TableCell>{partition.filesystem}</TableCell>
                      <TableCell>{partition.mount_point || '-'}</TableCell>
                      <TableCell>{partition.is_mounted ? 'Mounted' : 'Not Mounted'}</TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<ResizeRegular />}
                          onClick={() => handleResizePartition(partition)}
                        >
                          Manage Space
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </>
        )}

        {selectedDisk && selectedDisk.partitions.length === 0 && (
          <div className={styles.emptyState}>
            <Text>No partitions found on this disk.</Text>
          </div>
        )}
      </div>

      {/* Resize Dialog */}
      {selectedPartition && selectedDisk && (
        <ResizeDialog
          partition={selectedPartition}
          diskInfo={{ id: selectedDisk.id, total_size: selectedDisk.total_size }}
          open={resizeDialogOpen}
          onClose={() => {
            setResizeDialogOpen(false);
            setSelectedPartition(null);
          }}
          onSuccess={handleResizeSuccess}
          onReallocate={() => {
            // Trigger the space input dialog
            setInputDialogOpen(true);
          }}
        />
      )}

      {/* Space Input Dialog */}
      {selectedPartition && (
        <SpaceInputDialog
          open={inputDialogOpen}
          onClose={() => {
            setInputDialogOpen(false);
            setSelectedPartition(null);
          }}
          onConfirm={handleSpaceInputConfirm}
          partitionName={selectedPartition.device_path}
        />
      )}

      {/* Space Reallocation Wizard */}
      {selectedPartition && (
        <SpaceReallocationWizard
          open={wizardOpen}
          onClose={handleWizardClose}
          partition={selectedPartition}
          desiredSpace={wizardDesiredSpace}
        />
      )}

      {/* Partition Layout Visualizer */}
      {selectedDisk && (
        <PartitionLayoutVisualizer
          open={layoutVisualizerOpen}
          onClose={() => setLayoutVisualizerOpen(false)}
          diskId={selectedDisk.id}
          partitions={selectedDisk.partitions}
          diskSize={selectedDisk.total_size}
          onExecuteMove={async (moveOperations) => {
            try {
              console.log('Executing move operations:', moveOperations);
              const instructions = await invoke<string>('execute_partition_moves', {
                moveOperations
              });
              alert(instructions);
              loadDisks();
            } catch (err) {
              alert(`Failed to generate move plan: ${err}`);
            }
          }}
        />
      )}
    </div>
  );
}
