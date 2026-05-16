/**
 * Per-model memory budgets.
 *
 * Production guidance (Atlan, LogRocket, Anthropic's own Claude Code team in
 * GitHub discussions): summarize when the conversation history hits 50-70% of
 * the model's *usable* context — not its raw advertised size. The raw size has
 * to be discounted by:
 *
 *   - The system prompt + tool descriptions we always send (~3K tokens here)
 *   - The reply space (maxTokens, ~2-4K typically)
 *   - A safety margin so we never overshoot the hard limit
 *
 * What's left is the "history budget". We trim raw history to fit within it
 * (Phase 1) and trigger summarization at 70% of it (Phase 2). This keeps the
 * thresholds correctly proportioned across the 4K-to-1M context-window range
 * of 2026 models, instead of a single hardcoded 4000 that's wrong for ~every
 * model that isn't a small llama.
 */

const SYSTEM_AND_TOOLS_RESERVE = 3000;
const SAFETY_RESERVE = 500;
const HISTORY_FRACTION = 0.6;
const SUMMARIZE_FRACTION_OF_BUDGET = 0.7;
const MIN_HISTORY_BUDGET = 1000;
const MIN_USABLE = 2000;

export const DEFAULT_CONTEXT_WINDOW = 8192;
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

export interface MemoryBudget {
    contextWindow: number;
    /** Max tokens of conversation history we'll send (post-summary, post-window). */
    historyBudget: number;
    /** When the running history (since the last summary) exceeds this, trigger summarization. */
    summarizeThreshold: number;
    /** Reserved for the assistant's reply. */
    reservedOutputTokens: number;
}

export function computeMemoryBudget(
    contextWindow: number | undefined,
    maxOutputTokens: number | undefined,
): MemoryBudget {
    const ctx = Math.max(2048, contextWindow ?? DEFAULT_CONTEXT_WINDOW);
    const output = Math.max(256, maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS);
    const usable = Math.max(MIN_USABLE, ctx - output - SYSTEM_AND_TOOLS_RESERVE - SAFETY_RESERVE);
    const historyBudget = Math.max(MIN_HISTORY_BUDGET, Math.floor(usable * HISTORY_FRACTION));
    const summarizeThreshold = Math.floor(historyBudget * SUMMARIZE_FRACTION_OF_BUDGET);
    return {
        contextWindow: ctx,
        historyBudget,
        summarizeThreshold,
        reservedOutputTokens: output,
    };
}

/**
 * Heuristic context-window suggestions keyed on common model-name fragments.
 * Used in the saved-provider UI to autofill a sane value when the user types
 * a model name, and in places that need a default without user input.
 *
 * Patterns are ordered specific → general so the first match wins.
 */
interface ContextHint {
    pattern: RegExp;
    tokens: number;
    label: string;
}

const HINTS: ContextHint[] = [
    { pattern: /gemini[\s\-_]?1\.?5[\s\-_]?pro/i, tokens: 1_000_000, label: 'Gemini 1.5 Pro' },
    { pattern: /gemini[\s\-_]?1\.?5[\s\-_]?flash/i, tokens: 1_000_000, label: 'Gemini 1.5 Flash' },
    { pattern: /gemini[\s\-_]?2/i, tokens: 1_000_000, label: 'Gemini 2.x' },
    { pattern: /claude.*(opus|sonnet|haiku).*4/i, tokens: 200_000, label: 'Claude 4.x' },
    { pattern: /claude.*(opus|sonnet|haiku).*(3\.5|3-5)/i, tokens: 200_000, label: 'Claude 3.5' },
    { pattern: /claude/i, tokens: 200_000, label: 'Claude (generic)' },
    { pattern: /^o[134]([\-_].+)?$/i, tokens: 200_000, label: 'OpenAI o-series' },
    { pattern: /gpt[\s\-_]?4o/i, tokens: 128_000, label: 'GPT-4o' },
    { pattern: /gpt[\s\-_]?4[\s\-_]?turbo/i, tokens: 128_000, label: 'GPT-4 Turbo' },
    { pattern: /gpt[\s\-_]?4/i, tokens: 8_192, label: 'GPT-4' },
    { pattern: /gpt[\s\-_]?3\.5[\s\-_]?turbo/i, tokens: 16_385, label: 'GPT-3.5 Turbo' },
    { pattern: /llama[\s\-_]?3\.?2/i, tokens: 131_072, label: 'Llama 3.2' },
    { pattern: /llama[\s\-_]?3\.?1/i, tokens: 131_072, label: 'Llama 3.1' },
    { pattern: /llama[\s\-_]?3/i, tokens: 8_192, label: 'Llama 3' },
    { pattern: /qwen[\s\-_]?3/i, tokens: 32_768, label: 'Qwen 3' },
    { pattern: /qwen[\s\-_]?2\.?5/i, tokens: 32_768, label: 'Qwen 2.5' },
    { pattern: /qwen/i, tokens: 32_768, label: 'Qwen (generic)' },
    { pattern: /mistral[\s\-_]?(large|nemo)/i, tokens: 128_000, label: 'Mistral Large/Nemo' },
    { pattern: /mistral|mixtral/i, tokens: 32_768, label: 'Mistral / Mixtral' },
    { pattern: /gemma[\s\-_]?2/i, tokens: 8_192, label: 'Gemma 2' },
    { pattern: /gemma/i, tokens: 8_192, label: 'Gemma' },
    { pattern: /deepseek[\s\-_]?(v3|r1|chat)/i, tokens: 131_072, label: 'DeepSeek V3/R1' },
    { pattern: /deepseek/i, tokens: 65_536, label: 'DeepSeek' },
    { pattern: /phi[\s\-_]?3/i, tokens: 128_000, label: 'Phi-3' },
    // GLM (Z.ai / OpenRouter). 4.5-Air and 4.5 both have 128K context.
    { pattern: /glm[\s\-_/]?4\.?5/i, tokens: 131_072, label: 'GLM-4.5' },
    { pattern: /glm[\s\-_/]?4/i, tokens: 131_072, label: 'GLM-4' },
    { pattern: /glm/i, tokens: 32_768, label: 'GLM (generic)' },
    // Other common free-tier OpenRouter routes
    { pattern: /(grok|x-ai)/i, tokens: 131_072, label: 'Grok' },
    { pattern: /yi[\s\-_]?(large|coder)/i, tokens: 131_072, label: 'Yi' },
    { pattern: /command[\s\-_]?r[\s\-_]?plus/i, tokens: 128_000, label: 'Command R+' },
    { pattern: /command[\s\-_]?r/i, tokens: 128_000, label: 'Command R' },
];

export interface ContextWindowSuggestion {
    tokens: number;
    label: string;
}

export function suggestContextWindow(modelName?: string): ContextWindowSuggestion | undefined {
    if (!modelName) return undefined;
    for (const h of HINTS) {
        if (h.pattern.test(modelName)) return { tokens: h.tokens, label: h.label };
    }
    return undefined;
}

/** A small set of common values to show as chips in the UI. */
export const COMMON_CONTEXT_WINDOWS: Array<{ tokens: number; label: string }> = [
    { tokens: 8_192, label: '8K' },
    { tokens: 32_768, label: '32K' },
    { tokens: 128_000, label: '128K' },
    { tokens: 200_000, label: '200K' },
    { tokens: 1_000_000, label: '1M' },
];

export function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
    return String(n);
}
