/**
 * Cheap token estimation. We don't ship a tokenizer — for budgeting we
 * only need order-of-magnitude accuracy, and 4 chars/token is the standard
 * approximation for English-heavy chat. Tool JSON inflates per-token cost
 * a bit, so we use 3.5 chars/token for content that looks like JSON.
 */

import { ChatMessage, MessageRole } from '@/types/ai-types';

const CHARS_PER_TOKEN_TEXT = 4;
const CHARS_PER_TOKEN_JSON = 3.5;
const PER_MESSAGE_OVERHEAD = 4;

function looksLikeJson(s: string): boolean {
    const t = s.trimStart();
    return t.startsWith('{') || t.startsWith('[') || t.includes('"arguments"');
}

export function estimateTokens(text: string): number {
    if (!text) return 0;
    const divisor = looksLikeJson(text) ? CHARS_PER_TOKEN_JSON : CHARS_PER_TOKEN_TEXT;
    return Math.ceil(text.length / divisor);
}

export function estimateMessageTokens(msg: ChatMessage): number {
    let total = estimateTokens(msg.content) + PER_MESSAGE_OVERHEAD;
    if (msg.toolExecutions?.length) {
        for (const exec of msg.toolExecutions) {
            total += estimateTokens(JSON.stringify(exec.arguments ?? {}));
            if (exec.result) total += estimateTokens(exec.result);
            if (exec.error) total += estimateTokens(exec.error);
        }
    }
    if (msg.toolCalls?.length) {
        for (const call of msg.toolCalls) {
            total += estimateTokens(call.function?.arguments ?? '');
        }
    }
    return total;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
    let total = 0;
    for (const m of messages) total += estimateMessageTokens(m);
    return total;
}

export function isSystemMessage(m: ChatMessage): boolean {
    return m.role === MessageRole.System;
}
