/**
 * Phase 3 memory: durable user profile.
 *
 * Stored once per user (~/.ittoolkit/user_profile.md), not per-conversation.
 * Holds short factual statements about the user — preferences, role, ongoing
 * projects — so every new conversation starts pre-loaded with the same context
 * the human would expect a colleague to remember.
 *
 * Mirrors how ChatGPT / Gemini implement chat memory: extracted facts +
 * structured profile, NOT vector RAG over raw history. Each fact has a
 * reinforcement count and last-seen timestamp so Phase 5 can decay stale ones.
 */

import { invoke } from '@tauri-apps/api/core';
import {
    AIMode,
    ChatMessage,
    InferenceRequest,
    MessageRole,
    ModelConfig,
    UserProfile,
} from '@/types/ai-types';
import { runInference } from '../ai-service';
import { setCachedUserProfile } from './profile-cache';

const FACT_EXTRACTION_TOKENS = 300;

const FACT_EXTRACTION_SYSTEM_PROMPT = `Extract durable facts about the USER from the conversation below.

A durable fact is something a future assistant would benefit from knowing in any conversation: their role, preferences, tools they use, projects they work on, recurring constraints. NOT one-off task state, NOT pleasantries, NOT facts about the assistant itself.

Output STRICTLY as a JSON array of short strings (each ≤ 200 chars). No prose, no markdown, no explanation. If nothing durable was learned, return [].

Examples of good facts:
  ["User is a senior data engineer", "User's primary project is the ittoolkit Tauri app", "User prefers terse responses"]

Examples of what to skip:
  - "User asked about file X today" (ephemeral)
  - "Assistant uses execute_command" (about the assistant)
  - "User said hello" (no signal)`;

export async function loadUserProfile(): Promise<UserProfile> {
    try {
        return await invoke<UserProfile>('load_user_profile');
    } catch (e) {
        console.warn('[profile] load failed:', e);
        return { facts: [] };
    }
}

export async function mergeUserProfileFacts(facts: string[]): Promise<UserProfile> {
    const cleaned = facts
        .map((f) => f.trim())
        .filter((f) => f.length > 0 && f.length < 240);
    if (cleaned.length === 0) {
        return loadUserProfile();
    }
    const updated = await invoke<UserProfile>('merge_user_profile_facts', { facts: cleaned });
    setCachedUserProfile(updated);
    return updated;
}

/** Try to pull JSON from a response that may have ```json fences or chatter around it. */
function tryParseFactArray(text: string): string[] {
    const trimmed = text.trim();
    const tryParse = (s: string): string[] | null => {
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
                return parsed;
            }
        } catch {
            return null;
        }
        return null;
    };

    const direct = tryParse(trimmed);
    if (direct) return direct;

    const fenced = trimmed.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    if (fenced && fenced[1]) {
        const fencedParsed = tryParse(fenced[1]);
        if (fencedParsed) return fencedParsed;
    }

    const bracketStart = trimmed.indexOf('[');
    const bracketEnd = trimmed.lastIndexOf(']');
    if (bracketStart !== -1 && bracketEnd > bracketStart) {
        const slice = trimmed.slice(bracketStart, bracketEnd + 1);
        const sliceParsed = tryParse(slice);
        if (sliceParsed) return sliceParsed;
    }
    return [];
}

function flattenForFactExtraction(messages: ChatMessage[]): string {
    const lines: string[] = [];
    for (const m of messages) {
        if (m.role === MessageRole.System) continue;
        const role = m.role === MessageRole.User ? 'User' : 'Assistant';
        const content = (m.content ?? '').trim();
        if (!content) continue;
        const truncated = content.length > 800 ? `${content.slice(0, 800)}…` : content;
        lines.push(`${role}: ${truncated}`);
    }
    return lines.join('\n\n');
}

export async function extractFactsFromConversation(
    messages: ChatMessage[],
    modelConfig: ModelConfig,
): Promise<string[]> {
    const conversationText = flattenForFactExtraction(messages);
    if (!conversationText.trim()) return [];

    const extractionModel: ModelConfig = {
        ...modelConfig,
        parameters: {
            ...modelConfig.parameters,
            maxTokens: FACT_EXTRACTION_TOKENS,
            stream: false,
            temperature: 0.1,
        },
    };

    const request: InferenceRequest = {
        sessionId: `facts-${Date.now()}`,
        modelConfig: extractionModel,
        mode: AIMode.Agent,
        messages: [
            {
                id: `facts-sys-${Date.now()}`,
                role: MessageRole.System,
                content: FACT_EXTRACTION_SYSTEM_PROMPT,
                timestamp: Date.now(),
            },
            {
                id: `facts-user-${Date.now()}`,
                role: MessageRole.User,
                content: `Conversation:\n\n${conversationText}\n\nReturn the JSON array now.`,
                timestamp: Date.now(),
            },
        ],
        skipSystemPrompt: true,
        suppressTools: true,
    };

    try {
        const response = await runInference(request);
        return tryParseFactArray(response.message.content);
    } catch (e) {
        console.warn('[profile] fact extraction failed:', e);
        return [];
    }
}
