/**
 * AI Service
 * 
 * Main service layer for AI/LLM operations.
 * Handles provider selection, inference routing, and state management.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
    ModelConfig,
    ModelProvider,
    InferenceRequest,
    InferenceResponse,
    ProviderStatus,
    AIMode,
    ChatMessage,
    MessageRole,
    Tool,
} from '@/types/ai-types';
// Lazy import for TransformerJS to avoid SSR/build issues
// Import only when actually needed
const getTransformerJS = async () => {
    return await import('./providers/transformerjs');
};
import { buildFileSystemContext } from './context-builder';
import { getTemplateForMode, buildPrompt } from './prompts';
import { trimToTokenBudget, DEFAULT_WINDOW_CONFIG } from './memory/windowing';
import { trimScreenshotPayload } from './memory/screenshot-retention';
import { featureFlags } from '@/lib/featureFlags';
import { getCachedUserProfile, buildProfileSystemFragment } from './memory/profile-cache';
import { computeMemoryBudget } from './memory/budget';

// Native function calling tool definition for execute_command
const EXECUTE_COMMAND_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'execute_command',
        description: `Execute a shell command on the file system. Use this for ALL file operations: reading, writing, searching, listing, moving, and analyzing files and directories.

Use standard Unix commands: ls, cat, find, grep, du -sh, mv, cp, mkdir, rm, head, tail, wc, file, stat.

For reading files: cat <path>
For listing directories: ls -la <path>
For searching: find <dir> -name "*pattern*"
For directory sizes: du -sh <dir>/*`,
        parameters: {
            type: 'object',
            properties: {
                cmd: {
                    type: 'string',
                    description: 'The shell command to execute. Runs via sh -c "<cmd>". Use single quotes around paths to handle spaces.',
                },
                working_dir: {
                    type: 'string',
                    description: 'Working directory for the command (absolute path).',
                },
                timeout_secs: {
                    type: 'number',
                    description: 'Timeout in seconds (default: 30, max: 300).',
                },
            },
            required: ['cmd', 'working_dir'],
        },
    },
};

// Native function calling tool: emit structured UI actions (clickable paths,
// confirmation dialogs, file highlights). The agent calls this INSTEAD of
// describing paths in plain text — the UI renders these actions natively so
// the user can click, browse, and confirm visually.
const AGENT_ACTION_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'agent_action',
        description: `Emit a structured action that the app renders natively as clickable paths, confirmation dialogs, or file highlights.

Use this INSTEAD of writing file paths in plain text. The app shows chips, dialogs, and navigation — much better than text.

Examples:
• After du -sh, call agent_action with action="navigate" and paths=["/Users/name/Library/Caches"] to let the user click and browse
• Before any destructive command (rm/mv/dd/etc.), call agent_action with action="confirm_action", paths=[…], title="Delete 3 caches", description="These are safe to remove", totalSize=<bytes>, severity="medium", suggestedCommand="rm -rf '/path/a' '/path/b'", suggestedWorkingDir="/Users/name". The app will run suggestedCommand verbatim if the user clicks Execute — do NOT re-issue the command in a later turn.
• For files the user should inspect, call agent_action with action="open_file" and paths=["..."]

Constraints (enforced at dispatch):
- Paths must be absolute (start with "/" or a Windows drive letter); no embedded newlines or NULs; ≤ 4096 chars each.
- For confirm_action: title and description are required, plain text only, ≤ 500 chars each.
- severity defaults to "medium" when omitted; the app may escalate to "high" for system paths or very large operations regardless of what you claim.
- Max 5 actions per model response. Excess calls are rejected — batch into one confirm_action where possible.`,
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['navigate', 'open_file', 'highlight', 'confirm_action'],
                    description: 'What kind of UI action to emit.',
                },
                paths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'One or more absolute file/directory paths. For navigate/open_file, the app uses the first path.',
                },
                title: {
                    type: 'string',
                    description: 'Title for the confirmation dialog (REQUIRED for confirm_action, max 500 chars, plain text).',
                },
                description: {
                    type: 'string',
                    description: 'Explanation shown in the dialog body (REQUIRED for confirm_action, max 500 chars, plain text).',
                },
                totalSize: {
                    type: 'number',
                    description: 'Total size in bytes of the items (for confirm_action display).',
                },
                severity: {
                    type: 'string',
                    enum: ['low', 'medium', 'high'],
                    description: 'Risk level shown as a colored badge. Defaults to "medium" if omitted; auto-escalated to "high" for system paths or very large operations.',
                },
                suggestedCommand: {
                    type: 'string',
                    description: 'REQUIRED for confirm_action. The exact shell command the app will run if the user clicks Execute. Use single-quoted paths to handle spaces.',
                },
                suggestedWorkingDir: {
                    type: 'string',
                    description: 'REQUIRED for confirm_action. Absolute working directory for suggestedCommand.',
                },
            },
            required: ['action', 'paths'],
        },
    },
};

// ─────────────────────────────────────────────────────────────────────────
// Computer-use tools (CU-M2 — read-only set: screenshot, screen_size,
// cursor_position). Write tools (mouse_move, click, type, key, scroll) land
// in CU-M3 with the classifier + approval flow. computer_find (OmniParser →
// UI-TARS grounding) lands in CU-M4.
//
// These are only registered when:
//   1. featureFlags.computerUseAgent is enabled, AND
//   2. The active model claims vision support (computer_screenshot is the
//      whole point — without vision the model is blind).
//
// All three are autonomous; computer_screenshot is the heaviest in token
// terms (~30–80 KB base64). The screenshot-retention layer caps how many
// stay in context.
// ─────────────────────────────────────────────────────────────────────────

const COMPUTER_SCREENSHOT_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_screenshot',
        description: `Capture a screenshot of the user's screen (or a specific display) and return it as a base64 JPEG plus the display dimensions. Use this whenever you need to see what's currently on screen — at the start of a task, after any computer_* write action, or when the user mentions something visible. Each call replaces the prior screenshot in your view; older screenshots are dropped from context to save tokens (their text body remains).`,
        parameters: {
            type: 'object',
            properties: {
                display_index: {
                    type: 'number',
                    description: 'Optional index into computer_screen_size().displays. Omit for the primary display.',
                },
            },
        },
    },
};

const COMPUTER_SCREEN_SIZE_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_screen_size',
        description: `Return information about all connected displays: index, position (x, y), dimensions, DPI scale, primary flag, and name. Use before computer_screenshot when the user has a multi-monitor setup, or to size coordinates for a future computer_* click.`,
        parameters: { type: 'object', properties: {} },
    },
};

const COMPUTER_CURSOR_POSITION_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_cursor_position',
        description: `Return the current mouse cursor position as { x, y } in virtual-desktop coordinates. Read-only and autonomous. On Wayland-only Linux this returns an error by design (no global cursor API).`,
        parameters: { type: 'object', properties: {} },
    },
};

const COMPUTER_MOUSE_MOVE_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_mouse_move',
        description: `Move the mouse cursor to absolute virtual-desktop coordinates (no click). Classified as write — the app pauses 250 ms before dispatch so the user can hit the kill switch.`,
        parameters: {
            type: 'object',
            properties: {
                x: { type: 'number' },
                y: { type: 'number' },
            },
            required: ['x', 'y'],
        },
    },
};

const COMPUTER_LEFT_CLICK_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_left_click',
        description: `Left-click at (x, y) — or at the current cursor position when omitted. Always classified as write; surfaces a screenshot + intent confirmation card. After approval, the app dispatches the click.`,
        parameters: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
        },
    },
};

const COMPUTER_RIGHT_CLICK_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_right_click',
        description: `Right-click at (x, y) — or at the current cursor position when omitted. Write-classified.`,
        parameters: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
        },
    },
};

const COMPUTER_MIDDLE_CLICK_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_middle_click',
        description: `Middle-click at (x, y) — or at the current cursor position when omitted. Write-classified.`,
        parameters: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
        },
    },
};

const COMPUTER_DOUBLE_CLICK_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_double_click',
        description: `Double-click at (x, y) — or at the current cursor position when omitted. Write-classified.`,
        parameters: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
        },
    },
};

const COMPUTER_DRAG_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_left_click_drag',
        description: `Press the left mouse button at (x1, y1), drag to (x2, y2), release. Write-classified.`,
        parameters: {
            type: 'object',
            properties: {
                x1: { type: 'number' },
                y1: { type: 'number' },
                x2: { type: 'number' },
                y2: { type: 'number' },
            },
            required: ['x1', 'y1', 'x2', 'y2'],
        },
    },
};

const COMPUTER_TYPE_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_type',
        description: `Type a string into the currently focused element. Use computer_left_click first to focus the right field. Write-classified. The typed value is NEVER written to the audit log — only the length plus a short prefix.`,
        parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
        },
    },
};

const COMPUTER_KEY_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_key',
        description: `Press a key or chord. Examples: "Enter", "Tab", "Escape", "cmd+space", "ctrl+shift+s". Modifiers recognized: ctrl/control, shift, alt/option, cmd/command/meta/super/win. Write-classified.`,
        parameters: {
            type: 'object',
            properties: { key: { type: 'string' } },
            required: ['key'],
        },
    },
};

const COMPUTER_SCROLL_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'computer_scroll',
        description: `Scroll the active window. direction: "up" | "down" | "left" | "right". clicks: number of scroll units (default 3). Write-classified — even read-looking scrolls can trigger inadvertent reveals (e.g. preview pane), so we ask.`,
        parameters: {
            type: 'object',
            properties: {
                direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
                clicks: { type: 'number' },
            },
            required: ['direction'],
        },
    },
};

const COMPUTER_TOOLS: Tool[] = [
    COMPUTER_SCREENSHOT_TOOL,
    COMPUTER_SCREEN_SIZE_TOOL,
    COMPUTER_CURSOR_POSITION_TOOL,
    COMPUTER_MOUSE_MOVE_TOOL,
    COMPUTER_LEFT_CLICK_TOOL,
    COMPUTER_RIGHT_CLICK_TOOL,
    COMPUTER_MIDDLE_CLICK_TOOL,
    COMPUTER_DOUBLE_CLICK_TOOL,
    COMPUTER_DRAG_TOOL,
    COMPUTER_TYPE_TOOL,
    COMPUTER_KEY_TOOL,
    COMPUTER_SCROLL_TOOL,
];

function activeModelSupportsVision(modelConfig: ModelConfig): boolean {
    if (modelConfig.provider === ModelProvider.OpenAICompatible) {
        try {
            const { getActiveProvider } = require('./savedProviders') as {
                getActiveProvider: () => { supportsVision?: boolean } | undefined;
            };
            return !!getActiveProvider()?.supportsVision;
        } catch {
            return false;
        }
    }
    if (modelConfig.provider === ModelProvider.LlamaCpp) {
        const id = (modelConfig.modelId ?? '').toLowerCase();
        return /(vl|vision|llava|moondream|ui-tars|tars)/.test(id);
    }
    return false;
}

export function canUseComputerTools(modelConfig: ModelConfig): boolean {
    if (!featureFlags.computerUseAgent) return false;
    return activeModelSupportsVision(modelConfig);
}

// Native function calling tool: search across the user's prior conversations.
// Use this when the user references something from a previous chat ("the script
// we wrote last week", "remember when…", "what did we decide about X").
const SEARCH_CONVERSATIONS_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'search_conversations',
        description: `Search the user's prior conversations for a keyword or phrase. Use ONLY when the user references past chats and the current conversation does not contain the answer. Returns up to 5 matching conversations with snippets.`,
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Keyword or phrase to search for. Case-insensitive substring match.',
                },
                limit: {
                    type: 'number',
                    description: 'Max results (default 5, max 20).',
                },
            },
            required: ['query'],
        },
    },
};

// Known models registry. `contextWindow` is the model's stated context window
// in tokens; the memory module uses it to size the summarization threshold and
// history trim budget.
export const KNOWN_MODELS: ModelConfig[] = [
    {
        id: 'llama3.2:1B', name: 'Llama 3.2 1B', provider: ModelProvider.Ollama, isAvailable: false,
        modelId: 'llama3.2:1B', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 2048, stream: true, contextWindow: 131_072 },
        recommendedFor: [AIMode.Agent], sizeBytes: 1.3e9
    },
    {
        id: 'llama3.2:3B', name: 'Llama 3.2 3B', provider: ModelProvider.Ollama, isAvailable: false,
        modelId: 'llama3.2:3B', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 2048, stream: true, contextWindow: 131_072 },
        recommendedFor: [AIMode.Agent], sizeBytes: 2.0e9
    },
    {
        id: 'mistral', name: 'Mistral 7B', provider: ModelProvider.Ollama, isAvailable: false,
        modelId: 'mistral', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 4096, stream: true, contextWindow: 32_768 },
        recommendedFor: [AIMode.Agent], sizeBytes: 4.1e9
    },
    {
        id: 'qwen2.5-coder:0.5b', name: 'Qwen 2.5 Coder 0.5B', provider: ModelProvider.Ollama, isAvailable: false,
        modelId: 'qwen2.5-coder:0.5b', parameters: { temperature: 0.2, topP: 0.7, maxTokens: 4096, stream: true, contextWindow: 32_768 },
        recommendedFor: [AIMode.Agent], sizeBytes: 0.35e9
    },
    {
        id: 'gemma:2b', name: 'Gemma 2B', provider: ModelProvider.Ollama, isAvailable: false,
        modelId: 'gemma:2b', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 2048, stream: true, contextWindow: 8_192 },
        recommendedFor: [AIMode.Agent], sizeBytes: 1.5e9
    },
    // LlamaCpp (GGUF) - Local inference via bundled llama.cpp
    {
        id: 'llamacpp-coder05b', name: 'Qwen 2.5 Coder 0.5B (Q8_0)', provider: ModelProvider.LlamaCpp, isAvailable: false,
        modelId: 'qwen2.5-coder-0.5b-q8_0.gguf', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 2048, stream: true, contextWindow: 32_768 },
        recommendedFor: [AIMode.Agent], sizeBytes: 495e6
    },
    {
        id: 'llamacpp-qwen3b', name: 'Qwen 2.5 VL 3B (Q4_K_M)', provider: ModelProvider.LlamaCpp, isAvailable: false,
        modelId: 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 2048, stream: true, contextWindow: 32_768 },
        recommendedFor: [AIMode.Agent], sizeBytes: 2.0e9
    },
    // OpenAI-compatible - Generic entries for BYOK providers (OpenRouter, etc.).
    // contextWindow stays unset here so the saved preset's value drives it.
    {
        id: 'openai-compatible-generic', name: 'OpenAI Compatible (Custom)', provider: ModelProvider.OpenAICompatible, isAvailable: true,
        modelId: 'openai-compatible-generic', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 4096, stream: true },
        recommendedFor: [AIMode.Agent], sizeBytes: undefined
    },
    {
        id: 'unified-mode', name: 'Unified Mode (Auto-detect)', provider: ModelProvider.OpenAICompatible, isAvailable: true,
        modelId: 'unified-mode', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 4096, stream: true },
        recommendedFor: [AIMode.Agent], sizeBytes: undefined
    }
];

/**
 * Get status of all AI providers
 */
export async function getProvidersStatus(): Promise<ProviderStatus[]> {
    try {
        // Get backend provider status (Ollama, etc.)
        // Pass Ollama endpoint from config
        const { loadAIConfig } = await import('./config');
        const config = loadAIConfig();

        console.log('[getProvidersStatus] Calling backend with ollamaEndpoint:', config.endpoints.ollama);
        const backendStatuses = await invoke<ProviderStatus[]>('get_ai_providers_status', {
            ollamaEndpoint: config.endpoints.ollama
        });
        console.log('[getProvidersStatus] Received backend statuses:', backendStatuses);

        // Merge backend/installed models with KNOWN_MODELS for Ollama
        // Robust check: Handle case sensitivity or missing status
        let ollamaStatus = backendStatuses.find(p => p.provider.toLowerCase() === ModelProvider.Ollama.toLowerCase());

        if (!ollamaStatus) {
            // If backend didn't return Ollama status (e.g. not running/found), create a placeholder
            // so we can still show the "Library" of known models for download guidance
            ollamaStatus = {
                provider: ModelProvider.Ollama,
                isAvailable: false,
                availableModels: [],
                version: undefined
            };
            backendStatuses.push(ollamaStatus);
        }

        if (ollamaStatus) {
            // Ensure availableModels exists (backend might return null or snake_case if misconfigured)
            if (!ollamaStatus.availableModels) {
                ollamaStatus.availableModels = [];
            }

            const installedIds = new Set(ollamaStatus.availableModels.map(m => m.modelId));

            // Add uninstalled KNOWN_MODELS with the correct endpoint
            KNOWN_MODELS.forEach(known => {
                if (known.provider === ModelProvider.Ollama && !installedIds.has(known.modelId)) {
                    const modelWithEndpoint = {
                        ...known,
                        endpoint: config.endpoints.ollama,
                        isAvailable: false // Mark as not available since not installed
                    };
                    console.log('[getProvidersStatus] Adding KNOWN_MODEL:', known.modelId, 'with endpoint:', modelWithEndpoint.endpoint);
                    ollamaStatus.availableModels.push(modelWithEndpoint);
                }
            });

            // Log all Ollama models with their endpoints
            console.log('[getProvidersStatus] Final Ollama models:',
                ollamaStatus.availableModels.map(m => ({
                    id: m.id,
                    modelId: m.modelId,
                    endpoint: m.endpoint,
                    isAvailable: m.isAvailable
                }))
            );
        }

        // Add TransformerJS status (browser-based) without loading the module
        // We define models statically to avoid loading the heavy TransformerJS library
        // until it's actually needed
        const transformerJSStatus: ProviderStatus = {
            provider: ModelProvider.TransformerJS,
            isAvailable: true,
            version: '2.17.2',
            availableModels: [
                {
                    id: 'transformerjs-distilbart',
                    name: 'DistilBART CNN (Small)',
                    provider: ModelProvider.TransformerJS,
                    modelId: 'Xenova/distilbart-cnn-6-6',
                    parameters: {
                        temperature: 0.7,
                        topP: 0.9,
                        maxTokens: 512,
                        stream: false,
                    },
                    isAvailable: true,
                    sizeBytes: 268_000_000,
                    recommendedFor: [AIMode.Agent],
                },
                {
                    id: 'transformerjs-bart-large',
                    name: 'BART Large CNN',
                    provider: ModelProvider.TransformerJS,
                    modelId: 'Xenova/bart-large-cnn',
                    parameters: {
                        temperature: 0.7,
                        topP: 0.9,
                        maxTokens: 1024,
                        stream: false,
                    },
                    isAvailable: true,
                    sizeBytes: 1_630_000_000,
                    recommendedFor: [AIMode.Agent],
                },
            ],
        };

        // Add OpenAI-Compatible KNOWN_MODELS so they appear in availableModels
        // (needed for provider switching to find models to select)
        const openAICompatibleStatus: ProviderStatus = {
            provider: ModelProvider.OpenAICompatible,
            isAvailable: true,
            version: undefined,
            availableModels: KNOWN_MODELS.filter(m => m.provider === ModelProvider.OpenAICompatible).map(m => ({
                ...m,
                endpoint: config.endpoints.openaiCompatible,
            })),
        };

        // Add LlamaCpp KNOWN_MODELS for the model library (installed models come from backend)
        const llamacppStatus = backendStatuses.find(p => p.provider.toLowerCase() === ModelProvider.LlamaCpp.toLowerCase());
        if (llamacppStatus) {
            const installedLcIds = new Set(llamacppStatus.availableModels.map(m => m.modelId));
            KNOWN_MODELS.forEach(known => {
                if (known.provider === ModelProvider.LlamaCpp && !installedLcIds.has(known.modelId)) {
                    llamacppStatus.availableModels.push(known);
                }
            });
        }

        return [transformerJSStatus, openAICompatibleStatus, ...backendStatuses];
    } catch (error) {
        console.error('Failed to get provider status:', error);
        return [];
    }
}

/**
 * Get available models for a provider
 */
export async function getProviderModels(
    provider: ModelProvider,
    endpoint?: string
): Promise<ModelConfig[]> {
    if (provider === ModelProvider.TransformerJS) {
        const transformerJS = await getTransformerJS();
        return transformerJS.getAvailableTransformerJSModels();
    }

    try {
        return await invoke<ModelConfig[]>('get_provider_models', {
            provider: provider.toString(),
            endpoint,
        });
    } catch (error) {
        console.error(`Failed to get models for ${provider}:`, error);
        return [];
    }
}

/**
 * Check if a provider is available
 */
export async function checkProviderAvailability(
    provider: ModelProvider,
    endpoint?: string
): Promise<boolean> {
    if (provider === ModelProvider.TransformerJS) {
        const transformerJS = await getTransformerJS();
        return await transformerJS.isTransformerJSAvailable();
    }

    try {
        return await invoke<boolean>('check_provider_availability', {
            provider: provider.toString(),
            endpoint,
        });
    } catch (error) {
        console.error(`Failed to check availability for ${provider}:`, error);
        return false;
    }
}

/**
 * Cancel an ongoing inference request
 */
export async function cancelInference(sessionId: string): Promise<void> {
    try {
        await invoke('cancel_inference', { sessionId });
        console.log('[ai-service] Cancelled inference for session:', sessionId);
    } catch (error) {
        console.error('[ai-service] Failed to cancel inference:', error);
        throw error;
    }
}

/**
 * Run AI inference
 */
export async function runInference(
    request: InferenceRequest,
    onChunk?: (chunk: string) => void,
    onProgress?: (progress: any) => void
): Promise<InferenceResponse> {
    // Add system prompt based on mode
    const messagesWithSystem = prepareMessages(request);
    let requestWithSystem = { ...request, messages: messagesWithSystem };

    // Add native function calling tool for providers that support it
    // (LlamaCpp + OpenAI-compatible). More reliable than XML tool calling.
    if (
        !request.suppressTools &&
        [ModelProvider.LlamaCpp, ModelProvider.OpenAICompatible].includes(request.modelConfig.provider)
    ) {
        const tools: Tool[] = [EXECUTE_COMMAND_TOOL, AGENT_ACTION_TOOL];
        if (featureFlags.memoryCrossConversationSearch) {
            tools.push(SEARCH_CONVERSATIONS_TOOL);
        }
        if (canUseComputerTools(request.modelConfig)) {
            tools.push(...COMPUTER_TOOLS);
        }
        requestWithSystem = {
            ...requestWithSystem,
            tools,
        };
    }

    // Route to appropriate provider
    if (request.modelConfig.provider === ModelProvider.TransformerJS) {
        const transformerJS = await getTransformerJS();
        return await transformerJS.runTransformerJSInference(requestWithSystem, onChunk, onProgress);
    }

    // For backend providers (Ollama, OpenAI-compatible, LlamaCpp)
    try {
        let unlistenChunk: (() => void) | undefined;
        let unlistenProgress: (() => void) | undefined;

        // Setup streaming listener if onChunk callback is provided
        if (onChunk) {
            unlistenChunk = await listen<string>('ai-response-chunk', (event) => {
                onChunk(event.payload);
            });
        }

        // Setup LlamaCpp download progress listener
        if (onProgress && request.modelConfig.provider === ModelProvider.LlamaCpp) {
            unlistenProgress = await listen<any>('llamacpp-download-progress', (event) => {
                onProgress(event.payload);
            });
        }

        const response = await invoke<InferenceResponse>('run_ai_inference', {
            request: requestWithSystem,
        });

        if (unlistenChunk) unlistenChunk();
        if (unlistenProgress) unlistenProgress();
        return response;
    } catch (error: any) {
        console.error('[ai-service] Inference failed:', error);
        throw new Error(error || 'Inference failed');
    }
}

/**
 * Prepare messages with system prompt
 */
function prepareMessages(request: InferenceRequest): ChatMessage[] {
    const budget = computeMemoryBudget(
        request.modelConfig.parameters.contextWindow,
        request.modelConfig.parameters.maxTokens,
    );
    const windowBudget = budget.historyBudget || DEFAULT_WINDOW_CONFIG.budgetTokens;

    if (request.skipSystemPrompt) {
        const withScreenshotCap = trimScreenshotPayload(request.messages, 3).messages;
        if (featureFlags.memorySlidingWindow) {
            const trimmed = trimToTokenBudget(withScreenshotCap, windowBudget);
            return trimmed.messages;
        }
        return withScreenshotCap;
    }
    try {
        const template = getTemplateForMode(request.mode);

        // Build context string
        const fsContextStr = request.fsContext
            ? buildFileSystemContext(request.fsContext)
            : 'No file system context available.';

    const executeCommandDesc = `## Two tools, two jobs

Think of \`agent_action\` and \`execute_command\` as a pair:
- Use **\`execute_command\`** to *gather* information from the file system (sizes, listings, contents).
- Use **\`agent_action\`** to *present* paths the user can click and to *propose* destructive operations as inline cards. Plain markdown paths are dead text; the user cannot click them.

If your reply mentions a path, you owe an \`agent_action\` for it. If you are proposing a delete / move / overwrite, you owe an \`agent_action(confirm_action)\` with a complete \`suggestedCommand\` — never ask "should I delete X?" in chat.

## agent_action Tool

Emit a structured action the app renders natively (clickable chips, confirmation cards, navigation, file highlights). The app gates user safety; you focus on intent.

Tool: agent_action
Arguments:
  - action (string, REQUIRED): one of "navigate", "open_file", "highlight", "confirm_action".
  - paths (array of strings, REQUIRED): one or more absolute paths (POSIX "/…" or Windows "C:\\…"). For navigate/open_file the app uses paths[0].
  - title (string, REQUIRED for confirm_action): plain text, ≤ 500 chars.
  - description (string, REQUIRED for confirm_action): plain text body, ≤ 500 chars.
  - suggestedCommand (string, REQUIRED for confirm_action): the EXACT shell command the app will run verbatim if the user clicks Execute. Use single-quoted paths to handle spaces.
  - suggestedWorkingDir (string, REQUIRED for confirm_action): absolute working directory for suggestedCommand.
  - totalSize (number, optional): total bytes; used for the card display.
  - severity (string, optional): "low" | "medium" | "high". Defaults to "medium" if omitted. The app auto-escalates to "high" for system paths (/System, /usr, /Library, C:\\Windows, …) or operations over 10 GiB / 50 paths regardless of what you claim.

Hard limits enforced at dispatch (the call fails if you exceed them):
- ≤ 5 agent_action calls per model response. Batch related paths into one confirm_action where possible.
- Paths must be absolute, free of newlines / NUL bytes, ≤ 4096 chars.
- suggestedCommand must not contain embedded newlines.

Example — after \`du -sh ~/Library ~/Documents\`:
  agent_action {"action":"navigate","paths":["/Users/you/Library"]}
  agent_action {"action":"navigate","paths":["/Users/you/Documents"]}

Example — proposing a cache cleanup (do this INSTEAD of asking in text):
  agent_action {
    "action":"confirm_action",
    "paths":["/Users/you/Library/Caches"],
    "title":"Clear app caches",
    "description":"Removes contents of ~/Library/Caches. Apps regenerate caches; no user data lost.",
    "suggestedCommand":"rm -rf '/Users/you/Library/Caches'/*",
    "suggestedWorkingDir":"/",
    "severity":"medium",
    "totalSize":271390000
  }

## execute_command Tool

Run shell commands to gather information. After any command returns paths the user might care about, follow up with one or more agent_action calls.

Tool: execute_command
Description: Execute a shell command on the file system. Use this for ALL file operations including reading, writing, searching, listing, moving, and analyzing files and directories.
Arguments:
  - cmd (string, required): The shell command to execute. Runs via \`sh -c "<cmd>"\`.
  - working_dir (string, required): Working directory for the command (absolute path).
  - timeout_secs (number, optional): Timeout in seconds (default: 30, max: 300).

Returns: { stdout: string, stderr: string, exit_code: number, timed_out: boolean }

IMPORTANT USAGE RULES:
- ALWAYS use this tool for ALL file operations. NEVER guess or hallucinate file contents.
- Use standard Unix commands: \`ls\`, \`cat\`, \`find\`, \`grep\`, \`du\`, \`mv\`, \`cp\`, \`mkdir\`, \`rm\`, \`head\`, \`tail\`, \`wc\`, \`md5sum\`, \`file\`, \`stat\`
- For reading files: \`cat <path>\` or \`head -n 100 <path>\` — these prompt the user for permission before running.
- For listing directories: \`ls -la <path>\`
- For searching: \`find <dir> -name "*pattern*"\` or \`grep -r "pattern" <dir>\`
- For directory sizes: \`du -sh <dir>/*\`
- Output is capped at ~10K characters. For large outputs, use \`head\`/\`tail\` to limit.
- The command runs in the specified working directory.
- Default timeout is 30 seconds. Use timeout_secs for long-running operations.
- Security-blocked commands include: destructive system operations, privilege escalation, shutdown commands.
- File-reading commands (cat/less/more/head/tail/bat/od/xxd/strings) and write/move commands (rm/mv/cp/dd, shell redirects) prompt the user for explicit approval before executing.
- For destructive operations the preferred path is NOT direct \`execute_command\` — emit an \`agent_action(confirm_action)\` instead so the user sees an inline card.

${featureFlags.memoryCrossConversationSearch ? `## search_conversations Tool

Search the user's prior conversations for a keyword. Use ONLY when the user references past chats and the current context doesn't contain the answer.

Tool: search_conversations
Arguments:
  - query (string, required): Substring to search for (case-insensitive).
  - limit (number, optional): Max results, default 5, max 20.

Returns: Array of {id, title, updated, snippets[]} for matching conversations.

Do NOT call this for things you can answer from the current conversation or current file system. Calling unnecessarily wastes tokens.` : ''}

${canUseComputerTools(request.modelConfig) ? `## Computer-use tools (read-only, CU-M2)

The agent can see the user's screen and cursor. These three tools are autonomous (no user approval). Write tools — clicking, typing, key presses — land in CU-M3 and will route through approval cards.

### computer_screenshot
Captures the screen and returns { screenshot, width, height, displayIndex, x, y }. Use whenever you need to see what's on screen. Each call replaces the prior screenshot in your view; older screenshots drop from context (their text body stays — same retention as browser_observe).
Arguments: display_index (number, optional — omit for the primary display).

### computer_screen_size
Returns information about every connected display: { index, x, y, width, height, scaleFactor, isPrimary, name }. Call this before computer_screenshot in multi-monitor setups, or to plan future click coordinates.
Arguments: none.

### computer_cursor_position
Returns { x, y } in virtual-desktop coordinates. Useful before computer_screenshot to know where the user is looking. On Wayland-only Linux this returns a clear error (no global cursor API) — handle gracefully.
Arguments: none.

USAGE PATTERN (CU-M2 read-only):
  1. computer_screen_size   # learn the display layout
  2. computer_screenshot    # see the screen
  3. … reason about the screenshot
  Tell the user what you observed in plain language. Do not promise to click or type yet — those tools arrive in CU-M3.` : ''}`;

    let systemPrompt = buildPrompt(template.systemPrompt, {
        fs_context: fsContextStr,
        current_path: request.fsContext?.currentPath || '/',
        mcp_tools: executeCommandDesc,
        available_skills: request.skillCatalog || '(no skills installed)',
    });

    if (featureFlags.memoryUserProfile) {
        const profile = getCachedUserProfile();
        const fragment = buildProfileSystemFragment(profile);
        if (fragment) systemPrompt = `${systemPrompt}\n\n${fragment}`;
    }

    console.log('[ai-service] System prompt built:');
    console.log('[ai-service]   Mode:', request.mode);
    console.log('[ai-service]   System prompt length:', systemPrompt.length);
    console.log('[ai-service]   System prompt preview (first 500 chars):', systemPrompt.substring(0, 500));
    console.log('[ai-service]   Execute command tool description length:', executeCommandDesc.length);

    // Find an existing AGENT system message (id starts with "system-agent-")
    // and refresh it in place. We intentionally do NOT touch other system
    // messages in the array — those carry conversation-summary text (id
    // "summary-…") or invoked-skill bodies (id "skill-…") that must survive
    // the round-trip to the model. The previous unconditional replace was
    // silently overwriting summaries.
    const agentSystemIndex = request.messages.findIndex(
        (m) => m.role === MessageRole.System && m.id.startsWith('system-agent-'),
    );

    const systemMessage: ChatMessage = {
        id: `system-agent-${Date.now()}`,
        role: MessageRole.System,
        content: systemPrompt,
        timestamp: Date.now(),
    };

        let withSystem: ChatMessage[];
        if (agentSystemIndex !== -1) {
            withSystem = [...request.messages];
            withSystem[agentSystemIndex] = systemMessage;
        } else {
            withSystem = [systemMessage, ...request.messages];
        }

        // Cap retained screenshots before token windowing — older
        // computer_screenshot / browser_observe results keep their text but
        // drop the base64 JPEG to bound token cost across multi-step sessions.
        const capped = trimScreenshotPayload(withSystem, 3);
        if (capped.strippedCount > 0) {
            console.log(
                `[ai-service] Screenshot retention: stripped ${capped.strippedCount}, retained ${capped.retainedCount}`,
            );
        }

        if (featureFlags.memorySlidingWindow) {
            const trimmed = trimToTokenBudget(capped.messages, windowBudget);
            if (trimmed.droppedCount > 0) {
                console.log(
                    `[ai-service] Memory window dropped ${trimmed.droppedCount} message(s) — ${trimmed.tokensBefore} → ${trimmed.tokensAfter} est. tokens (budget ${windowBudget}, ctx ${budget.contextWindow})`,
                );
            }
            return trimmed.messages;
        }
        return capped.messages;
    } catch (error) {
        console.error('[ai-service] Error in prepareMessages:', error);
        console.error('[ai-service] Request:', request);
        // Return messages without modification if there's an error
        return request.messages;
    }
}

/**
 * Create a new chat message
 */
export function createMessage(
    role: MessageRole,
    content: string,
    contextPaths?: string[]
): ChatMessage {
    return {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role,
        content,
        timestamp: Date.now(),
        contextPaths,
    };
}

/**
 * Get the recommended default model. Prefers larger models since the only
 * mode is Agent (which benefits from stronger tool-using models).
 */
export function getDefaultModelForMode(
    _mode: AIMode | undefined,
    availableModels: ModelConfig[]
): ModelConfig | null {
    const recommendedModels = availableModels.filter((m) =>
        m.recommendedFor.includes(AIMode.Agent)
    );
    const pool = recommendedModels.length > 0 ? recommendedModels : availableModels;
    if (pool.length === 0) return null;
    return [...pool].sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))[0];
}

/**
 * Pull/Download a model from Ollama
 */
export async function pullOllamaModel(
    modelName: string,
    endpoint: string = 'http://localhost:11434',
    onProgress?: (data: any) => void
): Promise<void> {
    try {
        const response = await fetch(`${endpoint}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelName, stream: true }),
        });

        if (!response.ok) {
            throw new Error(`Ollama pull failed: ${response.statusText}`);
        }

        if (!response.body) throw new Error('No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');

            // Process all complete lines
            for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i].trim();
                if (line) {
                    try {
                        const json = JSON.parse(line);
                        if (json.error) throw new Error(json.error);
                        onProgress?.(json);
                    } catch (e) {
                        console.error("Error parsing JSON line:", e);
                    }
                }
            }

            // Keep the last partial line in buffer
            buffer = lines[lines.length - 1];
        }

    } catch (error) {
        console.error('Failed to pull model:', error);
        throw error;
    }
}
