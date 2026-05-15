'use client';

/**
 * Tool Call Display Component
 *
 * Displays tool execution in a user-friendly, collapsible format.
 * Follows standard patterns from ChatGPT, Claude, and OpenWebUI.
 */

import React, { useState } from 'react';
import {
    makeStyles,
    tokens,
    shorthands,
    Text,
    Button,
} from '@fluentui/react-components';
import {
    ChevronDown16Regular,
    ChevronUp16Regular,
    CheckmarkCircle16Regular,
    ErrorCircle16Regular,
    ArrowSync16Regular,
    Code16Regular,
    Wrench16Regular,
} from '@fluentui/react-icons';

const useStyles = makeStyles({
    container: {
        ...shorthands.margin('8px', '0'),
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
        ...shorthands.borderRadius('8px'),
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.overflow('hidden'),
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
        ...shorthands.padding('8px', '12px'),
        cursor: 'pointer',
        '&:hover': {
            backgroundColor: tokens.colorNeutralBackground3,
        },
    },
    headerLeft: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
        flex: 1,
    },
    icon: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusIcon: {
        display: 'flex',
        alignItems: 'center',
    },
    expandIcon: {
        display: 'flex',
        alignItems: 'center',
    },
    content: {
        ...shorthands.padding('0', '12px', '12px', '12px'),
        ...shorthands.borderTop('1px', 'solid', tokens.colorNeutralStroke2),
    },
    section: {
        marginBottom: '12px',
        '&:last-child': {
            marginBottom: 0,
        },
    },
    sectionTitle: {
        fontSize: '12px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground3,
        marginBottom: '4px',
        textTransform: 'uppercase',
    },
    codeBlock: {
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.padding('8px'),
        ...shorthands.borderRadius('4px'),
        fontFamily: 'monospace',
        fontSize: '12px',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: '200px',
        overflowY: 'auto',
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
    },
    inline: {
        display: 'inline-flex',
        alignItems: 'center',
        ...shorthands.gap('4px'),
    },
});

export interface ToolExecutionData {
    toolName: string;
    arguments: Record<string, unknown>;
    result?: string;
    error?: string;
    executionTimeMs?: number;
    status: 'executing' | 'success' | 'error' | 'cancelled';
}

interface ToolCallDisplayProps {
    execution: ToolExecutionData;
}

export function ToolCallDisplay({ execution }: ToolCallDisplayProps) {
    const styles = useStyles();
    const [isExpanded, setIsExpanded] = useState(true);

    const getStatusIcon = () => {
        switch (execution.status) {
            case 'executing':
                return <ArrowSync16Regular className={styles.statusIcon} />;
            case 'success':
                return <CheckmarkCircle16Regular className={styles.statusIcon} style={{ color: tokens.colorPaletteGreenForeground1 }} />;
            case 'error':
                return <ErrorCircle16Regular className={styles.statusIcon} style={{ color: tokens.colorPaletteRedForeground1 }} />;
            case 'cancelled':
                return <ErrorCircle16Regular className={styles.statusIcon} style={{ color: tokens.colorPaletteYellowForeground1 }} />;
        }
    };

    const getStatusText = () => {
        switch (execution.status) {
            case 'executing':
                return 'Executing...';
            case 'success':
                return execution.executionTimeMs ? `Completed in ${execution.executionTimeMs}ms` : 'Completed';
            case 'error':
                return 'Failed';
            case 'cancelled':
                return 'Cancelled';
        }
    };

    function getCommandIntent(cmd: string): string {
        const trimmed = cmd.trim();
        const firstWord = trimmed.split(/\s+/)[0] || '';

        const patterns: [RegExp, (m: RegExpMatchArray) => string][] = [
            [/^cat\s+(.+)/, (m) => `Read file: ${m[1].split(/\s+/)[0]}`],
            [/^ls\s+(.+)/, (m) => `List directory: ${m[1].split(/\s+/)[0]}`],
            [/^ls\b/, () => 'List directory contents'],
            [/^find\s/, () => 'Search for files'],
            [/^grep\s/, () => 'Search file contents'],
            [/^rm\s+(.+)/, (m) => `Remove file: ${m[1].split(/\s+/)[0]}`],
            [/^mv\s+(.+)/, (m) => `Move/rename: ${m[1].split(/\s+/)[0]}`],
            [/^cp\s+(.+)/, (m) => `Copy: ${m[1].split(/\s+/)[0]}`],
            [/^mkdir\s+(.+)/, (m) => `Create directory: ${m[1].split(/\s+/)[0]}`],
            [/^echo\s/, () => trimmed.includes('>') ? 'Write to file' : 'Output text'],
            [/^du\s/, () => 'Check disk usage'],
            [/^df\s/, () => 'Check disk space'],
            [/^pwd\b/, () => 'Show current directory'],
            [/^which\s+(.+)/, (m) => `Locate: ${m[1]}`],
            [/^uname\b/, () => 'Show system info'],
            [/^whoami\b/, () => 'Show current user'],
            [/^head\s+(.+)/, (m) => `Read start: ${m[1].split(/\s+/)[0]}`],
            [/^tail\s+(.+)/, (m) => `Read end: ${m[1].split(/\s+/)[0]}`],
            [/^wc\s+(.+)/, (m) => `Count: ${m[1].split(/\s+/)[0]}`],
            [/^sort\s+(.+)/, (m) => `Sort file: ${m[1].split(/\s+/)[0]}`],
            [/^diff\s/, () => 'Compare files'],
            [/^chmod\s/, () => 'Change permissions'],
            [/^file\s+(.+)/, (m) => `Identify: ${m[1].split(/\s+/)[0]}`],
            [/^stat\s+(.+)/, (m) => `Details: ${m[1].split(/\s+/)[0]}`],
        ];

        for (const [pattern, handler] of patterns) {
            const match = trimmed.match(pattern);
            if (match) return handler(match);
        }

        return `Execute: ${firstWord}`;
    }

    const getIntentLabel = (): string => {
        if (execution.toolName !== 'execute_command') {
            const nameMap: Record<string, string> = {
                'read_file': 'Read File',
                'list_directory': 'List Directory',
                'search_files': 'Search Files',
                'write_file': 'Write File',
                'get_file_info': 'Get File Info',
            };
            return nameMap[execution.toolName] || execution.toolName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }
        const cmd = execution.arguments?.cmd as string;
        if (cmd) return getCommandIntent(cmd);
        return 'Execute Command';
    };

    const formatArguments = (args: Record<string, unknown>): string => {
        // Format arguments in a readable way
        return Object.entries(args)
            .map(([key, value]) => {
                if (typeof value === 'string' && value.length > 100) {
                    return `${key}: ${value.substring(0, 100)}...`;
                }
                return `${key}: ${JSON.stringify(value)}`;
            })
            .join('\n');
    };

    return (
        <div className={styles.container}>
            <div className={styles.header} onClick={() => setIsExpanded(!isExpanded)}>
                <div className={styles.headerLeft}>
                    <div className={styles.icon}>
                        <Wrench16Regular />
                    </div>
                    <Text weight="semibold" size={300}>
                        {getIntentLabel()}
                    </Text>
                    {getStatusIcon()}
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                        {getStatusText()}
                    </Text>
                </div>
                <div className={styles.expandIcon}>
                    {isExpanded ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
                </div>
            </div>

            {isExpanded && (
                <div className={styles.content}>
                    {/* Arguments Section */}
                    <div className={styles.section}>
                        <div className={styles.sectionTitle}>Arguments</div>
                        <div className={styles.codeBlock}>
                            {formatArguments(execution.arguments)}
                        </div>
                    </div>

                    {/* Result Section (if available) */}
                    {execution.result && !execution.error && (
                        <div className={styles.section}>
                            <div className={styles.sectionTitle}>Result</div>
                            <div className={styles.codeBlock}>
                                {execution.result.length > 500
                                    ? `${execution.result.substring(0, 500)}...\n\n[Result truncated for display]`
                                    : execution.result
                                }
                            </div>
                        </div>
                    )}

                    {/* Error Section (if available) */}
                    {execution.error && (
                        <div className={styles.section}>
                            <div className={styles.sectionTitle}>Error</div>
                            <div className={styles.codeBlock} style={{ color: tokens.colorPaletteRedForeground1 }}>
                                {execution.error}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
