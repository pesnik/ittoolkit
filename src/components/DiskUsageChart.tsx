'use client';

import * as React from 'react';
import {
    Treemap, Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import { makeStyles, shorthands, Text, tokens } from '@fluentui/react-components';
import { FileNode } from '@/types';

const useStyles = makeStyles({
    container: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        ...shorthands.padding('10px'),
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.borderRadius('8px'),
    },
    title: {
        marginBottom: '4px',
        fontWeight: 'bold',
    },
    chartContainer: {
        width: '100%',
        flexGrow: 1,
        minHeight: '200px',
    },
});

interface DiskUsageChartProps {
    items: FileNode[];
    onNavigate?: (path: string) => void;
}

const COLORS = [
    '#0088FE', '#00C49F', '#FFBB28', '#FF8042',
    '#8884d8', '#82ca9d', '#a4de6c', '#d0ed57',
    '#ffc658', '#8dd1e1', '#a6cee3', '#1f78b4',
    '#b2df8a', '#33a02c', '#fb9a99', '#e31a1c',
    '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a',
];

function hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash);
}

function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const CustomTreemapContent = (props: any) => {
    const { x, y, width, height, name, formattedSize, isDir, fill } = props;

    if (width < 10 || height < 10 || !fill) return null;

    const isSmall = width < 45 || height < 28;

    return (
        <g>
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill={fill}
                stroke="#fff"
                strokeWidth={2}
                style={{ cursor: isDir ? 'pointer' : 'default' }}
            />
            {!isSmall && (
                <>
                    <text
                        x={x + width / 2}
                        y={y + height / 2 - 6}
                        textAnchor="middle"
                        fill="#fff"
                        fontSize={12}
                        fontWeight={600}
                        style={{ pointerEvents: 'none' }}
                    >
                        {name.length > Math.floor(width / 7)
                            ? name.substring(0, Math.max(3, Math.floor(width / 7) - 3)) + '\u2026'
                            : name
                        }
                    </text>
                    <text
                        x={x + width / 2}
                        y={y + height / 2 + 10}
                        textAnchor="middle"
                        fill="#fff"
                        fontSize={11}
                        opacity={0.85}
                        style={{ pointerEvents: 'none' }}
                    >
                        {formattedSize}
                    </text>
                </>
            )}
        </g>
    );
};

const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload[0]) return null;
    const data = payload[0].payload;

    return (
        <div style={{
            backgroundColor: tokens.colorNeutralBackground1,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: '8px',
            padding: '10px 14px',
            boxShadow: tokens.shadow16,
            maxWidth: '320px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                {data.isDir ? (
                    <span style={{ fontSize: '16px' }}>{'\uD83D\uDCC1'}</span>
                ) : (
                    <span style={{ fontSize: '16px' }}>{'\uD83D\uDCC4'}</span>
                )}
                <Text weight="semibold" size={300}>
                    {data.name}
                </Text>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                    Size: <Text weight="medium">{data.formattedSize || formatSize(data.value)}</Text>
                </Text>
                {data.path && (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground2, wordBreak: 'break-all' }}>
                        Path: <Text weight="medium">{data.path}</Text>
                    </Text>
                )}
                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                    Type: {data.isDir ? 'Folder' : 'File'}
                </Text>
            </div>
        </div>
    );
};

export const DiskUsageChart: React.FC<DiskUsageChartProps> = ({ items, onNavigate }) => {
    const styles = useStyles();

    const data = React.useMemo(() => {
        if (!items || items.length === 0) return [];

        return [...items]
            .filter(item => item.size > 0)
            .sort((a, b) => b.size - a.size)
            .map((item) => ({
                name: item.name,
                value: item.size,
                path: item.path,
                isDir: item.is_dir,
                formattedSize: formatSize(item.size),
                fill: item.is_dir
                    ? COLORS[hashCode(item.name) % COLORS.length]
                    : '#6b7280',
            }));
    }, [items]);

    const handleClick = (node: any) => {
        if (node && node.isDir && node.path && onNavigate) {
            onNavigate(node.path);
        }
    };

    if (data.length === 0) {
        return (
            <div className={styles.container}>
                <Text>No data to visualize</Text>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <Text className={styles.title} size={400}>Disk Usage Distribution</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginBottom: '8px' }}>
                Click a folder to navigate
            </Text>
            <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height="100%">
                    <Treemap
                        data={data}
                        dataKey="value"
                        nameKey="name"
                        aspectRatio={4 / 3}
                        stroke="#fff"
                        fill="#8884d8"
                        onClick={handleClick}
                        content={<CustomTreemapContent />}
                        isAnimationActive={false}
                    >
                        <RechartsTooltip content={<CustomTooltip />} />
                    </Treemap>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
