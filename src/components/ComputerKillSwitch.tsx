'use client';

/**
 * ComputerKillSwitch — floating abort widget for in-flight computer-use
 * actions (CU-M3).
 *
 * Visibility: only rendered when a write tool is between "approved" and
 * "dispatched" (the 250 ms pre-action pause). The Tauri side accepts a
 * `computer_kill` invocation that sets a sticky abort flag so the next
 * `execute_write` refuses to dispatch.
 *
 * Triple-Esc kill: Escape pressed three times within 600 ms also fires
 * the abort. Registered as a window keydown listener so it works even
 * when the AIPanel is collapsed. (A *global* hotkey via Tauri's plugin
 * is a Phase 3 nice-to-have; the in-app listener is enough for now and
 * doesn't require an extra permission grant on macOS.)
 */

import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { makeStyles, tokens, Button, Text } from '@fluentui/react-components';
import { DismissCircle24Filled } from '@fluentui/react-icons';

const useStyles = makeStyles({
    root: {
        position: 'fixed',
        top: '16px',
        right: '16px',
        background: 'rgba(209, 52, 56, 0.95)',
        color: 'white',
        padding: '10px 14px',
        borderRadius: '999px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer',
        userSelect: 'none',
        ':hover': {
            background: 'rgba(168, 39, 42, 0.95)',
        },
    },
    pill: {
        fontSize: '11px',
        background: 'rgba(255,255,255,0.18)',
        padding: '2px 6px',
        borderRadius: '999px',
    },
});

export function ComputerKillSwitch() {
    const styles = useStyles();
    const [active, setActive] = useState(false);
    const [aborted, setAborted] = useState<string | null>(null);
    const escTimestamps = useRef<number[]>([]);

    useEffect(() => {
        // Show the widget when a computer-action is queued to fire. The
        // dispatcher in inference-with-tools.ts emits this when it routes
        // a write call into the 250 ms pre-action pause; the Rust side
        // emits computer-action-aborted when the abort flag fires.
        const onActive = () => setActive(true);
        const onSettled = () => setActive(false);
        window.addEventListener('computer-action-pending', onActive);
        window.addEventListener('computer-action-settled', onSettled);

        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            const now = Date.now();
            escTimestamps.current = escTimestamps.current.filter((t) => now - t < 600);
            escTimestamps.current.push(now);
            if (escTimestamps.current.length >= 3) {
                escTimestamps.current = [];
                void invoke('computer_kill').catch((err) => console.warn('computer_kill failed:', err));
            }
        };
        window.addEventListener('keydown', onKey);

        return () => {
            window.removeEventListener('computer-action-pending', onActive);
            window.removeEventListener('computer-action-settled', onSettled);
            window.removeEventListener('keydown', onKey);
        };
    }, []);

    useEffect(() => {
        // Tauri event from the Rust side when the abort flag fires.
        let unlisten: (() => void) | undefined;
        (async () => {
            const { listen } = await import('@tauri-apps/api/event');
            const off = await listen<string>('computer-action-aborted', (event) => {
                setAborted(typeof event.payload === 'string' ? event.payload : 'computer action');
                setTimeout(() => setAborted(null), 4000);
            });
            unlisten = off;
        })();
        return () => { unlisten?.(); };
    }, []);

    if (!active && !aborted) return null;

    return (
        <div
            className={styles.root}
            onClick={() => {
                void invoke('computer_kill').catch((err) => console.warn('computer_kill failed:', err));
            }}
            title="Click or press Esc three times to abort the in-flight computer action"
        >
            <DismissCircle24Filled />
            <Text size={300} weight="semibold" style={{ color: 'white' }}>
                {aborted ? `Aborted: ${aborted}` : 'Stop computer action'}
            </Text>
            <span className={styles.pill}>Esc ×3</span>
        </div>
    );
}

export default ComputerKillSwitch;
