'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
    Switch,
    Text,
    Label,
    Divider,
    Button,
    tokens,
} from '@fluentui/react-components';
import {
    FEATURE_FLAG_CHANGE_EVENT,
    FeatureFlag,
    featureFlags,
    getFeatureFlagDefault,
    isFeatureFlagOverridden,
    resetFeatureFlag,
    setFeatureFlag,
} from '@/lib/featureFlags';

interface FlagDescriptor {
    key: FeatureFlag;
    label: string;
    description: string;
}

const MEMORY_FLAGS: FlagDescriptor[] = [
    {
        key: 'memorySlidingWindow',
        label: 'Token-budget windowing',
        description:
            'Trim conversation history to fit a token budget before each call. Prevents runaway prompt sizes on long chats.',
    },
    {
        key: 'memoryRunningSummary',
        label: 'Running conversation summary',
        description:
            'When a chat grows past the threshold, generate a synthesis of decisions and in-flight task state. Re-prepended on every subsequent turn so reopening an old chat lands with context loaded.',
    },
    {
        key: 'memoryUserProfile',
        label: 'User profile (cross-conversation facts)',
        description:
            'Extract durable facts about you (role, preferences, ongoing projects) and inject them into every new conversation. Stored in ~/.ittoolkit/user_profile.md — you can edit or delete it directly.',
    },
    {
        key: 'memoryCrossConversationSearch',
        label: 'Cross-conversation search tool',
        description:
            'Expose a search_conversations tool the model can call when you reference prior chats ("the script we wrote last week").',
    },
    {
        key: 'memoryForgetting',
        label: 'Forgetting policy',
        description:
            'Drop profile facts older than 90 days that were reinforced fewer than 2 times. Annotate summaries older than 30 days as potentially stale.',
    },
];

interface FlagRowProps {
    descriptor: FlagDescriptor;
    onToggle: (key: FeatureFlag, value: boolean) => void;
    onReset: (key: FeatureFlag) => void;
    value: boolean;
    overridden: boolean;
}

const FlagRow: React.FC<FlagRowProps> = ({ descriptor, onToggle, onReset, value, overridden }) => (
    <div
        style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            padding: '12px 0',
        }}
    >
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
            }}
        >
            <Label htmlFor={`flag-${descriptor.key}`} weight="semibold">
                {descriptor.label}
            </Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {overridden && (
                    <Button
                        appearance="subtle"
                        size="small"
                        onClick={() => onReset(descriptor.key)}
                    >
                        Reset
                    </Button>
                )}
                <Switch
                    id={`flag-${descriptor.key}`}
                    checked={value}
                    onChange={(_, data) => onToggle(descriptor.key, data.checked)}
                />
            </div>
        </div>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {descriptor.description}
        </Text>
        {overridden && (
            <Text size={100} style={{ color: tokens.colorNeutralForeground4 }}>
                Default: {String(getFeatureFlagDefault(descriptor.key))}
            </Text>
        )}
    </div>
);

export const MemorySettingsSection: React.FC = () => {
    const [, forceRender] = useState(0);

    useEffect(() => {
        const handler = () => forceRender((n) => n + 1);
        window.addEventListener(FEATURE_FLAG_CHANGE_EVENT, handler);
        return () => window.removeEventListener(FEATURE_FLAG_CHANGE_EVENT, handler);
    }, []);

    const handleToggle = useCallback((key: FeatureFlag, value: boolean) => {
        setFeatureFlag(key, value);
    }, []);

    const handleReset = useCallback((key: FeatureFlag) => {
        resetFeatureFlag(key);
    }, []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div>
                <Text weight="semibold" size={400}>
                    Memory
                </Text>
                <Text
                    size={200}
                    block
                    style={{ color: tokens.colorNeutralForeground3, marginTop: '4px' }}
                >
                    What the agent remembers across this chat and across other chats. Toggle a
                    piece off if it misbehaves — the others keep working. Settings persist in this
                    browser only.
                </Text>
            </div>
            <Divider style={{ margin: '8px 0' }} />
            {MEMORY_FLAGS.map((flag) => (
                <React.Fragment key={flag.key}>
                    <FlagRow
                        descriptor={flag}
                        onToggle={handleToggle}
                        onReset={handleReset}
                        value={featureFlags[flag.key]}
                        overridden={isFeatureFlagOverridden(flag.key)}
                    />
                    <Divider />
                </React.Fragment>
            ))}
        </div>
    );
};
