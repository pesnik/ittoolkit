'use client';

/**
 * McpServersPanel — settings UI for the MCP client (CU-M5).
 *
 * Lists external MCP servers configured in ~/.ittoolkit/mcp-clients.json,
 * lets the user add / edit / remove them, and runs a "Test" probe that
 * spawns the server and lists its tools. Tools surfaced here are
 * automatically registered each turn (via gatherMcpTools in ai-service)
 * and appear to the model as namespaced functions ("<server>__<tool>").
 *
 * Sits inside the existing Settings → AI panel, behind the existing
 * featureFlags.mcpServer toggle.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
    makeStyles,
    tokens,
    Text,
    Button,
    Input,
    Field,
    Spinner,
    Divider,
} from '@fluentui/react-components';
import {
    Add12Regular,
    Delete16Regular,
    PlayCircle16Regular,
    Save16Regular,
} from '@fluentui/react-icons';
import {
    listMcpServers,
    upsertMcpServer,
    removeMcpServer,
    mcpServerTools,
    type McpServerSpec,
    type McpToolDescriptor,
} from '@/lib/mcp/client';

interface FormState {
    id: string;
    command: string;
    args: string; // newline-separated
    env: string;  // KEY=value lines
}

const emptyForm: FormState = { id: '', command: '', args: '', env: '' };

function parseLines(text: string): string[] {
    return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

function parseEnv(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of parseLines(text)) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        out[line.slice(0, eq).trim()] = line.slice(eq + 1);
    }
    return out;
}

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
    },
    row: {
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: '8px',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
    },
    rowHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    rowName: {
        flex: 1,
        fontWeight: 600,
    },
    rowActions: {
        display: 'flex',
        gap: '6px',
    },
    form: {
        border: `1px dashed ${tokens.colorNeutralStroke2}`,
        borderRadius: '8px',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        background: tokens.colorNeutralBackground2,
    },
    toolList: {
        marginTop: '4px',
        background: tokens.colorNeutralBackground3,
        borderRadius: '4px',
        padding: '6px 10px',
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        whiteSpace: 'pre-wrap',
    },
    empty: {
        color: tokens.colorNeutralForeground3,
        padding: '20px',
        textAlign: 'center',
        border: `1px dashed ${tokens.colorNeutralStroke2}`,
        borderRadius: '8px',
    },
});

export function McpServersPanel() {
    const styles = useStyles();
    const [servers, setServers] = useState<Record<string, McpServerSpec>>({});
    const [editing, setEditing] = useState<FormState | null>(null);
    const [probeResult, setProbeResult] = useState<Record<string, McpToolDescriptor[] | string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const file = await listMcpServers();
            setServers(file.servers ?? {});
        } catch (e) {
            setError(String(e));
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const startAdd = () => {
        setProbeResult({});
        setEditing(emptyForm);
    };

    const startEdit = (id: string) => {
        const spec = servers[id];
        if (!spec) return;
        setEditing({
            id,
            command: spec.command,
            args: (spec.args ?? []).join('\n'),
            env: Object.entries(spec.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
        });
    };

    const save = async () => {
        if (!editing) return;
        const id = editing.id.trim();
        if (!id) { setError('Server id is required.'); return; }
        if (!editing.command.trim()) { setError('Command is required.'); return; }
        setBusy(true); setError(null);
        try {
            await upsertMcpServer(id, {
                command: editing.command.trim(),
                args: parseLines(editing.args),
                env: parseEnv(editing.env),
            });
            setEditing(null);
            await refresh();
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (id: string) => {
        setBusy(true); setError(null);
        try {
            await removeMcpServer(id);
            await refresh();
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    };

    const probe = async (id: string) => {
        setBusy(true); setError(null);
        setProbeResult((p) => ({ ...p, [id]: 'probing…' }));
        try {
            const tools = await mcpServerTools(id);
            setProbeResult((p) => ({ ...p, [id]: tools }));
        } catch (e) {
            setProbeResult((p) => ({ ...p, [id]: `Error: ${String(e)}` }));
        } finally {
            setBusy(false);
        }
    };

    const entries = Object.entries(servers);

    return (
        <div className={styles.root}>
            <div>
                <Text weight="semibold" size={400}>External MCP servers</Text>
                <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
                    Each configured server is spawned on demand. Its tools are surfaced to the model with
                    the name <code>{'<server-id>__<tool>'}</code> and routed through this app's existing
                    approval pipeline when classified as a write action. Edit
                    <code> ~/.ittoolkit/mcp-clients.json</code> directly or use the form below.
                </Text>
            </div>
            <Divider />

            {error && (
                <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>
            )}

            {entries.length === 0 && !editing && (
                <div className={styles.empty}>
                    <Text>No MCP servers configured.</Text>
                </div>
            )}

            {entries.map(([id, spec]) => (
                <div key={id} className={styles.row}>
                    <div className={styles.rowHeader}>
                        <Text className={styles.rowName}>{id}</Text>
                        <div className={styles.rowActions}>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<PlayCircle16Regular />}
                                onClick={() => probe(id)}
                                disabled={busy}
                            >
                                Test
                            </Button>
                            <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => startEdit(id)}
                                disabled={busy}
                            >
                                Edit
                            </Button>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Delete16Regular />}
                                onClick={() => remove(id)}
                                disabled={busy}
                            />
                        </div>
                    </div>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                        <code>{spec.command} {(spec.args ?? []).join(' ')}</code>
                    </Text>
                    {probeResult[id] !== undefined && (
                        <div className={styles.toolList}>
                            {Array.isArray(probeResult[id])
                                ? (probeResult[id] as McpToolDescriptor[]).length === 0
                                    ? '(no tools exposed)'
                                    : (probeResult[id] as McpToolDescriptor[])
                                          .map((t) => `• ${t.name} — ${t.description}`)
                                          .join('\n')
                                : String(probeResult[id])}
                        </div>
                    )}
                </div>
            ))}

            {editing && (
                <div className={styles.form}>
                    <Field label="Server id">
                        <Input
                            value={editing.id}
                            onChange={(_, d) => setEditing({ ...editing, id: d.value })}
                            placeholder="e.g. postgres-local"
                            disabled={busy}
                        />
                    </Field>
                    <Field label="Command">
                        <Input
                            value={editing.command}
                            onChange={(_, d) => setEditing({ ...editing, command: d.value })}
                            placeholder="e.g. uvx or /usr/local/bin/mcp-server-slack"
                            disabled={busy}
                        />
                    </Field>
                    <Field label="Args (one per line)">
                        <textarea
                            value={editing.args}
                            onChange={(e) => setEditing({ ...editing, args: e.target.value })}
                            rows={3}
                            placeholder={'mcp-server-postgres\n--db-url\npostgres://…'}
                            disabled={busy}
                            style={{
                                width: '100%',
                                fontFamily: 'ui-monospace, monospace',
                                fontSize: 12,
                                padding: 6,
                                borderRadius: 4,
                                border: `1px solid ${tokens.colorNeutralStroke2}`,
                                background: tokens.colorNeutralBackground1,
                                color: tokens.colorNeutralForeground1,
                            }}
                        />
                    </Field>
                    <Field label="Environment (KEY=value per line, optional)">
                        <textarea
                            value={editing.env}
                            onChange={(e) => setEditing({ ...editing, env: e.target.value })}
                            rows={2}
                            placeholder={'API_KEY=…\nDB_URL=…'}
                            disabled={busy}
                            style={{
                                width: '100%',
                                fontFamily: 'ui-monospace, monospace',
                                fontSize: 12,
                                padding: 6,
                                borderRadius: 4,
                                border: `1px solid ${tokens.colorNeutralStroke2}`,
                                background: tokens.colorNeutralBackground1,
                                color: tokens.colorNeutralForeground1,
                            }}
                        />
                    </Field>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <Button appearance="secondary" onClick={() => setEditing(null)} disabled={busy}>
                            Cancel
                        </Button>
                        <Button
                            appearance="primary"
                            icon={<Save16Regular />}
                            onClick={save}
                            disabled={busy || !editing.id.trim() || !editing.command.trim()}
                        >
                            Save
                        </Button>
                    </div>
                </div>
            )}

            {!editing && (
                <div>
                    <Button appearance="primary" icon={<Add12Regular />} onClick={startAdd} disabled={busy}>
                        Add MCP server
                    </Button>
                </div>
            )}

            {busy && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '8px' }}>
                    <Spinner size="tiny" />
                </div>
            )}
        </div>
    );
}

export default McpServersPanel;
