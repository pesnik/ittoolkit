import React from 'react';
import {
    makeStyles,
    tokens,
    shorthands,
    Text,
    Slider,
    Label,
    Button,
    Divider,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogContent,
    DialogActions,
    TabList,
    Tab,
    Input,
    Badge,
    Dropdown,
    Option,
    ProgressBar,
    Spinner,
    Toast,
    Toaster,
    useToastController,
    useId,
    ToastTitle,
    ToastBody,
    ToastTrigger,
} from '@fluentui/react-components';
import {
    Dismiss24Regular,
    Save24Regular,
    BotRegular,
    CubeRegular,
    GlobeRegular,
    Play24Regular,
    ArrowDownload24Regular,
    DismissRegular,
} from '@fluentui/react-icons';
import { ModelConfig, ModelParameters, ModelProvider, AIMode, MessageRole } from '@/types/ai-types';
import { runInference, createMessage } from '@/lib/ai/ai-service';
import { loadAIConfig } from '@/lib/ai/config';
import { SkillsPanel } from './SkillsPanel';

const useStyles = makeStyles({
    dialogSurface: {
        minWidth: '800px', // Match mockup width
        maxWidth: '900px',
        minHeight: '600px',
    },
    // Tabs
    tabList: {
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
        marginBottom: '20px',
    },
    // Layout
    contentGrid: {
        display: 'grid',
        gridTemplateColumns: '2fr 1fr', // 2:1 split for Main vs Preview
        gap: '24px',
        height: '450px', // Fixed height
    },
    mainColumn: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('16px'),
        overflowY: 'auto',
        paddingRight: '12px',
    },
    previewColumn: {
        backgroundColor: tokens.colorNeutralBackground2, // Slightly darker
        ...shorthands.borderRadius('12px'),
        ...shorthands.padding('20px'),
        display: 'flex',
        flexDirection: 'column', // Fixed: was missing
        ...shorthands.gap('16px'),
        height: 'fit-content',
    },
    // New style for progress
    progressContainer: {
        width: '100%',
        marginTop: '8px',
    },
    // Model Cards
    cardGrid: {
        display: 'flex',
        flexDirection: 'row',
        ...shorthands.gap('12px'),
        overflowX: 'auto',
        paddingBottom: '12px', // Space for scrollbar
        scrollSnapType: 'x mandatory',
        minHeight: '180px', // Ensure height for cards
    },
    modelCard: {
        cursor: 'pointer',
        ...shorthands.padding('16px'),
        transition: 'all 0.2s',
        ...shorthands.border('1px solid transparent'),
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: tokens.shadow4,
        position: 'relative',
        minWidth: '200px', // Fixed width for carousel
        maxWidth: '220px',
        scrollSnapAlign: 'start',
        flexShrink: 0, // Prevent shrinking
    },
    selectedCard: {
        ...shorthands.borderColor(tokens.colorBrandStroke1),
        backgroundColor: tokens.colorBrandBackground2,
        boxShadow: tokens.shadow8, // Enhanced shadow for selected
    },
    // Badges
    badgeRow: {
        display: 'flex',
        ...shorthands.gap('8px'),
        marginTop: '8px',
        flexWrap: 'wrap',
    },
    // Typography
    sectionTitle: {
        marginBottom: '12px',
    },
    // Settings Rows
    settingRow: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('8px'),
        marginBottom: '16px',
    },
    labelRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
});

interface AISettingsPanelProps {
    modelConfig: ModelConfig;
    allModels: ModelConfig[];
    activeProvider?: ModelProvider;
    currentMode: AIMode; // Add current mode
    onUpdateConfig: (newConfig: ModelConfig) => void;
    onSelectModel: (modelId: string) => void;
    onProviderChange: (provider: ModelProvider) => void;
    onDownloadModel?: (modelId: string, provider: ModelProvider, endpoint?: string) => void;
    downloadProgress?: { modelId: string; status: string; progress: number; total?: number; completed?: number };
    onClose: () => void;
    open: boolean;
}

export function AISettingsPanel({
    modelConfig,
    allModels,
    activeProvider,
    currentMode,
    onUpdateConfig,
    onSelectModel,
    onProviderChange,
    onDownloadModel,
    downloadProgress,
    onClose,
    open
}: AISettingsPanelProps) {
    const styles = useStyles();
    const toasterId = useId('toaster');
    const { dispatchToast, dismissToast } = useToastController(toasterId);

    // Defensive defaults in case modelConfig is missing (should be handled by parent)
    const [selectedTab, setSelectedTab] = React.useState<string>('general');
    const [params, setParams] = React.useState<ModelParameters>(modelConfig?.parameters || {
        temperature: 0.7, topP: 0.9, maxTokens: 2048, stream: true
    });
    const [customEndpoint, setCustomEndpoint] = React.useState<string>('');
    const [customModelName, setCustomModelName] = React.useState<string>('');
    const [apiKey, setApiKey] = React.useState<string>('');

    // Load config on mount to get the correct default endpoints
    React.useEffect(() => {
        const config = loadAIConfig();
        // Check for saved custom endpoint first, fall back to config defaults
        // Use provider-specific keys so Ollama and OpenAI-compatible can have different endpoints
        const endpointKey = activeProvider === ModelProvider.OpenAICompatible
            ? 'defaultAIEndpoint_openaiCompatible'
            : 'defaultAIEndpoint_ollama';
        const savedEndpoint = localStorage.getItem(endpointKey);
        const defaultEndpoint = savedEndpoint || (
            activeProvider === ModelProvider.OpenAICompatible
                ? config.endpoints.openaiCompatible
                : config.endpoints.ollama
        );
        setCustomEndpoint(defaultEndpoint);

        // Load custom model name for OpenAI-compatible provider
        if (activeProvider === ModelProvider.OpenAICompatible) {
            const savedModelName = localStorage.getItem('customModelName_openaiCompatible');
            if (savedModelName) {
                setCustomModelName(savedModelName);
            }
            const savedApiKey = localStorage.getItem('defaultAIKey_openaiCompatible');
            if (savedApiKey) {
                setApiKey(savedApiKey);
            }
        }
    }, [activeProvider]);

    // Track if current config is set as default for the current mode
    const [isDefault, setIsDefault] = React.useState<boolean>(() => {
        const providerKey = 'defaultAIProvider_agent';
        const modelKey = 'defaultAIModel_agent';
        const savedProvider = localStorage.getItem(providerKey);
        const savedModel = localStorage.getItem(modelKey);
        const isProviderMatch = savedProvider === activeProvider;
        const isModelMatch = savedModel === modelConfig?.id;
        return isProviderMatch && isModelMatch;
    });

    // Test inference state
    const [isTesting, setIsTesting] = React.useState<boolean>(false);
    const [testResult, setTestResult] = React.useState<string | null>(null);
    const [downloadProgressState, setDownloadProgressState] = React.useState<{ progress: number; status: string } | null>(null);

    // Safety check - if no config, don't render (but hooks must run first)
    if (!modelConfig) {
        return null;
    }
    // ... existing ...

    // Filter models by active provider (now coming from parent)
    const displayModels = React.useMemo(() => {
        if (!activeProvider) return allModels;
        return allModels.filter(m => m.provider === activeProvider);
    }, [allModels, activeProvider]);

    // Sync state when modelConfig changes
    React.useEffect(() => {
        if (modelConfig) {
            setParams(modelConfig.parameters);
        }
    }, [modelConfig]);

    // Sync isDefault when activeProvider, modelConfig, or mode changes
    React.useEffect(() => {
        const providerKey = 'defaultAIProvider_agent';
        const modelKey = 'defaultAIModel_agent';
        const savedProvider = localStorage.getItem(providerKey);
        const savedModel = localStorage.getItem(modelKey);
        const isProviderMatch = savedProvider === activeProvider;
        const isModelMatch = savedModel === modelConfig?.id;
        setIsDefault(isProviderMatch && isModelMatch);
    }, [activeProvider, modelConfig?.id, currentMode]);

    // Update customEndpoint when activeProvider changes
    // Removed: duplicate endpoint loading logic
    // The endpoint is now loaded from runtime config in the useEffect above

    const handleParamChange = (key: keyof ModelParameters, value: any) => {
        if (!modelConfig) return;
        const newParams = { ...params, [key]: value };
        setParams(newParams);
        onUpdateConfig({ ...modelConfig, parameters: newParams });
    };

    const getModelBadge = (model: ModelConfig) => {
        // Mock logic for badges based on name/size
        if (model.id.includes('3b') || (model.sizeBytes && model.sizeBytes < 4e9)) return <Badge color="success" appearance="tint">Fast</Badge>;
        if (model.id.includes('70b')) return <Badge color="danger" appearance="tint">Slow</Badge>;
        if (model.id.includes('7b') || model.id.includes('8b')) return <Badge color="warning" appearance="tint">Balanced</Badge>;
        return <Badge color="brand" appearance="tint">Quality</Badge>;
    };

    const getProviderIcon = (provider: ModelProvider) => {
        switch (provider) {
            case ModelProvider.TransformerJS: return <GlobeRegular />;
            case ModelProvider.Ollama: return <BotRegular />;
            case ModelProvider.LlamaCpp: return <BotRegular />;
            default: return <CubeRegular />;
        }
    };

    const handleTestInference = async () => {
        if (!modelConfig || !activeProvider) {
            dispatchToast(
                <Toast>
                    <ToastTitle action={
                        <ToastTrigger>
                            <Button
                                appearance="transparent"
                                icon={<DismissRegular />}
                                size="small"
                            />
                        </ToastTrigger>
                    }>
                        Test Failed
                    </ToastTitle>
                    <ToastBody>No model selected</ToastBody>
                </Toast>,
                { intent: 'error' }
            );
            return;
        }

        setIsTesting(true);
        setTestResult(null);

        try {
            const testMessage = createMessage(MessageRole.User, 'Hello! Please respond with a brief greeting.');

            // Use the custom endpoint if it's set for OpenAI-compatible or Ollama providers
            const testModelConfig = {
                ...modelConfig,
                ...(activeProvider === ModelProvider.OpenAICompatible || activeProvider === ModelProvider.Ollama
                    ? { endpoint: customEndpoint, provider: activeProvider }
                    : {}),
                ...(activeProvider === ModelProvider.OpenAICompatible && apiKey
                    ? { apiKey }
                    : {}),
                ...(activeProvider === ModelProvider.OpenAICompatible
                    ? { modelId: customModelName || 'gpt-4o' }
                    : {}),
            };

            let streamedResponse = '';
            const response = await runInference(
                {
                    sessionId: 'test-inference',
                    modelConfig: testModelConfig,
                    messages: [testMessage],
                    mode: AIMode.Agent,
                },
                (chunk) => {
                    streamedResponse += chunk;
                },
                (progress: any) => {
                    if (progress?.modelId) {
                        setDownloadProgressState({ progress: progress.progress, status: progress.status });
                        if (progress.status === 'completed' || progress.progress >= 1.0) {
                            setDownloadProgressState(null);
                        }
                    }
                }
            );

            const finalResponse = response.message.content || streamedResponse;
            // Don't set inline result for success, only show toast

            dispatchToast(
                <Toast>
                    <ToastTitle action={
                        <ToastTrigger>
                            <Button
                                appearance="transparent"
                                icon={<DismissRegular />}
                                size="small"
                            />
                        </ToastTrigger>
                    }>
                        Test Successful
                    </ToastTitle>
                    <ToastBody>Model responded: {finalResponse.substring(0, 50)}...</ToastBody>
                </Toast>,
                { intent: 'success' }
            );
        } catch (error: any) {
            console.error('Test inference failed:', error);

            // Don't set inline error, only show toast to avoid redundancy
            let errorMessage = 'Failed to run inference';

            if (typeof error === 'string') {
                errorMessage = error;
            } else if (error?.message) {
                errorMessage = error.message;
            } else if (error) {
                try {
                    errorMessage = JSON.stringify(error);
                } catch {
                    errorMessage = String(error);
                }
            }

            dispatchToast(
                <Toast>
                    <ToastTitle action={
                        <ToastTrigger>
                            <Button
                                appearance="transparent"
                                icon={<DismissRegular />}
                                size="small"
                            />
                        </ToastTrigger>
                    }>
                        Test Failed
                    </ToastTitle>
                    <ToastBody>{errorMessage}</ToastBody>
                </Toast>,
                { intent: 'error' }
            );
        } finally {
            setIsTesting(false);
        }
    };

    // --- Preview panel derived values ---
    const isRemoteProvider = activeProvider === ModelProvider.OpenAICompatible;

    const providerLabel = (() => {
        switch (activeProvider) {
            case ModelProvider.TransformerJS: return 'Transformer.js';
            case ModelProvider.Ollama: return 'Ollama';
            case ModelProvider.LlamaCpp: return 'llama.cpp';
            case ModelProvider.MLX: return 'MLX';
            case ModelProvider.OpenAICompatible: return 'OpenAI-compatible';
            default: return 'No provider selected';
        }
    })();

    const locality = (() => {
        switch (activeProvider) {
            case ModelProvider.TransformerJS: return 'In-browser';
            case ModelProvider.Ollama: return 'Local server';
            case ModelProvider.LlamaCpp: return 'Local (native)';
            case ModelProvider.MLX: return 'Local (Apple Silicon)';
            case ModelProvider.OpenAICompatible: return 'Remote';
            default: return 'Unknown';
        }
    })();

    const whereItRuns = (() => {
        switch (activeProvider) {
            case ModelProvider.TransformerJS:
                return 'Runs inside this browser tab using WebGPU/WASM. No external services involved.';
            case ModelProvider.Ollama:
                return `Calls a local Ollama server on this machine${customEndpoint ? ` (${customEndpoint}).` : '.'}`;
            case ModelProvider.LlamaCpp:
                return 'Runs as a bundled llama.cpp process on this machine.';
            case ModelProvider.MLX:
                return 'Runs natively on Apple Silicon via MLX.';
            case ModelProvider.OpenAICompatible:
                return `Sends requests to an external OpenAI-compatible API${customEndpoint ? ` (${customEndpoint}).` : '.'}`;
            default:
                return 'Pick a provider on the left to see how it runs.';
        }
    })();

    const privacyText = (() => {
        if (activeProvider === ModelProvider.OpenAICompatible) {
            let host = 'the configured endpoint';
            try {
                if (customEndpoint) host = new URL(customEndpoint).host;
            } catch {
                // keep fallback
            }
            return `Prompts and file context are sent to ${host}. Treat as you would any third-party API.`;
        }
        if (activeProvider === ModelProvider.TransformerJS) {
            return 'Everything stays in this browser tab — nothing is sent over the network.';
        }
        return 'Everything stays on your device — nothing is sent over the network.';
    })();

    const storagePath = (() => {
        switch (activeProvider) {
            case ModelProvider.TransformerJS: return 'Browser cache (IndexedDB)';
            case ModelProvider.Ollama: return '~/.ollama/models';
            case ModelProvider.LlamaCpp: return '<app data>/ittoolkit/models';
            case ModelProvider.MLX: return '~/.cache/huggingface';
            case ModelProvider.OpenAICompatible: return 'Hosted by provider — nothing stored locally';
            default: return '—';
        }
    })();

    const temperatureLabel = params.temperature < 0.4
        ? { label: 'Precise', desc: 'Focused, deterministic answers — good for code and structured output.' }
        : params.temperature > 0.8
            ? { label: 'Creative', desc: 'Varied, exploratory answers — good for brainstorming and prose.' }
            : { label: 'Balanced', desc: 'Natural and reliable — a safe default for most tasks.' };

    const topPLabel = params.topP < 0.5
        ? 'Focused — picks from a narrow set of likely words.'
        : params.topP > 0.95
            ? 'Broad — considers a wide range of word choices.'
            : 'Standard sampling — the typical range for chat models.';

    const approxWords = Math.round(params.maxTokens * 0.75);

    return (
        <Dialog open={open} onOpenChange={(event, data) => !data.open && onClose()}>
            <DialogSurface className={styles.dialogSurface}>
                <DialogBody>
                    <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                        <Text size={500} weight="semibold">Configure your Agent Harness</Text>
                    </div>

                    <div className={styles.tabList}>
                        <TabList selectedValue={selectedTab} onTabSelect={(_, data) => setSelectedTab(data.value as string)}>
                            <Tab value="general">General</Tab>
                            <Tab value="parameters">Parameters</Tab>
                            <Tab value="skills">Skills</Tab>
                            <Tab value="advanced">Advanced</Tab>
                        </TabList>
                    </div>

                    <DialogContent>
                        <div className={styles.contentGrid}>
                            {/* LEFT COLUMN: MAIN CONTENT */}
                            <div className={styles.mainColumn}>
                                {selectedTab === 'general' && (
                                    <>
                                        <div>
                                            <Label weight="semibold">AI Provider</Label>
                                            <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginBottom: '8px' }}>
                                                Choose your AI engine. Models below are filtered by this provider.
                                            </Text>
                                            <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginBottom: '8px' }}>
                                                The selected provider and model handle every chat. Settings are saved per-provider.
                                            </Text>
                                            <div style={{ marginTop: '8px' }}>
                                                <Dropdown
                                                    value={
                                                        activeProvider === 'transformerjs' ? 'Transformer.js (In-Browser)' :
                                                            activeProvider === 'ollama' ? 'Ollama (Local Server)' :
                                                                activeProvider === 'llamacpp' ? 'LlamaCpp (Local)' :
                                                                    activeProvider === 'openai-compatible' ? 'OpenAI Compatible' :
                                                                        'Select Provider'
                                                    }
                                                    selectedOptions={activeProvider ? [activeProvider] : []}
                                                    onOptionSelect={(_, data) => onProviderChange(data.optionValue as ModelProvider)}
                                                    style={{ width: '100%' }}
                                                >
                                                    <Option value="llamacpp" text="LlamaCpp (Local)">
                                                        <BotRegular style={{ marginRight: '8px' }} /> LlamaCpp (Recommended)
                                                    </Option>
                                                    <Option value="transformerjs" text="Transformer.js (In-Browser)">
                                                        <GlobeRegular style={{ marginRight: '8px' }} /> Transformer.js (In-Browser)
                                                    </Option>
                                                    <Option value="ollama" text="Ollama (Local Server)">
                                                        <BotRegular style={{ marginRight: '8px' }} /> Ollama (Local Server)
                                                    </Option>
                                                    <Option value="openai-compatible" text="OpenAI Compatible">
                                                        <CubeRegular style={{ marginRight: '8px' }} /> OpenAI Compatible
                                                    </Option>
                                                </Dropdown>
                                            </div>

                                            {/* Endpoint Configuration */}
                                            {(activeProvider === 'ollama' || activeProvider === 'openai-compatible') && (
                                                <div style={{ marginTop: '12px' }}>
                                                    <Label size="small">Endpoint URL</Label>
                                                    <Input
                                                        value={customEndpoint}
                                                        onChange={(e) => setCustomEndpoint(e.target.value)}
                                                        placeholder={activeProvider === 'ollama' ? "http://127.0.0.1:11434" : "http://127.0.0.1:8080/v1"}
                                                        style={{ width: '100%', marginTop: '4px' }}
                                                    />
                                                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                                        {activeProvider === 'ollama'
                                                            ? 'Base URL for Ollama server (e.g., http://127.0.0.1:11434)'
                                                            : 'OpenAI-compatible base URL ending with /v1 (e.g., http://127.0.0.1:8033/v1)'}
                                                    </Text>
                                                </div>
                                            )}

                                            {/* API Key for OpenAI-compatible */}
                                            {activeProvider === 'openai-compatible' && (
                                                <div style={{ marginTop: '12px' }}>
                                                    <Label size="small">API Key</Label>
                                                    <Input
                                                        type="password"
                                                        value={apiKey}
                                                        onChange={(e) => setApiKey(e.target.value)}
                                                        placeholder="sk-or-v1-..."
                                                        style={{ width: '100%', marginTop: '4px' }}
                                                    />
                                                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                                        Required by some providers (OpenRouter, etc.). Leave blank if not needed.
                                                    </Text>
                                                </div>
                                            )}
                                        </div>

                                        <div>
                                            <Label weight="semibold" className={styles.sectionTitle}>
                                                Available Models {activeProvider && `(${activeProvider})`}
                                            </Label>
                                            {activeProvider === ModelProvider.OpenAICompatible ? (
                                                <div>
                                                    <div style={{ marginTop: '8px', padding: '16px', backgroundColor: tokens.colorNeutralBackground2, borderRadius: '8px' }}>
                                                        <Label size="small">Model Name</Label>
                                                        <Input
                                                            value={customModelName}
                                                            onChange={(e) => setCustomModelName(e.target.value)}
                                                            placeholder="Enter model name (e.g., gpt-4o, claude-sonnet-4, openai/gpt-4o)"
                                                            style={{ width: '100%', marginTop: '4px' }}
                                                        />
                                                        <Text block size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: '8px' }}>
                                                            This name will be sent as the model identifier to the OpenAI-compatible server
                                                        </Text>
                                                    </div>
                                                    <div style={{ padding: '20px', color: tokens.colorNeutralForeground3, marginTop: '16px' }}>
                                                        <Text block style={{ marginBottom: '12px', fontWeight: 600 }}>
                                                            Setup Instructions
                                                        </Text>
                                                        <Text block size={200} style={{ marginBottom: '8px' }}>
                                                            1. Set your base URL above (must end with <code>/v1</code>)
                                                        </Text>
                                                        <Text block size={200} style={{ marginBottom: '8px', marginLeft: '16px', color: tokens.colorNeutralForeground4 }}>
                                                            Example: <code>https://openrouter.ai/api/v1</code>
                                                        </Text>
                                                        <Text block size={200} style={{ marginBottom: '12px' }}>
                                                            2. Enter your API key if required (e.g., OpenRouter, OpenAI)
                                                        </Text>
                                                        <Text block size={200} style={{ marginBottom: '8px', marginLeft: '16px', color: tokens.colorNeutralForeground4 }}>
                                                            Example: <code>sk-or-v1-...</code>
                                                        </Text>
                                                        <Text block size={200} style={{ marginBottom: '12px' }}>
                                                            3. Type the model name above (e.g., <code>openai/gpt-4o</code>)
                                                        </Text>
                                                        <Text block size={200}>
                                                            4. Use the &quot;Test Inference&quot; button below to verify the connection
                                                        </Text>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className={styles.cardGrid}>
                                                    {displayModels.length === 0 ? (
                                                        <Text style={{ padding: '20px', color: tokens.colorNeutralForeground3 }}>
                                                            {activeProvider
                                                                ? `No models found for ${activeProvider}. Try selecting a different provider above.`
                                                                : 'Please select a provider above to see available models.'}
                                                        </Text>
                                                    ) : (
                                                    displayModels.map((model) => {
                                                        const isDownloading = downloadProgress?.modelId === model.modelId && downloadProgress?.status === 'downloading';
                                                        const isDefaultModel =
                                                            localStorage.getItem('defaultAIProvider') === activeProvider &&
                                                            localStorage.getItem('defaultAIModel') === model.id;

                                                        return (
                                                            <div
                                                                key={model.id}
                                                                className={`${styles.modelCard} ${model.id === modelConfig.id ? styles.selectedCard : ''}`}
                                                                onClick={() => onSelectModel(model.id)}
                                                                style={{ opacity: model.isAvailable || isDownloading ? 1 : 0.7 }}
                                                            >
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                                    {getProviderIcon(model.provider)}
                                                                    {model.isAvailable ? (
                                                                        <Button
                                                                            icon={<Dismiss24Regular />}
                                                                            size="small"
                                                                            appearance="subtle"
                                                                            title="Delete/Remove Model"
                                                                            onClick={(e) => { e.stopPropagation(); /* TODO: Delete logic */ }}
                                                                        />
                                                                    ) : !isDownloading && (
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                            <Badge appearance="tint" color="informative">Not Installed</Badge>
                                                                            <Button
                                                                                appearance="primary"
                                                                                size="small"
                                                                                icon={<ArrowDownload24Regular />}
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();

                    if (model.provider === ModelProvider.LlamaCpp) {
                        if (onDownloadModel) {
                            onDownloadModel(model.modelId, ModelProvider.LlamaCpp);
                        }
                        return;
                    }

                    const command = `ollama pull ${model.modelId}`;
                                                                                    navigator.clipboard.writeText(command);
                                                                                    alert(`Command copied to clipboard!\n\nRun this in your terminal:\n${command}\n\nThen refresh the app.`);
                                                                                }}
                                                title={model.provider === ModelProvider.LlamaCpp ? "Download GGUF Model" : "Copy install command"}
                                            >
                                                {model.provider === ModelProvider.LlamaCpp ? "Download" : "Get"}
                                                                            </Button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                                                    <Text weight="semibold">{model.name}</Text>
                                                                    {isDefaultModel && (
                                                                        <Badge appearance="filled" color="brand" size="small">Default</Badge>
                                                                    )}
                                                                </div>

                                                                {isDownloading ? (
                                                                    <div className={styles.progressContainer}>
                                                                        <ProgressBar value={downloadProgress?.progress ? downloadProgress.progress / 100 : undefined} />
                                                                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                                                            {downloadProgress?.progress ? (downloadProgress.progress <= 1.0 ? `${Math.round(downloadProgress.progress * 100)}%` : `${Math.round(downloadProgress.progress)}%`) : 'Starting...'}
                                                                        </Text>
                                                                    </div>
                                                                ) : (
                                                                    <div className={styles.badgeRow}>
                                                                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                                                            {model.sizeBytes ? `${(model.sizeBytes / 1e9).toFixed(1)}GB` : 'Unknown size'}
                                                                        </Text>
                                                                        {getModelBadge(model)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}

                                {selectedTab === 'parameters' && (
                                    <>
                                        <div className={styles.settingRow}>
                                            <div className={styles.labelRow}>
                                                <Label>Temperature ({params.temperature.toFixed(1)})</Label>
                                                <Badge appearance="outline" color={params.temperature > 0.8 ? "warning" : "brand"}>
                                                    {params.temperature > 0.8 ? "Creative" : params.temperature < 0.4 ? "Precise" : "Balanced"}
                                                </Badge>
                                            </div>
                                            <Slider
                                                min={0}
                                                max={2}
                                                step={0.1}
                                                value={params.temperature}
                                                onChange={(_, data) => handleParamChange('temperature', data.value)}
                                            />
                                        </div>

                                        <div className={styles.settingRow}>
                                            <div className={styles.labelRow}>
                                                <Label>Top P ({params.topP.toFixed(1)})</Label>
                                            </div>
                                            <Slider
                                                min={0}
                                                max={1}
                                                step={0.05}
                                                value={params.topP}
                                                onChange={(_, data) => handleParamChange('topP', data.value)}
                                            />
                                        </div>

                                        <div className={styles.settingRow}>
                                            <div className={styles.labelRow}>
                                                <Label>Max Output Tokens ({params.maxTokens})</Label>
                                            </div>
                                            <Slider
                                                min={256}
                                                max={4096}
                                                step={256}
                                                value={params.maxTokens}
                                                onChange={(_, data) => handleParamChange('maxTokens', data.value)}
                                            />
                                        </div>
                                    </>
                                )}

                                {selectedTab === 'skills' && (
                                    <SkillsPanel />
                                )}

                                {selectedTab === 'advanced' && (
                                    <Text>Advanced settings placehoder...</Text>
                                )}
                            </div>

                            {/* RIGHT COLUMN: PREVIEW PANEL */}
                            <div className={styles.previewColumn}>
                                <Text weight="semibold" size={400}>Preview</Text>
                                <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: '-8px' }}>
                                    A live summary of the choices on the left.
                                </Text>

                                {/* Active model — always shown */}
                                <div>
                                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>Active Model</Label>
                                    <Text weight="semibold" block style={{ marginTop: '4px' }}>
                                        {activeProvider === ModelProvider.OpenAICompatible
                                            ? (customModelName || 'Custom model')
                                            : modelConfig.name}
                                    </Text>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                            {providerLabel}
                                        </Text>
                                        <Badge appearance="tint" color={isRemoteProvider ? 'warning' : 'success'} size="small">
                                            {locality}
                                        </Badge>
                                    </div>
                                </div>

                                <Divider />

                                {/* Tab-specific content */}
                                {selectedTab === 'general' && (
                                    <>
                                        <div>
                                            <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>Where it runs</Label>
                                            <Text size={200} block style={{ marginTop: '4px' }}>{whereItRuns}</Text>
                                        </div>

                                        <Divider />

                                        <div>
                                            <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>Privacy</Label>
                                            <Text size={200} block style={{ marginTop: '4px' }}>{privacyText}</Text>
                                        </div>

                                        <Divider />

                                        <div>
                                            <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                                                {isRemoteProvider ? 'Model storage' : 'Storage location'}
                                            </Label>
                                            <Text size={200} block style={{
                                                fontFamily: tokens.fontFamilyMonospace,
                                                marginTop: '4px',
                                                wordBreak: 'break-all',
                                                color: tokens.colorNeutralForeground2,
                                            }}>
                                                {storagePath}
                                            </Text>
                                            {!isRemoteProvider && modelConfig.sizeBytes && (
                                                <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: '4px', display: 'block' }}>
                                                    ~{(modelConfig.sizeBytes / 1e9).toFixed(1)}GB on disk · ~{Math.ceil(modelConfig.sizeBytes / 1e9 + 2)}GB RAM to load
                                                </Text>
                                            )}
                                        </div>
                                    </>
                                )}

                                {selectedTab === 'parameters' && (
                                    <>
                                        <div>
                                            <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>Response style</Label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                                                <Text weight="medium">{temperatureLabel.label}</Text>
                                                <Badge appearance="outline" size="small">temp {params.temperature.toFixed(1)}</Badge>
                                            </div>
                                            <Text size={200} block style={{ color: tokens.colorNeutralForeground3, marginTop: '2px' }}>
                                                {temperatureLabel.desc}
                                            </Text>
                                        </div>

                                        <Divider />

                                        <div>
                                            <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>Word choice</Label>
                                            <Text size={200} block style={{ marginTop: '4px' }}>{topPLabel}</Text>
                                        </div>

                                        <Divider />

                                        <div>
                                            <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>Reply length</Label>
                                            <Text size={200} block style={{ marginTop: '4px' }}>
                                                Up to {params.maxTokens.toLocaleString()} tokens (~{approxWords.toLocaleString()} words)
                                            </Text>
                                        </div>

                                        <Divider />

                                        <div>
                                            <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>Streaming</Label>
                                            <Text size={200} block style={{ marginTop: '4px' }}>
                                                {params.stream ? 'On — tokens stream as they are generated.' : 'Off — replies arrive all at once.'}
                                            </Text>
                                        </div>
                                    </>
                                )}

                                {selectedTab === 'skills' && (
                                    <>
                                        <div>
                                            <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>About skills</Label>
                                            <Text size={200} block style={{ marginTop: '4px' }}>
                                                Skills are reusable prompts the agent can invoke as tools. Enable the ones you want available; disable the rest to keep the agent focused.
                                            </Text>
                                        </div>

                                        <Divider />

                                        <div>
                                            <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>Trusted vs untrusted</Label>
                                            <Text size={200} block style={{ marginTop: '4px' }}>
                                                Trusted skills run without confirmation. Untrusted skills prompt before each run — review their source first.
                                            </Text>
                                        </div>
                                    </>
                                )}

                                {selectedTab === 'advanced' && (
                                    <>
                                        <div>
                                            <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>Advanced settings</Label>
                                            <Text size={200} block style={{ marginTop: '4px' }}>
                                                Lower-level controls for power users — stop sequences, context window, and provider-specific overrides will appear here.
                                            </Text>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </DialogContent>

                    {downloadProgressState && (
                        <div style={{
                            padding: '12px 24px',
                            backgroundColor: tokens.colorNeutralBackground2,
                            borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
                            borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                        }}>
                            <Text size={200}>Downloading model... {Math.round(downloadProgressState.progress * 100)}%</Text>
                            <div style={{
                                height: '4px',
                                backgroundColor: tokens.colorNeutralStroke1,
                                borderRadius: '2px',
                                overflow: 'hidden',
                            }}>
                                <div style={{
                                    height: '100%',
                                    width: `${downloadProgressState.progress * 100}%`,
                                    backgroundColor: tokens.colorBrandStroke1,
                                    transition: 'width 0.3s ease',
                                }} />
                            </div>
                        </div>
                    )}
                    {testResult && !downloadProgressState && (
                        <div style={{
                            padding: '12px 24px',
                            backgroundColor: testResult.startsWith('Error')
                                ? tokens.colorPaletteRedBackground1
                                : tokens.colorPaletteGreenBackground1,
                            borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
                            borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
                        }}>
                            <Text
                                size={200}
                                style={{
                                    color: testResult.startsWith('Error')
                                        ? tokens.colorPaletteRedForeground1
                                        : tokens.colorPaletteGreenForeground1,
                                    wordBreak: 'break-word'
                                }}
                            >
                                {testResult.startsWith('Error') ? '❌ ' : '✅ '}
                                {testResult}
                            </Text>
                        </div>
                    )}

                    <DialogActions>
                        <Button
                            appearance="outline"
                            icon={isTesting ? <Spinner size="tiny" /> : <Play24Regular />}
                            onClick={handleTestInference}
                            disabled={isTesting}
                        >
                            {isTesting ? 'Testing...' : 'Test Inference'}
                        </Button>
                        {modelConfig && activeProvider && (
                            <Button
                                appearance={isDefault ? "primary" : "outline"}
                                onClick={() => {
                                    const providerKey = 'defaultAIProvider_agent';
                                    const modelKey = 'defaultAIModel_agent';

                                    if (isDefault) {
                                        // Remove provider and model for this mode
                                        localStorage.removeItem(providerKey);
                                        localStorage.removeItem(modelKey);
                                        setIsDefault(false);
                                    } else {
                                        // Save the provider for the current mode
                                        localStorage.setItem(providerKey, activeProvider);
                                        // Save the model ID for the current mode
                                        localStorage.setItem(modelKey, modelConfig.id);
                                        // Save endpoint for OpenAI-compatible and Ollama providers (provider-specific)
                                        if (activeProvider === ModelProvider.OpenAICompatible || activeProvider === ModelProvider.Ollama) {
                                            const endpointKey = activeProvider === ModelProvider.OpenAICompatible
                                                ? 'defaultAIEndpoint_openaiCompatible'
                                                : 'defaultAIEndpoint_ollama';
                                            localStorage.setItem(endpointKey, customEndpoint);
                                        }
                                        if (activeProvider === ModelProvider.OpenAICompatible) {
                                            if (apiKey) {
                                                localStorage.setItem('defaultAIKey_openaiCompatible', apiKey);
                                            } else {
                                                localStorage.removeItem('defaultAIKey_openaiCompatible');
                                            }
                                        }
                                        setIsDefault(true);
                                    }
                                }}
                                style={{ marginLeft: 'auto' }}
                            >
                                {isDefault
                                    ? `⭐ Default`
                                    : `Set as Default`}
                            </Button>
                        )}
                        <Button appearance="primary" onClick={() => {
                            // Save custom endpoint if it has changed
                            if (activeProvider === ModelProvider.OpenAICompatible || activeProvider === ModelProvider.Ollama) {
                                if (customEndpoint) {
                                    const endpointKey = activeProvider === ModelProvider.OpenAICompatible
                                        ? 'defaultAIEndpoint_openaiCompatible'
                                        : 'defaultAIEndpoint_ollama';
                                    localStorage.setItem(endpointKey, customEndpoint);
                                }
                            }
                            // Save custom model name for OpenAI-compatible
                            if (activeProvider === ModelProvider.OpenAICompatible && customModelName) {
                                localStorage.setItem('customModelName_openaiCompatible', customModelName);
                            }
                            // Save API key for OpenAI-compatible
                            if (activeProvider === ModelProvider.OpenAICompatible) {
                                if (apiKey) {
                                    localStorage.setItem('defaultAIKey_openaiCompatible', apiKey);
                                } else {
                                    localStorage.removeItem('defaultAIKey_openaiCompatible');
                                }
                            }
                            onClose();
                        }} icon={<Save24Regular />}>
                            Save
                        </Button>
                    </DialogActions>

                    <Toaster toasterId={toasterId} />
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
