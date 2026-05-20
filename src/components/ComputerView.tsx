'use client';

import React, { useEffect, useState } from 'react';
import {
    makeStyles,
    tokens,
    Text,
} from '@fluentui/react-components';
import { ScreenshotRegular, Warning20Regular } from '@fluentui/react-icons';

interface ViewportState {
    screenshot?: string;
    width?: number;
    height?: number;
    displayIndex?: number;
    receivedAt?: number;
}

const useStyles = makeStyles({
    root: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
    },
    header: {
        padding: '10px 14px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexShrink: 0,
    },
    headerInfo: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: '0px',
    },
    body: {
        flex: 1,
        overflow: 'auto',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '16px',
        background: tokens.colorNeutralBackground2,
    },
    screenshot: {
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        background: 'white',
    },
    empty: {
        color: tokens.colorNeutralForeground3,
        textAlign: 'center',
        maxWidth: '520px',
        padding: '40px 20px',
    },
    pill: {
        background: tokens.colorNeutralBackground3,
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '11px',
        color: tokens.colorNeutralForeground2,
        whiteSpace: 'nowrap',
    },
});

export function ComputerView() {
    const styles = useStyles();
    const [state, setState] = useState<ViewportState>({});

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as ViewportState;
            if (!detail?.screenshot) return;
            setState({
                screenshot: detail.screenshot,
                width: detail.width,
                height: detail.height,
                displayIndex: detail.displayIndex,
                receivedAt: Date.now(),
            });
        };
        window.addEventListener('computer-view-update', handler as EventListener);
        return () => window.removeEventListener('computer-view-update', handler as EventListener);
    }, []);

    return (
        <div className={styles.root}>
            <div className={styles.header}>
                <ScreenshotRegular fontSize={18} />
                <div className={styles.headerInfo}>
                    <Text weight="semibold">Computer</Text>
                    {state.screenshot ? (
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                            {state.width} × {state.height}
                            {typeof state.displayIndex === 'number' ? ` · display ${state.displayIndex}` : ''}
                            {state.receivedAt ? ` · captured ${new Date(state.receivedAt).toLocaleTimeString()}` : ''}
                        </Text>
                    ) : (
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                            No screenshot yet.
                        </Text>
                    )}
                </div>
                {state.screenshot && (
                    <span className={styles.pill}>read-only</span>
                )}
            </div>
            <div className={styles.body}>
                {state.screenshot ? (
                    <img
                        src={`data:image/jpeg;base64,${state.screenshot}`}
                        alt="screen capture"
                        className={styles.screenshot}
                    />
                ) : (
                    <div className={styles.empty}>
                        <div style={{ marginBottom: 12 }}>
                            <Warning20Regular fontSize={20} style={{ verticalAlign: 'middle' }} />
                        </div>
                        <Text>
                            The agent has not taken a screenshot yet. Ask it to look at your screen
                            (e.g. <em>&ldquo;What window am I looking at right now?&rdquo;</em>) and the
                            captured image will appear here.
                        </Text>
                        <Text
                            size={200}
                            block
                            style={{ marginTop: 16, color: tokens.colorNeutralForeground3 }}
                        >
                            macOS users: the first screenshot will prompt for Screen Recording
                            permission. Grant it in System Settings → Privacy &amp; Security →
                            Screen Recording, then re-ask the agent.
                        </Text>
                    </div>
                )}
            </div>
        </div>
    );
}

export default ComputerView;
