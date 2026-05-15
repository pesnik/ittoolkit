/**
 * AI Configuration
 *
 * Centralized configuration for AI models and providers.
 * Reads from .env with defaults from .env.example.
 */

import { ModelProvider } from '@/types/ai-types';

export interface AIConfig {
    defaultProvider: ModelProvider;
    defaultModels: {
        ollama: string;
        openai: string;
        llamacpp: string;
    };
    endpoints: {
        ollama: string;
        openaiCompatible: string;
        llamacpp: string;
    };
    parameters: {
        temperature: number;
        topP: number;
        maxTokens: number;
    };
    apiKeys: {
        openai?: string;
    };
    debug: {
        enableLogs: boolean;
    };
}

/**
 * Load AI configuration from environment variables.
 * Falls back to NEXT_PUBLIC_*_AGENT vars for backwards compatibility with
 * earlier two-mode configs that may still be set in users' .env files.
 */
export function loadAIConfig(): AIConfig {
    return {
        defaultProvider:
            (process.env.NEXT_PUBLIC_DEFAULT_AI_PROVIDER as ModelProvider) ||
            (process.env.NEXT_PUBLIC_DEFAULT_AI_PROVIDER_AGENT as ModelProvider) ||
            ModelProvider.LlamaCpp,

        defaultModels: {
            ollama:
                process.env.NEXT_PUBLIC_DEFAULT_OLLAMA_MODEL ||
                process.env.NEXT_PUBLIC_DEFAULT_OLLAMA_MODEL_AGENT ||
                'qwen2.5-coder:7b',
            openai:
                process.env.NEXT_PUBLIC_DEFAULT_OPENAI_MODEL ||
                process.env.NEXT_PUBLIC_DEFAULT_OPENAI_MODEL_AGENT ||
                'openai-compatible-generic',
            llamacpp:
                process.env.NEXT_PUBLIC_DEFAULT_LLAMACPP_MODEL ||
                process.env.NEXT_PUBLIC_DEFAULT_LLAMACPP_MODEL_AGENT ||
                'qwen2.5-coder-0.5b-q8_0.gguf',
        },

        endpoints: {
            ollama: process.env.NEXT_PUBLIC_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434',
            openaiCompatible: process.env.NEXT_PUBLIC_OPENAI_COMPATIBLE_ENDPOINT || 'http://127.0.0.1:8033/v1',
            llamacpp: process.env.NEXT_PUBLIC_LLAMACPP_ENDPOINT || 'http://127.0.0.1:8081',
        },

        parameters: {
            temperature: parseFloat(process.env.NEXT_PUBLIC_DEFAULT_TEMPERATURE || '0.7'),
            topP: parseFloat(process.env.NEXT_PUBLIC_DEFAULT_TOP_P || '0.9'),
            maxTokens: parseInt(process.env.NEXT_PUBLIC_DEFAULT_MAX_TOKENS || '2048', 10),
        },

        apiKeys: {
            openai: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
        },

        debug: {
            enableLogs: process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS === 'true',
        },
    };
}

export function getDefaultProvider(config?: AIConfig): ModelProvider {
    return (config || loadAIConfig()).defaultProvider;
}

export function getDefaultEndpoint(provider: ModelProvider, config?: AIConfig): string | undefined {
    const cfg = config || loadAIConfig();
    switch (provider) {
        case ModelProvider.Ollama:
            return cfg.endpoints.ollama;
        case ModelProvider.OpenAICompatible:
            return cfg.endpoints.openaiCompatible;
        case ModelProvider.LlamaCpp:
            return cfg.endpoints.llamacpp;
        default:
            return undefined;
    }
}

export function getDefaultModelId(provider: ModelProvider, config?: AIConfig): string {
    const cfg = config || loadAIConfig();
    switch (provider) {
        case ModelProvider.Ollama:
            return cfg.defaultModels.ollama;
        case ModelProvider.OpenAICompatible:
            return cfg.defaultModels.openai;
        case ModelProvider.LlamaCpp:
            return cfg.defaultModels.llamacpp;
        default:
            return '';
    }
}

// Export singleton instance
export const aiConfig = loadAIConfig();
