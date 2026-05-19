'use client';

// HumanGate — two flavours of human pause card:
//
//  HumanInputGate   — step.actor='human', needs form input before it can run
//  HumanInterventionGate — step failed all retries, user must fix in browser

import React, { useState } from 'react';
import { makeStyles, tokens, Text, Button, Input, Select } from '@fluentui/react-components';
import { Person20Regular, ErrorCircle20Regular, Sparkle16Regular } from '@fluentui/react-icons';
import type { HumanInput } from '@/types/workflow-types';

// ── HumanInputGate ─────────────────────────────────────────────────────────

interface HumanInputGateProps {
    prompt: string;
    inputs: HumanInput[];
    screenshot?: string;
    onSubmit(values: Record<string, unknown>): void;
    onSkip(): void;
}

const useInputStyles = makeStyles({
    card: {
        border: `1.5px solid ${tokens.colorPaletteBlueBorderActive}`,
        borderRadius: '8px',
        padding: '12px',
        background: '#eef5ff',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
    },
    header: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
    },
    fields: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    },
    field: {
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
    },
    actions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '8px',
        marginTop: '2px',
    },
    screenshot: {
        width: '100%',
        maxHeight: '160px',
        objectFit: 'contain',
        borderRadius: '4px',
        background: tokens.colorNeutralBackground1,
    },
});

export function HumanInputGate({ prompt, inputs, screenshot, onSubmit, onSkip }: HumanInputGateProps) {
    const styles = useInputStyles();
    const [values, setValues] = useState<Record<string, string>>(() =>
        Object.fromEntries(inputs.map((i) => [i.name, ''])),
    );

    const allRequired = inputs.filter((i) => i.required).every((i) => (values[i.name] ?? '').trim().length > 0);

    return (
        <div className={styles.card}>
            <div className={styles.header}>
                <Person20Regular style={{ flexShrink: 0, color: tokens.colorPaletteBlueForeground2, marginTop: 1 }} />
                <Text size={200}>{prompt}</Text>
            </div>

            {screenshot && (
                <img src={`data:image/jpeg;base64,${screenshot}`} alt="current state" className={styles.screenshot} />
            )}

            <div className={styles.fields}>
                {inputs.map((input) => (
                    <div key={input.name} className={styles.field}>
                        <Text size={100} weight="semibold" style={{ color: tokens.colorNeutralForeground2 }}>
                            {input.label}{input.required ? ' *' : ''}
                        </Text>
                        {input.type === 'select' ? (
                            <Select
                                value={values[input.name] ?? ''}
                                onChange={(_, d) => setValues((prev) => ({ ...prev, [input.name]: d.value }))}
                            >
                                <option value="">— select —</option>
                                {(input.options ?? []).map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </Select>
                        ) : (
                            <Input
                                type={input.type === 'password' ? 'password' : 'text'}
                                value={values[input.name] ?? ''}
                                onChange={(_, d) => setValues((prev) => ({ ...prev, [input.name]: d.value }))}
                            />
                        )}
                    </div>
                ))}
            </div>

            <div className={styles.actions}>
                <Button size="small" appearance="subtle" onClick={onSkip}>Skip step</Button>
                <Button
                    size="small"
                    appearance="primary"
                    disabled={!allRequired}
                    onClick={() => onSubmit(values)}
                >
                    Continue
                </Button>
            </div>
        </div>
    );
}

// ── HumanInterventionGate ──────────────────────────────────────────────────

interface HumanInterventionGateProps {
    message: string;
    agentReasoning?: string;
    screenshot?: string;
    onResume(): void;
    onSkip(): void;
    onAbort(): void;
}

const useInterventionStyles = makeStyles({
    card: {
        border: `1.5px solid ${tokens.colorPaletteRedBorder2}`,
        borderRadius: '8px',
        padding: '12px',
        background: tokens.colorNeutralBackground2,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
    },
    header: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
    },
    reasoning: {
        background: tokens.colorNeutralBackground2,
        borderRadius: '4px',
        padding: '6px 8px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
    },
    actions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '8px',
    },
    screenshot: {
        width: '100%',
        maxHeight: '160px',
        objectFit: 'contain',
        borderRadius: '4px',
        background: tokens.colorNeutralBackground1,
    },
});

export function HumanInterventionGate({ message, agentReasoning, screenshot, onResume, onSkip, onAbort }: HumanInterventionGateProps) {
    const styles = useInterventionStyles();

    return (
        <div className={styles.card}>
            <div className={styles.header}>
                <ErrorCircle20Regular style={{ flexShrink: 0, color: tokens.colorPaletteRedForeground1, marginTop: 1 }} />
                <Text size={200}>{message}</Text>
            </div>

            {screenshot && (
                <img src={`data:image/jpeg;base64,${screenshot}`} alt="failure state" className={styles.screenshot} />
            )}

            {agentReasoning && (
                <div className={styles.reasoning}>
                    <Sparkle16Regular style={{ flexShrink: 0, color: tokens.colorPaletteBlueForeground2, marginTop: 1 }} />
                    <Text size={100} style={{ fontStyle: 'italic', color: tokens.colorNeutralForeground2 }}>
                        {agentReasoning}
                    </Text>
                </div>
            )}

            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                Fix the issue in the browser above, then click <strong>Resume</strong>.
            </Text>

            <div className={styles.actions}>
                <Button size="small" onClick={onAbort}>Abort workflow</Button>
                <Button size="small" appearance="subtle" onClick={onSkip}>Skip step</Button>
                <Button size="small" appearance="primary" onClick={onResume}>Resume</Button>
            </div>
        </div>
    );
}
