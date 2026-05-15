'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
    makeStyles,
    tokens,
    shorthands,
    Text,
    Button,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
} from '@fluentui/react-components';
import {
    Add24Regular,
    Delete16Regular,
    PanelLeftContract24Regular,
} from '@fluentui/react-icons';
import { listConversations, deleteConversation } from '@/lib/conversations/store';
import { ConversationSummary } from '@/types/ai-types';

const useStyles = makeStyles({
    sidebar: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '260px',
        flexShrink: 0,
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.borderRight('1px', 'solid', tokens.colorNeutralStroke1),
        overflow: 'hidden',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        ...shorthands.padding('8px', '8px'),
        ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke2),
        ...shorthands.gap('4px'),
    },
    newButton: { flex: 1 },
    list: {
        flex: 1,
        overflowY: 'auto',
        ...shorthands.padding('4px'),
    },
    row: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.padding('8px', '10px'),
        ...shorthands.borderRadius('6px'),
        ...shorthands.gap('2px'),
        cursor: 'pointer',
        position: 'relative',
        ':hover': { backgroundColor: tokens.colorNeutralBackground3 },
    },
    rowActive: {
        backgroundColor: tokens.colorNeutralBackground3,
        ...shorthands.borderLeft('3px', 'solid', tokens.colorBrandForeground1),
    },
    rowTitle: {
        fontSize: '13px',
        fontWeight: 500,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    rowMeta: {
        fontSize: '11px',
        color: tokens.colorNeutralForeground3,
    },
    deleteBtn: {
        position: 'absolute',
        top: '4px',
        right: '4px',
        opacity: 0,
        ':hover': { opacity: 1 },
    },
    rowHover: {
        ':hover > button': { opacity: 1 },
    },
    empty: {
        ...shorthands.padding('16px'),
        textAlign: 'center',
        color: tokens.colorNeutralForeground3,
        fontSize: '12px',
    },
});

interface HistorySidebarProps {
    visible: boolean;
    onClose: () => void;
    activeConversationId: string | null;
    onSelect: (id: string) => void;
    onNew: () => void;
    refreshKey?: number;
}

function formatRelative(iso: string): string {
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return '';
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
    visible,
    onClose,
    activeConversationId,
    onSelect,
    onNew,
    refreshKey = 0,
}) => {
    const styles = useStyles();
    const [items, setItems] = useState<ConversationSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const list = await listConversations();
            setItems(list);
        } catch (e) {
            console.error('[HistorySidebar] Failed to list conversations:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (visible) void reload();
    }, [reload, refreshKey, visible]);

    const handleDeleteClick = useCallback(
        (e: React.MouseEvent, item: ConversationSummary) => {
            e.stopPropagation();
            // Native window.confirm is silently blocked in the Tauri webview, so
            // we open an in-app Fluent Dialog and run the delete after the user
            // confirms there.
            setPendingDelete(item);
        },
        []
    );

    const confirmDelete = useCallback(async () => {
        if (!pendingDelete) return;
        const id = pendingDelete.id;
        setPendingDelete(null);
        try {
            await deleteConversation(id);
            await reload();
            if (id === activeConversationId) onNew();
        } catch (err) {
            console.error('[HistorySidebar] Failed to delete:', err);
        }
    }, [pendingDelete, activeConversationId, onNew, reload]);

    if (!visible) return null;

    return (
        <div className={styles.sidebar}>
            <div className={styles.header}>
                <Button
                    appearance="primary"
                    icon={<Add24Regular />}
                    className={styles.newButton}
                    onClick={onNew}
                >
                    New chat
                </Button>
                <Button
                    appearance="subtle"
                    icon={<PanelLeftContract24Regular />}
                    onClick={onClose}
                    aria-label="Hide history sidebar"
                />
            </div>
            <div className={styles.list}>
                {loading && items.length === 0 && (
                    <div className={styles.empty}>Loading…</div>
                )}
                {!loading && items.length === 0 && (
                    <div className={styles.empty}>No conversations yet</div>
                )}
                {items.map((item) => {
                    const isActive = item.id === activeConversationId;
                    return (
                        <div
                            key={item.id}
                            className={`${styles.row} ${styles.rowHover} ${isActive ? styles.rowActive : ''}`}
                            onClick={() => onSelect(item.id)}
                            role="button"
                            tabIndex={0}
                        >
                            <Text className={styles.rowTitle} title={item.title}>
                                {item.title || 'Untitled'}
                            </Text>
                            <Text className={styles.rowMeta}>
                                {formatRelative(item.updated)}
                                {item.model ? ` • ${item.model}` : ''}
                            </Text>
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={<Delete16Regular />}
                                className={styles.deleteBtn}
                                onClick={(e) => handleDeleteClick(e, item)}
                                aria-label="Delete conversation"
                            />
                        </div>
                    );
                })}
            </div>

            <Dialog
                open={pendingDelete !== null}
                onOpenChange={(_, data) => !data.open && setPendingDelete(null)}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Delete this conversation?</DialogTitle>
                        <DialogContent>
                            <Text>
                                &ldquo;{pendingDelete?.title || 'Untitled'}&rdquo; will be
                                permanently removed from disk. This cannot be undone.
                            </Text>
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setPendingDelete(null)}>
                                Cancel
                            </Button>
                            <Button appearance="primary" onClick={() => void confirmDelete()}>
                                Delete
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </div>
    );
};
