/**
 * Phase 1 memory: sliding window + token budget.
 *
 * Trims a ChatMessage[] so it fits within `budgetTokens`, while:
 *   - keeping ALL system messages (system prompt, summary, profile, skill body)
 *     unchanged — they're accounted for separately in `computeMemoryBudget`,
 *     so this function does NOT subtract them again (that double-count caused
 *     small-budget cases to drop every user message)
 *   - keeping the most recent non-system messages within `budgetTokens`
 *   - ALWAYS keeping the most recent non-system message, even if it busts the
 *     budget — better to let the API reject an oversized prompt with a clear
 *     error than silently swallow the user's question
 *   - never leaving an orphan tool-result message at the head of the trimmed
 *     non-system tail (it would confuse the model — a tool result with no
 *     preceding tool call)
 */

import { ChatMessage, MessageRole } from '@/types/ai-types';
import { estimateMessageTokens, estimateMessagesTokens, isSystemMessage } from './tokens';

const TOOL_RESULT_PREFIXES = ['Tool ', '<tool_result', '[tool_result'];

export interface WindowResult {
    messages: ChatMessage[];
    droppedCount: number;
    tokensBefore: number;
    tokensAfter: number;
}

function looksLikeOrphanToolResult(m: ChatMessage): boolean {
    if (m.role !== MessageRole.User) return false;
    const c = (m.content ?? '').trimStart();
    return TOOL_RESULT_PREFIXES.some((p) => c.startsWith(p));
}

/**
 * @param budgetTokens budget for the *conversational* (non-system) portion of
 *   the prompt. The system reserve is already baked into this number upstream
 *   in `computeMemoryBudget` — do not subtract it again.
 */
export function trimToTokenBudget(
    messages: ChatMessage[],
    budgetTokens: number,
): WindowResult {
    const tokensBefore = estimateMessagesTokens(messages);
    const systemMessages = messages.filter(isSystemMessage);
    const conversational = messages.filter((m) => !isSystemMessage(m));

    if (estimateMessagesTokens(conversational) <= budgetTokens) {
        return { messages, droppedCount: 0, tokensBefore, tokensAfter: tokensBefore };
    }

    const kept: ChatMessage[] = [];
    let runningTokens = 0;
    for (let i = conversational.length - 1; i >= 0; i--) {
        const msg = conversational[i];
        const cost = estimateMessageTokens(msg);
        const isLast = i === conversational.length - 1;

        if (isLast) {
            // Always include the most recent non-system message, even if it
            // alone exceeds the budget. Stripping it would send a payload with
            // no user turn and the API would reject with a confusing error.
            kept.unshift(msg);
            runningTokens += cost;
            continue;
        }

        if (runningTokens + cost > budgetTokens) break;
        kept.unshift(msg);
        runningTokens += cost;
    }

    while (kept.length > 1 && looksLikeOrphanToolResult(kept[0])) {
        kept.shift();
    }

    const finalMessages = preserveSystemOrder(messages, systemMessages, kept);
    const tokensAfter = estimateMessagesTokens(finalMessages);
    return {
        messages: finalMessages,
        droppedCount: messages.length - finalMessages.length,
        tokensBefore,
        tokensAfter,
    };
}

function preserveSystemOrder(
    original: ChatMessage[],
    systemMessages: ChatMessage[],
    kept: ChatMessage[],
): ChatMessage[] {
    const keptIds = new Set(kept.map((m) => m.id));
    const result: ChatMessage[] = [];
    for (const m of original) {
        if (isSystemMessage(m)) {
            if (systemMessages.includes(m)) result.push(m);
        } else if (keptIds.has(m.id)) {
            result.push(m);
        }
    }
    return result;
}

export interface WindowConfig {
    budgetTokens: number;
}

/** Fallback used only when no per-model budget has been computed yet. */
export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
    budgetTokens: 6000,
};
