import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Text,
  Card,
  CardHeader,
  Divider,
  MessageBar,
  ProgressBar,
  Spinner,
} from '@fluentui/react-components';
import {
  Warning24Regular,
  Info24Regular,
  CheckmarkCircle24Regular,
  Delete24Regular,
  ArrowExpand24Regular,
} from '@fluentui/react-icons';
import styles from './SpaceReallocationWizard.module.css';

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

interface ReallocationPlan {
  target_partition_id: string;
  source_partitions: SourcePartitionPlan[];
  total_space_freed: number;
  target_new_size: number;
  steps: ReallocationStep[];
  warnings: string[];
}

interface SourcePartitionPlan {
  partition_id: string;
  partition_label: string;
  current_size: number;
  used_space?: number;
  action: { DeleteEntirely?: {} } | { ShrinkAndDelete?: { shrink_to: number } } | { ShrinkOnly?: { new_size: number } };
}

interface ReallocationStep {
  step_number: number;
  title: string;
  description: string;
  action_type: 'UserManual' | 'AppAutomated' | 'AppAssistedManual';
  can_automate: boolean;
}

interface SpaceReallocationWizardProps {
  open: boolean;
  onClose: () => void;
  partition: PartitionInfo;
  desiredSpace: number; // in bytes
}

type WizardStep = 'input' | 'analyzing' | 'plan' | 'executing' | 'complete' | 'error';

export const SpaceReallocationWizard: React.FC<SpaceReallocationWizardProps> = ({
  open,
  onClose,
  partition,
  desiredSpace,
}) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('input');
  const [plan, setPlan] = useState<ReallocationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentExecutingStep, setCurrentExecutingStep] = useState<number>(0);

  const formatBytes = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  };

  const createPlan = async () => {
    setCurrentStep('analyzing');
    setError(null);

    try {
      const result = await invoke<ReallocationPlan>('create_space_reallocation_plan', {
        targetPartitionId: partition.id,
        desiredAdditionalSpace: desiredSpace,
      });

      setPlan(result);
      setCurrentStep('plan');
    } catch (err) {
      setError(String(err));
      setCurrentStep('error');
    }
  };

  const executeStep = async (step: ReallocationStep) => {
    if (step.action_type === 'UserManual') {
      // User must do this manually
      return;
    }

    if (step.action_type === 'AppAutomated') {
      // App can do this automatically
      if (step.title.toLowerCase().includes('expand')) {
        // Execute expand
        await invoke('expand_partition', {
          partitionId: plan!.target_partition_id,
          targetSize: plan!.target_new_size,
        });
      }
    }

    if (step.action_type === 'AppAssistedManual') {
      // App guides but user confirms
      if (step.title.toLowerCase().includes('delete')) {
        // Would need to implement delete partition command
        console.log('Delete step - not yet implemented');
      }
    }
  };

  const executePlan = async () => {
    if (!plan) return;

    setCurrentStep('executing');
    setCurrentExecutingStep(0);

    try {
      for (let i = 0; i < plan.steps.length; i++) {
        setCurrentExecutingStep(i);
        const step = plan.steps[i];

        if (step.can_automate) {
          await executeStep(step);
        }

        // Wait a bit for UI update
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setCurrentStep('complete');
    } catch (err) {
      setError(String(err));
      setCurrentStep('error');
    }
  };

  const handleClose = () => {
    setCurrentStep('input');
    setPlan(null);
    setError(null);
    setCurrentExecutingStep(0);
    onClose();
  };

  const renderInputStep = () => (
    <>
      <DialogTitle>Space Reallocation Wizard</DialogTitle>
      <DialogContent className={styles.content}>
        <div className={styles.summary}>
          <Text size={400} weight="semibold">
            Give more space to {partition.device_path}
          </Text>
          <Text size={300}>
            Current size: {formatBytes(partition.total_size)}
          </Text>
          <Text size={300}>
            Desired additional space: {formatBytes(desiredSpace)}
          </Text>
          <Text size={300}>
            New size: {formatBytes(partition.total_size + desiredSpace)}
          </Text>
        </div>

        <MessageBar intent="info">
          <Info24Regular />
          <Text>
            This wizard will analyze your disk and create a step-by-step plan to reallocate space.
            You may need to backup and delete other partitions.
          </Text>
        </MessageBar>
      </DialogContent>
      <DialogActions>
        <Button appearance="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button appearance="primary" onClick={createPlan}>
          Analyze Disk
        </Button>
      </DialogActions>
    </>
  );

  const renderAnalyzingStep = () => (
    <>
      <DialogTitle>Analyzing Disk Layout</DialogTitle>
      <DialogContent className={styles.content}>
        <div className={styles.spinnerContainer}>
          <Spinner size="large" />
          <Text size={400}>Analyzing partition layout and creating reallocation plan...</Text>
        </div>
      </DialogContent>
    </>
  );

  const renderPlanStep = () => {
    if (!plan) return null;

    return (
      <>
        <DialogTitle>Space Reallocation Plan</DialogTitle>
        <DialogContent className={styles.content}>
          {/* Warnings */}
          {plan.warnings.length > 0 && (
            <div className={styles.warningsSection}>
              {plan.warnings.map((warning, idx) => (
                <MessageBar key={idx} intent="warning">
                  <Warning24Regular />
                  <Text>{warning}</Text>
                </MessageBar>
              ))}
            </div>
          )}

          {/* Summary */}
          <Card className={styles.summaryCard}>
            <CardHeader
              header={<Text weight="semibold">Summary</Text>}
            />
            <div className={styles.summaryGrid}>
              <Text>Partitions to delete:</Text>
              <Text weight="semibold">{plan.source_partitions.length}</Text>

              <Text>Space to be freed:</Text>
              <Text weight="semibold">{formatBytes(plan.total_space_freed)}</Text>

              <Text>New size for {partition.device_path}:</Text>
              <Text weight="semibold">{formatBytes(plan.target_new_size)}</Text>
            </div>
          </Card>

          {/* Source Partitions */}
          {plan.source_partitions.length > 0 && (
            <div className={styles.section}>
              <Text size={400} weight="semibold" className={styles.sectionTitle}>
                Partitions that will be deleted:
              </Text>
              {plan.source_partitions.map((source, idx) => (
                <Card key={idx} className={styles.partitionCard}>
                  <div className={styles.partitionInfo}>
                    <Delete24Regular className={styles.iconDelete} />
                    <div>
                      <Text weight="semibold">{source.partition_label}</Text>
                      <Text size={200}>
                        Size: {formatBytes(source.current_size)}
                        {source.used_space && ` • Used: ${formatBytes(source.used_space)}`}
                      </Text>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <Divider />

          {/* Steps */}
          <div className={styles.section}>
            <Text size={400} weight="semibold" className={styles.sectionTitle}>
              Steps to complete:
            </Text>
            {plan.steps.map((step, idx) => (
              <Card key={idx} className={styles.stepCard}>
                <div className={styles.stepHeader}>
                  <div className={styles.stepNumber}>{step.step_number}</div>
                  <div className={styles.stepContent}>
                    <Text weight="semibold">{step.title}</Text>
                    <Text size={200}>{step.description}</Text>
                    <div className={styles.stepMeta}>
                      {step.action_type === 'UserManual' && (
                        <Text size={200} className={styles.manualBadge}>Manual Action Required</Text>
                      )}
                      {step.action_type === 'AppAutomated' && (
                        <Text size={200} className={styles.automatedBadge}>Automated</Text>
                      )}
                      {step.action_type === 'AppAssistedManual' && (
                        <Text size={200} className={styles.assistedBadge}>Guided</Text>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </DialogContent>
        <DialogActions>
          <Button appearance="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button appearance="primary" onClick={executePlan} disabled={plan.warnings.length === 0}>
            {plan.warnings.length > 0 ? 'I have backed up my data - Continue' : 'Execute Plan'}
          </Button>
        </DialogActions>
      </>
    );
  };

  const renderExecutingStep = () => {
    if (!plan) return null;

    const progress = ((currentExecutingStep + 1) / plan.steps.length) * 100;

    return (
      <>
        <DialogTitle>Executing Plan</DialogTitle>
        <DialogContent className={styles.content}>
          <div className={styles.executingContainer}>
            <Text size={400} weight="semibold">
              Step {currentExecutingStep + 1} of {plan.steps.length}
            </Text>
            <Text>{plan.steps[currentExecutingStep]?.title}</Text>
            <ProgressBar value={progress / 100} />
            <Text size={200}>{progress.toFixed(0)}% complete</Text>
          </div>

          {/* Show completed and upcoming steps */}
          <div className={styles.stepsProgress}>
            {plan.steps.map((step, idx) => (
              <div
                key={idx}
                className={`${styles.stepProgressItem} ${
                  idx < currentExecutingStep ? styles.completed :
                  idx === currentExecutingStep ? styles.current :
                  styles.pending
                }`}
              >
                {idx < currentExecutingStep && <CheckmarkCircle24Regular className={styles.checkIcon} />}
                <Text size={200}>{step.title}</Text>
              </div>
            ))}
          </div>
        </DialogContent>
      </>
    );
  };

  const renderCompleteStep = () => (
    <>
      <DialogTitle>Reallocation Complete!</DialogTitle>
      <DialogContent className={styles.content}>
        <div className={styles.successContainer}>
          <CheckmarkCircle24Regular className={styles.successIcon} />
          <Text size={500} weight="semibold">
            Space reallocation completed successfully!
          </Text>
          <Text size={300}>
            {partition.device_path} has been expanded to {formatBytes(plan?.target_new_size || 0)}
          </Text>
        </div>
      </DialogContent>
      <DialogActions>
        <Button appearance="primary" onClick={handleClose}>
          Done
        </Button>
      </DialogActions>
    </>
  );

  const renderErrorStep = () => (
    <>
      <DialogTitle>Error</DialogTitle>
      <DialogContent className={styles.content}>
        <MessageBar intent="error">
          <Text>{error || 'An unknown error occurred'}</Text>
        </MessageBar>
      </DialogContent>
      <DialogActions>
        <Button appearance="secondary" onClick={() => setCurrentStep('input')}>
          Try Again
        </Button>
        <Button appearance="primary" onClick={handleClose}>
          Close
        </Button>
      </DialogActions>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && handleClose()}>
      <DialogSurface className={styles.dialog}>
        <DialogBody>
          {currentStep === 'input' && renderInputStep()}
          {currentStep === 'analyzing' && renderAnalyzingStep()}
          {currentStep === 'plan' && renderPlanStep()}
          {currentStep === 'executing' && renderExecutingStep()}
          {currentStep === 'complete' && renderCompleteStep()}
          {currentStep === 'error' && renderErrorStep()}
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
