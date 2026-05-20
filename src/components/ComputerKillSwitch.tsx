'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { makeStyles, tokens, Text, Button } from '@fluentui/react-components';
import { Dismiss20Regular } from '@fluentui/react-icons';
import { invoke } from '@tauri-apps/api/core';

const ESCAPE_TIMEOUT_MS = 600;
const KILL_EVENT = 'computer-action-pending';
const SETTLE_EVENT = 'computer-action-settled';

const useStyles = makeStyles({
    overlay: {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
        background: tokens.colorPaletteDarkOrangeBackground3,
        border: `2px solid ${tokens.colorPaletteDarkOrangeBorder2}`,
        borderRadius: '999px',
        padding: '14px 22px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        pointerEvents: 'auto',
        cursor: 'pointer',
    },
    text: {
        color: tokens.colorNeutralForeground1,
        fontWeight: 600,
        fontSize: '14px',
    },
});

export function ComputerKillSwitch() {
    const styles = useStyles();
    const [visible, setVisible] = useState(false);
    const [intent, setIntent] = useState('');
    const escBuffer = useRef<number[]>([]);

    const kill = useCallback(async () => {
        try {
            await invoke('computer_kill');
        } catch { /* ignore */ }
        setVisible(false);
    }, []);

    // Listen for pending/settled events from the inference loop
    useEffect(() => {
        const show = (e: Event) => {
            const d = (e as CustomEvent).detail as { intent?: string } | undefined;
            if (d?.intent) setIntent(d.intent);
            setVisible(true);
        };
        const hide = () => { setVisible(false); setIntent(''); };
        window.addEventListener(KILL_EVENT, show as EventListener);
        window.addEventListener(SETTLE_EVENT, hide as EventListener);
        return () => {
            window.removeEventListener(KILL_EVENT, show as EventListener);
            window.removeEventListener(SETTLE_EVENT, hide as EventListener);
        };
    }, []);

    // Triple-Escape detection
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            const now = Date.now();
            escBuffer.current = escBuffer.current.filter(t => now - t < ESCAPE_TIMEOUT_MS);
            escBuffer.current.push(now);
            if (escBuffer.current.length >= 3) {
                escBuffer.current = [];
                kill();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [kill]);

    if (!visible) return null;

    return (
        <div className={styles.overlay} onClick={kill} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') kill(); }}>
            <Text className={styles.text}>Stop computer action</Text>
            {intent && <Text className={styles.text} style={{ opacity: 0.8, fontSize: 12 }}>{intent}</Text>}
            <Button
                appearance="primary"
                icon={<Dismiss20Regular />}
                size="small"
                onClick={(e) => { e.stopPropagation(); kill(); }}
                style={{ minWidth: 0, background: tokens.colorPaletteRedBackground3 }}
            />
        </div>
    );
}

export default ComputerKillSwitch;
