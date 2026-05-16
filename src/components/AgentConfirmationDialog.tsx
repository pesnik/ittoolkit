'use client';

import React from 'react';
import {
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Text,
    makeStyles,
    shorthands,
    tokens,
} from '@fluentui/react-components';
import {
    Warning20Regular,
    ErrorCircle20Regular,
    Info20Regular,
} from '@fluentui/react-icons';

const useStyles = makeStyles({
    severityBadge: {
        display: 'inline-flex',
        alignItems: 'center',
        ...shorthands.gap('4px'),
        ...shorthands.padding('4px', '8px'),
        ...shorthands.borderRadius('4px'),
        fontSize: '12px',
        fontWeight: 600,
        textTransform: 'uppercase',
    },
    severityLow: {
        backgroundColor: tokens.colorPaletteLightGreenBackground2,
        color: tokens.colorPaletteLightGreenForeground1,
    },
    severityMedium: {
        backgroundColor: tokens.colorPaletteYellowBackground2,
        color: tokens.colorPaletteYellowForeground1,
    },
    severityHigh: {
        backgroundColor: tokens.colorPaletteRedBackground2,
        color: tokens.colorPaletteRedForeground1,
    },
    itemList: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('4px'),
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.padding('12px'),
        ...shorthands.borderRadius('8px'),
        maxHeight: '200px',
        overflowY: 'auto',
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    },
    item: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
        fontSize: '13px',
        fontFamily: 'monospace',
    },
    sizeText: {
        fontSize: '14px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
    },
    description: {
        fontSize: '14px',
        color: tokens.colorNeutralForeground2,
        lineHeight: 1.4,
    },
    titleRow: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
        marginBottom: '8px',
    },
    content: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('16px'),
    },
    sizeRow: {
        display: 'flex',
        ...shorthands.gap('16px'),
    },
});

export interface ConfirmationPayload {
    title: string;
    description: string;
    items: string[];
    totalSize: number;
    severity: 'low' | 'medium' | 'high';
    actionId: string;
}

interface AgentConfirmationDialogProps {
    open: boolean;
    payload: ConfirmationPayload | null;
    onConfirm: (actionId: string) => void;
    onCancel: (actionId: string) => void;
}

function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);
    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function AgentConfirmationDialog({
    open,
    payload,
    onConfirm,
    onCancel,
}: AgentConfirmationDialogProps) {
    const styles = useStyles();

    if (!payload) return null;

    const severityLabel = payload.severity === 'high' ? 'High Risk'
        : payload.severity === 'medium' ? 'Medium Risk'
        : 'Low Risk';

    const SeverityIcon = payload.severity === 'high' ? ErrorCircle20Regular
        : payload.severity === 'medium' ? Warning20Regular
        : Info20Regular;

    const severityClass = payload.severity === 'high' ? styles.severityHigh
        : payload.severity === 'medium' ? styles.severityMedium
        : styles.severityLow;

    return (
        <Dialog open={open}>
            <DialogSurface>
                <DialogBody>
                    <div className={styles.titleRow}>
                        <DialogTitle>{payload.title}</DialogTitle>
                        <span className={`${styles.severityBadge} ${severityClass}`}>
                            <SeverityIcon fontSize={14} />
                            {severityLabel}
                        </span>
                    </div>
                    <DialogContent>
                        <div className={styles.content}>
                            <Text className={styles.description}>
                                {payload.description}
                            </Text>

                            {payload.items.length > 0 && (
                                <div>
                                    <Text weight="semibold" size={200}>
                                        Items ({payload.items.length})
                                    </Text>
                                    <div className={styles.itemList}>
                                        {payload.items.map((item, i) => (
                                            <div key={i} className={styles.item}>
                                                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{i + 1}.</Text>
                                                <Text>{item}</Text>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className={styles.sizeRow}>
                                {payload.totalSize > 0 && (
                                    <div>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Total Size</Text>
                                        <div className={styles.sizeText}>{formatSize(payload.totalSize)}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="secondary"
                            onClick={() => onCancel(payload.actionId)}
                        >
                            Cancel
                        </Button>
                        <Button
                            appearance="primary"
                            style={payload.severity === 'high' ? { backgroundColor: '#d13438', color: 'white' } as React.CSSProperties : undefined}
                            onClick={() => onConfirm(payload.actionId)}
                        >
                            {payload.severity === 'high' ? 'Proceed Anyway' : 'Confirm'}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
