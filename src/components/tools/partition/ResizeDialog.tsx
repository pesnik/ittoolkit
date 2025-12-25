import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Text,
  Spinner,
  Field,
  Slider,
  Input,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { BackupVerificationDialog } from './BackupVerificationDialog';
import { ConfirmationDialog } from './ConfirmationDialog';

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

interface ValidationResult {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
  safe_size: number | null;
  minimum_size: number | null;
  maximum_size: number | null;
  has_adjacent_space: boolean;
  adjacent_space: number;
}

interface ResizeProgress {
  phase: 'Validating' | 'CheckingFilesystem' | 'CreatingBackup' | 'ResizingFilesystem' |
  'UpdatingPartitionTable' | 'ExpandingFilesystem' | 'Verifying' | 'Complete' | 'Error';
  percent: number;
  message: string;
  can_cancel: boolean;
}

const useStyles = makeStyles({
  dialogContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  partitionInfo: {
    padding: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
  },
  sizeSelector: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  sizeInputs: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'flex-end',
  },
  validation: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  progressContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalL,
  },
  slider: {
    width: '100%',
    '& .fui-Slider__rail': {
      backgroundColor: tokens.colorNeutralBackground5,
      height: '4px',
    },
    '& .fui-Slider__thumb': {
      backgroundColor: tokens.colorBrandBackground,
      width: '16px',
      height: '16px',
      border: `2px solid ${tokens.colorNeutralBackground1}`,
    },
    '& .fui-Slider__track': {
      backgroundColor: tokens.colorBrandBackground,
      height: '4px',
    },
  },
});

interface ResizeDialogProps {
  partition: PartitionInfo;
  diskInfo: { id: string; total_size: number };
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onReallocate?: () => void;
}

export function ResizeDialog({ partition, diskInfo, open, onClose, onSuccess, onReallocate }: ResizeDialogProps) {
  const styles = useStyles();
  const [mode, setMode] = useState<'expand' | 'shrink'>('expand');
  const [targetSize, setTargetSize] = useState(partition.total_size);
  const [targetSizeGB, setTargetSizeGB] = useState((partition.total_size / (1024 ** 3)).toFixed(2));
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [progress, setProgress] = useState<ResizeProgress | null>(null);
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showReallocateOption, setShowReallocateOption] = useState(false);

  // Calculate min/max in GB for slider
  const minSizeGB = partition.used_space
    ? Math.ceil((partition.used_space * 1.2) / (1024 ** 3)) // 20% buffer above used space
    : 1; // Minimum 1GB
  const currentSizeGB = partition.total_size / (1024 ** 3);
  const maxSizeGB = validation?.maximum_size
    ? (validation.maximum_size / (1024 ** 3))
    : currentSizeGB * 2; // Default to 2x current if no validation yet

  useEffect(() => {
    if (open) {
      // Reset state when dialog opens
      setTargetSize(partition.total_size);
      setTargetSizeGB((partition.total_size / (1024 ** 3)).toFixed(2));
      setValidation(null);
      setIsResizing(false);
      setProgress(null);
    }
  }, [open, partition.total_size]);

  useEffect(() => {
    // Set up progress listener
    const unlisten = listen<ResizeProgress>('resize-progress', (event) => {
      setProgress(event.payload);
      if (event.payload.phase === 'Complete') {
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 2000);
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [onSuccess, onClose]);

  const handleValidate = async () => {
    setIsValidating(true);
    try {
      const sizeInBytes = Math.floor(parseFloat(targetSizeGB) * (1024 ** 3));
      setTargetSize(sizeInBytes);

      const result = mode === 'expand'
        ? await invoke<ValidationResult>('validate_expand_partition', {
          partitionId: partition.id,
          targetSize: sizeInBytes,
        })
        : await invoke<ValidationResult>('validate_shrink_partition', {
          partitionId: partition.id,
          targetSize: sizeInBytes,
        });

      setValidation(result);
    } catch (error) {
      console.error('Validation error:', error);
      setValidation({
        is_valid: false,
        errors: [String(error)],
        warnings: [],
        safe_size: null,
        minimum_size: null,
        maximum_size: null,
        has_adjacent_space: false,
        adjacent_space: 0,
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleResize = async () => {
    if (!validation?.is_valid) return;

    // For shrink operations, show backup verification first
    if (mode === 'shrink') {
      setShowBackupDialog(true);
      return;
    }

    // For expand, proceed directly
    await executeResize();
  };

  const handleBackupVerified = () => {
    setShowBackupDialog(false);
    setShowConfirmDialog(true);
  };

  const handleFinalConfirm = async () => {
    setShowConfirmDialog(false);
    await executeResize();
  };

  const executeResize = async () => {
    if (!validation?.is_valid) return;

    setIsResizing(true);
    try {
      if (mode === 'expand') {
        await invoke('expand_partition', {
          partitionId: partition.id,
          targetSize,
        });
      } else {
        await invoke('shrink_partition', {
          partitionId: partition.id,
          targetSize,
        });
      }
    } catch (error) {
      console.error('Resize error:', error);
      setProgress({
        phase: 'Error',
        percent: 0,
        message: String(error),
        can_cancel: false,
      });
      setIsResizing(false);
    }
  };

  const handleSliderChange = (_: unknown, data: { value: number }) => {
    setTargetSizeGB(data.value.toFixed(2));
  };

  const handleInputChange = (value: string) => {
    setTargetSizeGB(value);
    setValidation(null); // Clear validation when user changes size
  };

  const formatBytes = (bytes: number): string => {
    const gb = bytes / (1024 ** 3);
    return `${gb.toFixed(2)} GB`;
  };

  if (isResizing && progress) {
    return (
      <Dialog open={open} onOpenChange={(_, data) => !data.open && !isResizing && onClose()}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Resizing Partition</DialogTitle>
            <DialogContent>
              <div className={styles.progressContainer}>
                <Text weight="semibold">{progress.message}</Text>
                <ProgressBar value={progress.percent / 100} />
                <Text size={200}>{progress.percent.toFixed(0)}% - {progress.phase}</Text>
                {progress.phase === 'Error' && (
                  <MessageBar intent="error">
                    <MessageBarBody>{progress.message}</MessageBarBody>
                  </MessageBar>
                )}
                {progress.phase === 'Complete' && (
                  <MessageBar intent="success">
                    <MessageBarBody>Resize operation completed successfully!</MessageBarBody>
                  </MessageBar>
                )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={onClose}
                disabled={!progress.can_cancel && progress.phase !== 'Complete' && progress.phase !== 'Error'}
              >
                {progress.phase === 'Complete' || progress.phase === 'Error' ? 'Close' : 'Cancel'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Resize Partition</DialogTitle>
          <DialogContent className={styles.dialogContent}>
            {/* Partition Info */}
            <div className={styles.partitionInfo}>
              <Text weight="semibold">
                {partition.label || `Partition ${partition.number}`} ({partition.mount_point || partition.device_path})
              </Text>
              <div>
                <Text size={200}>Filesystem: {partition.filesystem}</Text>
              </div>
              <div>
                <Text size={200}>Current Size: {formatBytes(partition.total_size)}</Text>
              </div>
              {partition.used_space && (
                <div>
                  <Text size={200}>Used Space: {formatBytes(partition.used_space)}</Text>
                </div>
              )}
            </div>

            {/* Mode Selection */}
            <Field label="Operation">
              <div style={{ display: 'flex', gap: tokens.spacingHorizontalM }}>
                <Button
                  appearance={mode === 'expand' ? 'primary' : 'secondary'}
                  onClick={() => setMode('expand')}
                >
                  Expand
                </Button>
                <Button
                  appearance={mode === 'shrink' ? 'primary' : 'secondary'}
                  onClick={() => setMode('shrink')}
                >
                  Shrink
                </Button>
              </div>
            </Field>

            {/* Size Selector */}
            <div className={styles.sizeSelector}>
              <Field label="New Size (GB)">
                <Slider className={styles.slider} style={{ backgroundColor: "transparent" }}
                  min={minSizeGB}
                  max={maxSizeGB > currentSizeGB ? maxSizeGB : currentSizeGB * 1.5}
                  value={parseFloat(targetSizeGB)}
                  onChange={handleSliderChange}
                  step={0.01}
                />
              </Field>
              <div className={styles.sizeInputs}>
                <Field label="Size in GB">
                  <Input
                    type="number"
                    value={targetSizeGB}
                    onChange={(e) => handleInputChange(e.target.value)}
                    step={0.01}
                  />
                </Field>
                <Button onClick={handleValidate} disabled={isValidating}>
                  {isValidating ? <Spinner size="tiny" /> : 'Validate'}
                </Button>
              </div>
            </div>

            {/* Validation Results */}
            {validation && (
              <div className={styles.validation}>
                {validation.errors.map((error, idx) => (
                  <MessageBar key={`error-${idx}`} intent="error">
                    <MessageBarBody>
                      {error}
                      {error.includes('must be unmounted') && partition.is_mounted && (
                        <div style={{ marginTop: '8px' }}>
                          <Button
                            size="small"
                            appearance="primary"
                            onClick={async () => {
                              try {
                                await invoke('unmount_partition', { partitionId: partition.id });
                                alert('Partition unmounted successfully! Please click Validate again.');
                              } catch (err) {
                                alert(`Failed to unmount: ${err}`);
                              }
                            }}
                          >
                            Unmount Partition
                          </Button>
                        </div>
                      )}
                    </MessageBarBody>
                  </MessageBar>
                ))}
                {validation.warnings.map((warning, idx) => (
                  <MessageBar key={`warning-${idx}`} intent="warning">
                    <MessageBarBody>{warning}</MessageBarBody>
                  </MessageBar>
                ))}
                {validation.is_valid && validation.errors.length === 0 && (
                  <MessageBar intent="success">
                    <MessageBarBody>
                      Resize operation is valid. New size: {formatBytes(targetSize)}
                      {validation.has_adjacent_space && (
                        <> (Adjacent space: {formatBytes(validation.adjacent_space)})</>
                      )}
                    </MessageBarBody>
                  </MessageBar>
                )}

                {/* Show reallocate option if no adjacent space for expansion */}
                {mode === 'expand' && !validation.is_valid && validation.errors.some(e => e.includes('Not enough adjacent space')) && (
                  <MessageBar intent="info">
                    <MessageBarBody>
                      <Text weight="semibold">Need more space?</Text>
                      <Text size={200} style={{ marginTop: '8px' }}>
                        This partition doesn't have enough free space directly after it. You can:
                      </Text>
                      <ul style={{ marginTop: '8px', marginBottom: '8px' }}>
                        <li><strong>Shrink other partitions</strong> (like E: or F:) to free up space</li>
                        <li><strong>Move partitions</strong> to create adjacent free space</li>
                      </ul>
                      <Button
                        appearance="primary"
                        size="small"
                        onClick={() => {
                          onClose();
                          if (onReallocate) {
                            onReallocate();
                          }
                        }}
                        style={{ marginTop: '8px' }}
                      >
                        Take Space from Other Partitions
                      </Button>
                    </MessageBarBody>
                  </MessageBar>
                )}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={handleResize}
              disabled={!validation?.is_valid || isValidating || isResizing}
            >
              {isResizing ? <Spinner size="tiny" /> : 'Resize'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// Render safety dialogs outside main dialog
function ResizeDialogWrapper(props: ResizeDialogProps) {
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  return (
    <>
      <ResizeDialog {...props} />
      <BackupVerificationDialog
        open={showBackupDialog}
        partitionName={props.partition.label || `Partition ${props.partition.number}`}
        onConfirm={() => {
          setShowBackupDialog(false);
          setShowConfirmDialog(true);
        }}
        onCancel={() => setShowBackupDialog(false)}
      />
      <ConfirmationDialog
        open={showConfirmDialog}
        partitionName={props.partition.label || `Partition ${props.partition.number}`}
        currentSize={(props.partition.total_size / (1024 ** 3)).toFixed(2)}
        targetSize="0"
        onConfirm={() => setShowConfirmDialog(false)}
        onCancel={() => setShowConfirmDialog(false)}
      />
    </>
  );
}
