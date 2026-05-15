'use client';

import React from 'react';
import {
    Dropdown,
    Combobox,
    Option,
    makeStyles,
    tokens,
    Badge,
    Text,
    shorthands,
} from '@fluentui/react-components';
import { ModelConfig, ModelProvider, SavedOpenAIProvider } from '@/types/ai-types';

const useStyles = makeStyles({
    dropdown: {
        minWidth: '150px',
        backgroundColor: '#2a2a2a',
        ...shorthands.borderRadius('6px'),
        color: '#ffffff',
        ...shorthands.border('1px', 'solid', '#3a3a3a'),
        '& button': {
            backgroundColor: '#2a2a2a',
            color: '#ffffff',
            ...shorthands.border('1px', 'solid', '#3a3a3a'),
            '&:hover': {
                backgroundColor: '#333333',
            },
        },
    },
    combobox: {
        minWidth: '150px',
        backgroundColor: '#2a2a2a',
        ...shorthands.borderRadius('6px'),
        color: '#ffffff',
        ...shorthands.border('1px', 'solid', '#3a3a3a'),
        '& input': {
            backgroundColor: '#2a2a2a',
            color: '#ffffff',
        },
        '&:hover': {
            backgroundColor: '#333333',
        },
    },
    optionContent: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
    },
    modelInfo: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
    },
    modelSize: {
        fontSize: '11px',
        color: tokens.colorNeutralForeground3,
    },
});

interface ModelSelectorProps {
    models: ModelConfig[];
    selectedModelId?: string;
    onModelChange: (modelId: string) => void;
    disabled?: boolean;
    activeProvider?: ModelProvider;
    /** Saved OpenAI-compatible presets. When present, the OpenAI-compatible combobox lists them as options. */
    savedPresets?: SavedOpenAIProvider[];
    /** Currently active preset id (for visual selection state). */
    activePresetId?: string | null;
    /** Called when the user picks a saved preset by id. */
    onPresetChange?: (presetId: string) => void;
}

function formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function getProviderBadgeColor(provider: ModelProvider): 'brand' | 'success' | 'warning' | 'danger' {
    switch (provider) {
        case ModelProvider.TransformerJS:
            return 'success';
        case ModelProvider.Ollama:
            return 'brand';
        case ModelProvider.OpenAICompatible:
            return 'warning';
        default:
            return 'brand';
    }
}

function getProviderDisplayName(provider: ModelProvider): string {
    switch (provider) {
        case ModelProvider.TransformerJS:
            return 'TransformerJS';
        case ModelProvider.Ollama:
            return 'Ollama';
        case ModelProvider.LlamaCpp:
            return 'LlamaCpp';
        case ModelProvider.OpenAICompatible:
            return 'OpenAI';
        default:
            return provider;
    }
}

export function ModelSelector({
    models,
    selectedModelId,
    onModelChange,
    disabled = false,
    activeProvider,
    savedPresets,
    activePresetId,
    onPresetChange,
}: ModelSelectorProps) {
    const styles = useStyles();

    const selectedModel = models.find((m) => m.id === selectedModelId);
    const isByok = activeProvider === ModelProvider.OpenAICompatible || activeProvider === ModelProvider.Ollama;
    const isOpenAI = activeProvider === ModelProvider.OpenAICompatible;
    const presets = isOpenAI ? (savedPresets ?? []) : [];
    const activePreset = presets.find((p) => p.id === activePresetId);

    const placeholder = activeProvider
        ? `Select ${getProviderDisplayName(activeProvider)} model`
        : 'Select a model';

    if (isByok) {
        const presetIds = new Set(presets.map((p) => p.id));
        const comboValue = activePreset?.name
            ?? selectedModel?.name
            ?? (isOpenAI ? localStorage.getItem('customModelName_openaiCompatible') ?? '' : '');
        const selectedOptions = activePreset
            ? [activePreset.id]
            : selectedModelId
                ? [selectedModelId]
                : [];

        return (
            <Combobox
                className={styles.combobox}
                placeholder={placeholder}
                value={comboValue}
                selectedOptions={selectedOptions}
                onOptionSelect={(_, data) => {
                    if (!data.optionValue) return;
                    if (presetIds.has(data.optionValue)) {
                        onPresetChange?.(data.optionValue);
                    } else {
                        onModelChange(data.optionValue);
                    }
                }}
                onChange={(e) => {
                    if (e.target.value && e.target.value.trim()) {
                        onModelChange(e.target.value);
                    }
                }}
                freeform
                disabled={disabled}
            >
                {presets.map((preset) => (
                    <Option key={preset.id} value={preset.id} text={preset.name}>
                        <div className={styles.optionContent}>
                            <div className={styles.modelInfo}>
                                <Text weight="semibold">{preset.name}</Text>
                                <Text className={styles.modelSize}>{preset.modelName}</Text>
                            </div>
                            {preset.isDefault && (
                                <Badge size="small" appearance="tint" color="brand">
                                    Default
                                </Badge>
                            )}
                        </div>
                    </Option>
                ))}
                {models.map((model) => (
                    <Option key={model.id} value={model.id} text={model.name}>
                        <div className={styles.optionContent}>
                            <div className={styles.modelInfo}>
                                <Text weight="semibold">{model.name}</Text>
                                {model.sizeBytes && (
                                    <Text className={styles.modelSize}>
                                        {formatFileSize(model.sizeBytes)}
                                    </Text>
                                )}
                            </div>
                            <Badge
                                size="small"
                                appearance="tint"
                                color={getProviderBadgeColor(model.provider)}
                            >
                                {model.provider}
                            </Badge>
                        </div>
                    </Option>
                ))}
            </Combobox>
        );
    }

    return (
        <Dropdown
            className={styles.dropdown}
            placeholder={placeholder}
            value={selectedModel?.name || ''}
            selectedOptions={selectedModelId ? [selectedModelId] : []}
            onOptionSelect={(_, data) => {
                if (data.optionValue) {
                    onModelChange(data.optionValue);
                }
            }}
            disabled={disabled}
        >
            {models.map((model) => (
                <Option key={model.id} value={model.id} text={model.name}>
                    <div className={styles.optionContent}>
                        <div className={styles.modelInfo}>
                            <Text weight="semibold">{model.name}</Text>
                            {model.sizeBytes && (
                                <Text className={styles.modelSize}>
                                    {formatFileSize(model.sizeBytes)}
                                </Text>
                            )}
                        </div>
                        <Badge
                            size="small"
                            appearance="tint"
                            color={getProviderBadgeColor(model.provider)}
                        >
                            {model.provider}
                        </Badge>
                    </div>
                </Option>
            ))}
        </Dropdown>
    );
}
