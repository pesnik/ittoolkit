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
  Input,
  Label,
  Field,
} from '@fluentui/react-components';
import styles from './SpaceInputDialog.module.css';

interface SpaceInputDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (spaceInGB: number) => void;
  partitionName: string;
}

export const SpaceInputDialog: React.FC<SpaceInputDialogProps> = ({
  open,
  onClose,
  onConfirm,
  partitionName,
}) => {
  const [spaceGB, setSpaceGB] = useState<string>('10');

  const handleConfirm = () => {
    const value = parseFloat(spaceGB);
    if (!isNaN(value) && value > 0) {
      onConfirm(value);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface className={styles.dialog}>
        <DialogBody>
          <DialogTitle>Take Space from Other Partitions</DialogTitle>
          <DialogContent className={styles.content}>
            <Text>
              How much additional space do you need for {partitionName}?
            </Text>

            <Field label="Additional Space (GB)">
              <Input
                type="number"
                value={spaceGB}
                onChange={(_, data) => setSpaceGB(data.value)}
                min={1}
                step={1}
              />
            </Field>

            <Text size={200} style={{ marginTop: '8px', opacity: 0.8 }}>
              <strong>How this works:</strong>
            </Text>
            <ul style={{ marginTop: '4px', opacity: 0.8, fontSize: '12px', paddingLeft: '20px' }}>
              <li>We'll shrink other partitions (like E: or F:) to create free space</li>
              <li>If needed, we'll move partitions to make the free space adjacent</li>
              <li>Then we'll expand {partitionName} into the freed space</li>
            </ul>
            <Text size={200} style={{ marginTop: '8px', opacity: 0.8, fontStyle: 'italic' }}>
              ⚠️ You'll need to back up any data on partitions that will be modified.
            </Text>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={handleConfirm}>
              Analyze Disk
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
