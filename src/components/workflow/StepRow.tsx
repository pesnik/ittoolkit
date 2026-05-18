'use client';

import React, { useState } from 'react';
import { makeStyles, tokens, Text, Button } from '@fluentui/react-components';
import {
    CheckmarkCircle16Filled,
    ErrorCircle16Filled,
    DismissCircle16Filled,
    ArrowSync16Regular,
    Pause16Regular,
    Sparkle16Regular,
    Bot16Regular,
    Person16Regular,
    ChevronDown12Regular,
    ChevronUp12Regular,
} from '@fluentui/react-icons';
import type { StepRunStatus, ActorKind } from '@/types/workflow-types';

interface StepRowProps {
    index: number;
    intent: string;
    tool: string;
    actor: ActorKind;
    classification: string;
    status: StepRunStatus;
    attemptCount: number;
    maxAuto: number;
    agentReasoning?: string;
    errorMessage?: string;
    screenshot?: string;
    observedUrl?: string;
}

const ACTOR_ICON: Record<ActorKind, React.ReactNode> = {
    auto: <Bot16Regular />,
    agent: <Sparkle16Regular />,
    human: <Person16Regular />,
};

const ACTOR_COLOR: Record<ActorKind, string> = {
    auto: tokens.colorPaletteGreenForeground1,
    agent: tokens.colorPaletteBlueForeground2,
    human: tokens.colorPaletteGoldForeground2,
};

const useStyles = makeStyles({
    row: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '7px 10px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        ':last-child': { borderBottom: 'none' },
    },
    index: {
        width: '20px',
        textAlign: 'right',
        color: tokens.colorNeutralForeground3,
        fontSize: '12px',
        paddingTop: '2px',
        flexShrink: 0,
    },
    iconCol: {
        width: '18px',
        flexShrink: 0,
        paddingTop: '2px',
    },
    body: {
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    intentRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
    },
    meta: {
        fontSize: '11px',
        color: tokens.colorNeutralForeground3,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
    },
    actorBadge: {
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        fontSize: '11px',
    },
    retryBadge: {
        fontSize: '10px',
        padding: '0 5px',
        borderRadius: '3px',
        background: tokens.colorPaletteYellowBackground2,
        color: tokens.colorPaletteYellowForeground2,
    },
    agentBadge: {
        fontSize: '10px',
        padding: '0 5px',
        borderRadius: '3px',
        background: tokens.colorPaletteBlueForeground2 + '20',
        color: tokens.colorPaletteBlueForeground2,
    },
    errorText: {
        fontSize: '11px',
        color: tokens.colorPaletteRedForeground1,
        marginTop: '2px',
    },
    reasoning: {
        fontSize: '11px',
        color: tokens.colorNeutralForeground3,
        background: tokens.colorNeutralBackground3,
        borderRadius: '4px',
        padding: '4px 8px',
        marginTop: '4px',
    },
    screenshot: {
        width: '100%',
        maxHeight: '120px',
        objectFit: 'contain',
        borderRadius: '4px',
        marginTop: '4px',
        background: tokens.colorNeutralBackground3,
        cursor: 'pointer',
    },
});

function StatusIcon({ status }: { status: StepRunStatus }) {
    if (status === 'done') return <CheckmarkCircle16Filled color={tokens.colorPaletteGreenForeground1} />;
    if (status === 'failed') return <ErrorCircle16Filled color={tokens.colorPaletteRedForeground1} />;
    if (status === 'skipped') return <DismissCircle16Filled color={tokens.colorNeutralForeground3} />;
    if (status === 'running') return <ArrowSync16Regular style={{ animation: 'spin 1s linear infinite' }} />;
    if (status === 'agent_recovery') return <Sparkle16Regular color={tokens.colorPaletteBlueForeground2} />;
    if (status === 'awaiting_human_input' || status === 'awaiting_human_intervention') {
        return <Pause16Regular color={tokens.colorPaletteGoldForeground2} />;
    }
    if (status === 'verifying') return <ArrowSync16Regular />;
    return (
        <span style={{
            width: 14, height: 14, flexShrink: 0,
            border: `2px solid ${tokens.colorNeutralStroke2}`,
            borderRadius: '50%', display: 'inline-block',
        }} />
    );
}

export function StepRow({
    index,
    intent,
    tool,
    actor,
    classification,
    status,
    attemptCount,
    maxAuto,
    agentReasoning,
    errorMessage,
    screenshot,
    observedUrl,
}: StepRowProps) {
    const styles = useStyles();
    const [expanded, setExpanded] = useState(false);
    const hasDetails = !!(agentReasoning || errorMessage || screenshot);
    const showRetry = attemptCount > 0 && status !== 'done' && status !== 'skipped';
    const showAgentBadge = status === 'agent_recovery' || (agentReasoning && status === 'done');

    return (
        <div className={styles.row}>
            <span className={styles.index}>{index + 1}</span>
            <span className={styles.iconCol}>
                <StatusIcon status={status} />
            </span>
            <div className={styles.body}>
                <div className={styles.intentRow}>
                    <Text size={200} weight={status === 'running' || status === 'agent_recovery' ? 'semibold' : 'regular'}>
                        {intent || tool}
                    </Text>
                    {showRetry && (
                        <span className={styles.retryBadge}>
                            retry {attemptCount}/{maxAuto}
                        </span>
                    )}
                    {showAgentBadge && (
                        <span className={styles.agentBadge}>
                            🧠 agent
                        </span>
                    )}
                </div>
                <div className={styles.meta}>
                    <span className={styles.actorBadge} style={{ color: ACTOR_COLOR[actor] }}>
                        {ACTOR_ICON[actor]}
                        {actor}
                    </span>
                    <span>·</span>
                    <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '10px' }}>
                        {classification}
                    </span>
                    {observedUrl && (
                        <>
                            <span>·</span>
                            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {observedUrl}
                            </span>
                        </>
                    )}
                </div>

                {/* Expandable details */}
                {hasDetails && (
                    <button
                        style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, marginTop: 2, fontSize: 11, color: tokens.colorNeutralForeground3 }}
                        onClick={() => setExpanded((e) => !e)}
                    >
                        {expanded ? <ChevronUp12Regular /> : <ChevronDown12Regular />}
                        {expanded ? 'Hide details' : 'Show details'}
                    </button>
                )}

                {expanded && (
                    <>
                        {errorMessage && (
                            <Text className={styles.errorText}>{errorMessage}</Text>
                        )}
                        {agentReasoning && (
                            <div className={styles.reasoning}>
                                <Text size={100} style={{ fontStyle: 'italic' }}>
                                    🧠 {agentReasoning}
                                </Text>
                            </div>
                        )}
                        {screenshot && (
                            <img
                                src={`data:image/jpeg;base64,${screenshot}`}
                                alt="step state"
                                className={styles.screenshot}
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
