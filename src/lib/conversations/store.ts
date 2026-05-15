import { invoke } from '@tauri-apps/api/core';
import {
    ChatMessage,
    Conversation,
    ConversationSummary,
    MessageRole,
    StoredMessage,
    StoredToolExecution,
    ToolExecutionData,
} from '@/types/ai-types';

function toStoredToolExecution(t: ToolExecutionData): StoredToolExecution {
    return {
        toolName: t.toolName,
        arguments: t.arguments as Record<string, unknown>,
        result: t.result,
        error: t.error,
        status: t.status,
    };
}

function fromStoredToolExecution(t: StoredToolExecution): ToolExecutionData {
    const validStatuses = ['executing', 'success', 'error', 'cancelled'] as const;
    const status = (validStatuses as readonly string[]).includes(t.status)
        ? (t.status as ToolExecutionData['status'])
        : 'success';
    return {
        toolName: t.toolName,
        arguments: (t.arguments ?? {}) as Record<string, unknown>,
        result: t.result,
        error: t.error,
        status,
    };
}

export function toStoredMessage(msg: ChatMessage): StoredMessage {
    return {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        toolExecutions: msg.toolExecutions?.map(toStoredToolExecution),
    };
}

export function fromStoredMessage(msg: StoredMessage): ChatMessage {
    const role = ((): MessageRole => {
        switch (msg.role) {
            case 'user': return MessageRole.User;
            case 'assistant': return MessageRole.Assistant;
            case 'system': return MessageRole.System;
            default: return MessageRole.Assistant;
        }
    })();
    return {
        id: msg.id,
        role,
        content: msg.content,
        timestamp: msg.timestamp,
        toolExecutions: msg.toolExecutions?.map(fromStoredToolExecution),
    };
}

export async function listConversations(): Promise<ConversationSummary[]> {
    return invoke<ConversationSummary[]>('list_conversations');
}

export async function loadConversation(id: string): Promise<Conversation> {
    return invoke<Conversation>('load_conversation', { id });
}

export async function createConversation(
    firstMessage: ChatMessage,
    options: { model?: string; provider?: string; mode?: string } = {}
): Promise<Conversation> {
    return invoke<Conversation>('create_conversation', {
        firstMessage: toStoredMessage(firstMessage),
        model: options.model,
        provider: options.provider,
        mode: options.mode,
    });
}

export async function appendMessage(id: string, message: ChatMessage): Promise<void> {
    return invoke<void>('append_message', {
        id,
        message: toStoredMessage(message),
    });
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
    return invoke<void>('update_conversation_title', { id, title });
}

export async function deleteConversation(id: string): Promise<void> {
    return invoke<void>('delete_conversation', { id });
}
