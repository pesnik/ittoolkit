/**
 * Phase 2 memory: running conversation summary.
 *
 * When a conversation grows past `SUMMARIZE_TOKEN_THRESHOLD`, we ask the model
 * to produce a structured synthesis covering decisions, key facts, in-flight
 * task state, and topics. The summary is persisted on the conversation file's
 * frontmatter and re-prepended on every subsequent turn — so reopening a long
 * chat (or one from a month ago) lands with context already loaded, instead of
 * an empty "what would you like?" cold start.
 */

import {
    ChatMessage,
    Conversation,
    InferenceRequest,
    MessageRole,
    ModelConfig,
    AIMode,
    StoredMessage,
} from '@/types/ai-types';
import { runInference } from '../ai-service';
import { fromStoredMessage } from '@/lib/conversations/store';
import { estimateMessagesTokens } from './tokens';
import { summaryStalenessNote } from './forgetting';
import { featureFlags } from '@/lib/featureFlags';

const FALLBACK_SUMMARIZE_TOKEN_THRESHOLD = 4000;
const KEEP_MESSAGES_AFTER_SUMMARY = 6;
const SUMMARY_MAX_TOKENS = 600;

const SUMMARY_SYSTEM_PROMPT = `You are summarizing a conversation so a future assistant can pick up where it left off.

Produce a concise markdown summary (≤ 300 words) with these sections, in order:

**Decisions**
- Concrete conclusions reached. Skip if none.

**Key facts**
- Specific data, file paths, configurations, names mentioned. Be exact.

**In-flight task**
- What was the user actively working on at the end? What step were they on? What's done, what remains? Be specific. If nothing was in progress, say "None".

**Topics**
- Brief bullet list of what was discussed.

Skip pleasantries and acknowledgements. Do not invent details. If a previous summary is provided, integrate its still-relevant parts and discard what's been superseded.`;

export interface SummaryDecision {
    shouldSummarize: boolean;
    reason: string;
}

export function shouldSummarize(
    messages: ChatMessage[],
    currentSummaryThroughTimestamp: number | undefined,
    summarizeThreshold: number = FALLBACK_SUMMARIZE_TOKEN_THRESHOLD,
): SummaryDecision {
    const newMessages = currentSummaryThroughTimestamp
        ? messages.filter((m) => m.timestamp > currentSummaryThroughTimestamp)
        : messages;
    const tokens = estimateMessagesTokens(newMessages);
    if (tokens >= summarizeThreshold) {
        return { shouldSummarize: true, reason: `${tokens} new tokens >= ${summarizeThreshold}` };
    }
    return { shouldSummarize: false, reason: `${tokens} new tokens (under ${summarizeThreshold})` };
}

function flattenForSummary(messages: ChatMessage[]): string {
    const lines: string[] = [];
    for (const m of messages) {
        if (m.role === MessageRole.System) continue;
        const role = m.role === MessageRole.User ? 'User' : 'Assistant';
        lines.push(`### ${role}`);
        if (m.content?.trim()) lines.push(m.content.trim());
        if (m.toolExecutions?.length) {
            for (const exec of m.toolExecutions) {
                lines.push(`(tool: ${exec.toolName} ${exec.status})`);
                if (exec.result) {
                    const snippet = exec.result.length > 400
                        ? `${exec.result.slice(0, 400)}…`
                        : exec.result;
                    lines.push(`> ${snippet.replace(/\n/g, '\n> ')}`);
                }
            }
        }
        lines.push('');
    }
    return lines.join('\n');
}

export async function generateConversationSummary(
    messages: ChatMessage[],
    modelConfig: ModelConfig,
    previousSummary?: string,
): Promise<string> {
    const conversationText = flattenForSummary(messages);
    const userContent = previousSummary
        ? `Previous summary:\n${previousSummary}\n\n---\n\nNew conversation since previous summary:\n${conversationText}`
        : `Conversation:\n${conversationText}`;

    const summarizationModel: ModelConfig = {
        ...modelConfig,
        parameters: {
            ...modelConfig.parameters,
            maxTokens: SUMMARY_MAX_TOKENS,
            stream: false,
            temperature: 0.2,
        },
    };

    const request: InferenceRequest = {
        sessionId: `summary-${Date.now()}`,
        modelConfig: summarizationModel,
        mode: AIMode.Agent,
        messages: [
            {
                id: `summary-sys-${Date.now()}`,
                role: MessageRole.System,
                content: SUMMARY_SYSTEM_PROMPT,
                timestamp: Date.now(),
            },
            {
                id: `summary-user-${Date.now()}`,
                role: MessageRole.User,
                content: userContent,
                timestamp: Date.now(),
            },
        ],
        skipSystemPrompt: true,
        suppressTools: true,
    };

    const response = await runInference(request);
    return response.message.content.trim();
}

/** Build a system-role message that prepends the summary to the next prompt. */
export function buildSummarySystemMessage(summary: string, summaryUpdatedAt?: string): ChatMessage {
    const stalenessNote = featureFlags.memoryForgetting
        ? summaryStalenessNote(summaryUpdatedAt)
        : '';
    return {
        id: `summary-${Date.now()}`,
        role: MessageRole.System,
        content: `## Conversation summary so far\n\n${summary}\n\n---\n\nThe user is continuing the conversation. Use the summary above for context.${stalenessNote}`,
        timestamp: Date.now(),
    };
}

export interface SummaryState {
    summary?: string;
    summaryThroughTimestamp?: number;
    summaryUpdatedAt?: string;
}

/**
 * Given the conversation's stored summary state plus the live message list,
 * return the message array to actually send: summary system message + only
 * messages newer than the summary cutoff. Existing system messages (e.g. an
 * inline /skill body) are preserved.
 *
 * If no summary exists, returns the messages unchanged.
 */
export function applySummaryToOutgoing(
    messages: ChatMessage[],
    state: SummaryState | null,
): ChatMessage[] {
    if (!state?.summary || !state.summaryThroughTimestamp) {
        return messages;
    }
    const cutoff = state.summaryThroughTimestamp;
    const summaryMsg = buildSummarySystemMessage(state.summary, state.summaryUpdatedAt);
    const recent = messages.filter(
        (m) => m.role === MessageRole.System || m.timestamp > cutoff,
    );
    return [summaryMsg, ...recent];
}

export function loadConversationMessages(conv: Conversation): ChatMessage[] {
    return conv.messages.map((m: StoredMessage) => fromStoredMessage(m));
}

export const SUMMARY_KEEP_MESSAGES_AFTER = KEEP_MESSAGES_AFTER_SUMMARY;
export const SUMMARY_FALLBACK_THRESHOLD = FALLBACK_SUMMARIZE_TOKEN_THRESHOLD;
