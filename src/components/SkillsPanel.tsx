'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
    makeStyles,
    tokens,
    shorthands,
    Text,
    Button,
    Switch,
    Badge,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
} from '@fluentui/react-components';
import {
    Open24Regular,
    ArrowSync24Regular,
    Eye24Regular,
    ShieldCheckmark24Regular,
    Warning24Regular,
} from '@fluentui/react-icons';
import {
    listSkills,
    setSkillEnabled,
    setSkillTrusted,
    openSkillsFolder,
    getSkillSource,
} from '@/lib/skills/store';
import { SkillManifest } from '@/types/ai-types';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('12px'),
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        ...shorthands.gap('8px'),
    },
    list: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('8px'),
        maxHeight: '420px',
        overflowY: 'auto',
        ...shorthands.padding('4px'),
    },
    card: {
        ...shorthands.padding('12px'),
        ...shorthands.borderRadius('8px'),
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
        backgroundColor: tokens.colorNeutralBackground1,
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('6px'),
    },
    cardHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        ...shorthands.gap('8px'),
    },
    cardTitle: {
        fontWeight: 600,
        fontSize: '14px',
    },
    description: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground2,
    },
    badgesRow: {
        display: 'flex',
        ...shorthands.gap('6px'),
        flexWrap: 'wrap',
    },
    actionsRow: {
        display: 'flex',
        ...shorthands.gap('8px'),
        alignItems: 'center',
        marginTop: '4px',
    },
    emptyState: {
        ...shorthands.padding('24px'),
        textAlign: 'center',
        color: tokens.colorNeutralForeground3,
    },
    source: {
        whiteSpace: 'pre-wrap',
        fontFamily: 'monospace',
        fontSize: '12px',
        ...shorthands.padding('12px'),
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.borderRadius('6px'),
        maxHeight: '50vh',
        overflowY: 'auto',
    },
});

export const SkillsPanel: React.FC = () => {
    const styles = useStyles();
    const [skills, setSkills] = useState<SkillManifest[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewingSkill, setViewingSkill] = useState<{ name: string; source: string } | null>(null);
    const [pendingTrust, setPendingTrust] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const list = await listSkills();
            setSkills(list);
        } catch (e) {
            console.error('[SkillsPanel] Failed to list skills:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const handleToggleEnabled = useCallback(
        async (name: string, enabled: boolean) => {
            try {
                await setSkillEnabled(name, enabled);
                setSkills((prev) =>
                    prev.map((s) => (s.name === name ? { ...s, enabled } : s))
                );
            } catch (e) {
                console.error('[SkillsPanel] Failed to toggle enabled:', e);
            }
        },
        []
    );

    const applyTrust = useCallback(async (name: string, trusted: boolean) => {
        try {
            await setSkillTrusted(name, trusted);
            setSkills((prev) =>
                prev.map((s) => (s.name === name ? { ...s, trusted } : s))
            );
        } catch (e) {
            console.error('[SkillsPanel] Failed to toggle trusted:', e);
        }
    }, []);

    const handleToggleTrusted = useCallback(
        (name: string, nextTrusted: boolean) => {
            if (nextTrusted) {
                // Confirm via in-app dialog (native window.confirm is blocked in the Tauri webview)
                setPendingTrust(name);
                return;
            }
            void applyTrust(name, false);
        },
        [applyTrust]
    );

    const handleView = useCallback(async (name: string) => {
        try {
            const source = await getSkillSource(name);
            setViewingSkill({ name, source });
        } catch (e) {
            console.error('[SkillsPanel] Failed to load source:', e);
        }
    }, []);

    return (
        <div className={styles.container}>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                Skills are markdown procedures the agent can invoke. The model picks one
                automatically when its description matches, or the user can type{' '}
                <code>/skill-name</code>. Drop a folder with a <code>SKILL.md</code> in
                the skills directory to add a new one — no app restart needed (rescan
                on next open).
            </Text>

            <div className={styles.toolbar}>
                <Button
                    appearance="secondary"
                    icon={<Open24Regular />}
                    onClick={() => void openSkillsFolder()}
                >
                    Open skills folder
                </Button>
                <Button
                    appearance="subtle"
                    icon={<ArrowSync24Regular />}
                    onClick={() => void reload()}
                    disabled={loading}
                >
                    Rescan
                </Button>
            </div>

            <div className={styles.list}>
                {!loading && skills.length === 0 && (
                    <div className={styles.emptyState}>
                        <Text>No skills installed.</Text>
                    </div>
                )}
                {skills.map((skill) => (
                    <div key={skill.name} className={styles.card}>
                        <div className={styles.cardHeader}>
                            <Text className={styles.cardTitle}>/{skill.name}</Text>
                            <Switch
                                checked={skill.enabled}
                                onChange={(_, data) =>
                                    void handleToggleEnabled(skill.name, data.checked)
                                }
                                label={skill.enabled ? 'Enabled' : 'Disabled'}
                            />
                        </div>
                        <Text className={styles.description}>
                            {skill.description || '(no description)'}
                        </Text>
                        <div className={styles.badgesRow}>
                            {skill.disableModelInvocation && (
                                <Badge appearance="outline" color="informative">
                                    Manual only
                                </Badge>
                            )}
                            {!skill.userInvocable && (
                                <Badge appearance="outline" color="informative">
                                    Hidden from menu
                                </Badge>
                            )}
                            {skill.allowedTools.length > 0 && (
                                <Badge appearance="outline" color="brand">
                                    {skill.allowedTools.length} allowed-tools
                                </Badge>
                            )}
                            {skill.hasShellInjection && (
                                <Badge
                                    appearance="filled"
                                    color={skill.trusted ? 'success' : 'warning'}
                                    icon={
                                        skill.trusted ? (
                                            <ShieldCheckmark24Regular />
                                        ) : (
                                            <Warning24Regular />
                                        )
                                    }
                                >
                                    {skill.trusted
                                        ? 'Trusted (runs shell)'
                                        : 'Shell blocked — needs trust'}
                                </Badge>
                            )}
                        </div>
                        <div className={styles.actionsRow}>
                            <Button
                                appearance="subtle"
                                icon={<Eye24Regular />}
                                onClick={() => void handleView(skill.name)}
                            >
                                View SKILL.md
                            </Button>
                            {skill.hasShellInjection && (
                                <Button
                                    appearance="subtle"
                                    onClick={() =>
                                        void handleToggleTrusted(skill.name, !skill.trusted)
                                    }
                                >
                                    {skill.trusted ? 'Revoke trust' : 'Trust skill'}
                                </Button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <Dialog
                open={viewingSkill !== null}
                onOpenChange={(_, data) => !data.open && setViewingSkill(null)}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{viewingSkill?.name} — SKILL.md</DialogTitle>
                        <DialogContent>
                            <pre className={styles.source}>{viewingSkill?.source}</pre>
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="primary" onClick={() => setViewingSkill(null)}>
                                Close
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            <Dialog
                open={pendingTrust !== null}
                onOpenChange={(_, data) => !data.open && setPendingTrust(null)}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Trust skill /{pendingTrust}?</DialogTitle>
                        <DialogContent>
                            <Text>
                                Trusting a skill lets it run shell commands at load time
                                (the <code>!`cmd`</code> and <code>```!</code> blocks in
                                its SKILL.md). Only trust skills you have reviewed and
                                whose source you understand.
                            </Text>
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setPendingTrust(null)}>
                                Cancel
                            </Button>
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    const name = pendingTrust;
                                    setPendingTrust(null);
                                    if (name) void applyTrust(name, true);
                                }}
                            >
                                Trust skill
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </div>
    );
};
