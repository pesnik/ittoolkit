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
    status: 'executing' | 'success' | 'error';
}

interface ToolCallDisplayProps {
    execution: ToolExecutionData;
}

export function ToolCallDisplay({ execution }: ToolCallDisplayProps) {
    const styles = useStyles();
    const [isExpanded, setIsExpanded] = useState(false);

    const getStatusIcon = () => {
        switch (execution.status) {
            case 'executing':
                return <ArrowSync16Regular className={styles.statusIcon} />;
            case 'success':
                return <CheckmarkCircle16Regular className={styles.statusIcon} style={{ color: tokens.colorPaletteGreenForeground1 }} />;
            case 'error':
                return <ErrorCircle16Regular className={styles.statusIcon} style={{ color: tokens.colorPaletteRedForeground1 }} />;
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
        }
    };

    const getToolDisplayName = (toolName: string): string => {
        // Convert tool names to human-readable format
        const nameMap: Record<string, string> = {
            'read_file': 'Read File',
            'list_directory': 'List Directory',
            'search_files': 'Search Files',
            'write_file': 'Write File',
            'execute_command': 'Execute Command',
            'get_file_info': 'Get File Info',
        };
        return nameMap[toolName] || toolName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
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
                        Used {getToolDisplayName(execution.toolName)}
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
