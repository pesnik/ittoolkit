import { invoke } from '@tauri-apps/api/core';
import { InferenceRequest, InferenceResponse, ChatMessage, MessageRole, ToolExecutionData } from '@/types/ai-types';
import { runInference } from './ai-service';
import { detectToolCall, extractToolCalls, formatToolResult, removeToolCallTags } from './tool-calling';

const MAX_TOOL_ITERATIONS = 5;

export interface ToolExecutionEvent {
    toolName: string;
    arguments: Record<string, unknown>;
    result?: string;
    error?: string;
    executionTimeMs?: number;
    cancelled?: boolean;
}

export type ConfirmKind = 'write' | 'read';

export interface InferenceWithToolsOptions {
    onChunk?: (chunk: string) => void;
    onToolExecution?: (event: ToolExecutionEvent) => void;
    onProgress?: (progress: any) => void;
    onConfirmExecution?: (
        toolName: string,
        args: Record<string, unknown>,
        kind: ConfirmKind
    ) => Promise<boolean>;
    isCancelled?: () => boolean;
}

// Commands that mutate the filesystem — confirm before running.
const WRITE_PATTERNS: RegExp[] = [
    /^\s*rm(\s|$)/,
    /^\s*mv(\s|$)/,
    /^\s*cp(\s|$)/,
    /^\s*dd(\s|$)/,
    /(^|[;&|]\s*)>\s*\S/,    // redirect to file (write/truncate)
    /(^|[;&|]\s*)>>\s*\S/,   // append redirect
];

// Commands that read file contents — confirm to protect the user's privacy
// (the model will see the file body otherwise). Directory-listing and metadata
// commands (ls, find, du, stat, file) are NOT gated; only commands that dump
// contents into the agent's context are.
const READ_PATTERNS: RegExp[] = [
    /^\s*cat(\s|$)/,
    /^\s*less(\s|$)/,
    /^\s*more(\s|$)/,
    /^\s*head(\s|$)/,
    /^\s*tail(\s|$)/,
    /^\s*bat(\s|$)/,
    /^\s*od(\s|$)/,
    /^\s*xxd(\s|$)/,
    /^\s*strings(\s|$)/,
];

function classifyCommand(cmd: string): ConfirmKind | null {
    if (WRITE_PATTERNS.some((p) => p.test(cmd))) return 'write';
    if (READ_PATTERNS.some((p) => p.test(cmd))) return 'read';
    return null;
}

interface ExecuteCommandResponse {
    stdout: string;
    stderr: string;
    exit_code: number;
    timed_out: boolean;
}

async function executeTool(toolCall: { name: string; arguments: Record<string, unknown> }): Promise<{
    content: string;
    isError: boolean;
}> {
    const { cmd, working_dir, timeout_secs } = toolCall.arguments as {
        cmd?: string;
        working_dir?: string;
        timeout_secs?: number;
    };

    const result = await invoke<ExecuteCommandResponse>('execute_command', {
        cmd: cmd ?? '',
        workingDir: working_dir ?? '',
        timeoutSecs: timeout_secs ?? null,
    });

    let content = '';
    if (result.stdout) content += result.stdout;
    if (result.stderr) {
        if (content) content += '\n';
        content += result.stderr;
    }

    const isError = result.exit_code !== 0 || result.timed_out;

    if (!content) {
        if (result.timed_out) {
            content = `Command timed out (exit code ${result.exit_code})`;
        } else if (result.exit_code !== 0) {
            content = `Command failed with exit code ${result.exit_code}`;
        } else {
            content = '(no output)';
        }
    }

    return { content, isError };
}

export async function runInferenceWithTools(
    request: InferenceRequest,
    options: InferenceWithToolsOptions = {}
): Promise<InferenceResponse> {
    const { onChunk, onToolExecution, onProgress, onConfirmExecution, isCancelled } = options;

    let currentRequest = { ...request };
    let iterations = 0;
    let finalResponse: InferenceResponse | null = null;
    const allToolExecutions: ToolExecutionData[] = [];

    while (iterations < MAX_TOOL_ITERATIONS) {
        if (isCancelled?.()) {
            throw new Error('Inference cancelled');
        }
        iterations++;

        const response = await runInference(currentRequest, onChunk, onProgress);

        let toolCalls: any[] = [];

        if (response.message.toolCalls && response.message.toolCalls.length > 0) {
            toolCalls = response.message.toolCalls.map((tc: any) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments),
            }));
        } else {
            const hasToolCalls = detectToolCall(response.message.content);

            if (!hasToolCalls) {
                finalResponse = response;
                break;
            }

            toolCalls = extractToolCalls(response.message.content);
        }

        if (toolCalls.length === 0) {
            finalResponse = response;
            break;
        }

        const toolResults: ChatMessage[] = [];

        for (const toolCall of toolCalls) {
            try {
                const startTime = Date.now();

                if (onToolExecution) {
                    onToolExecution({
                        toolName: toolCall.name,
                        arguments: toolCall.arguments,
                    });
                }

                const cmd = (toolCall.arguments?.cmd as string) || '';
                const confirmKind = toolCall.name === 'execute_command' ? classifyCommand(cmd) : null;
                const needsConfirm = !!(onConfirmExecution && confirmKind);

                if (needsConfirm && confirmKind) {
                    const confirmed = await onConfirmExecution!(toolCall.name, toolCall.arguments, confirmKind);
                    if (isCancelled?.()) {
                        throw new Error('Inference cancelled');
                    }
                    if (!confirmed) {
                        const cancelledExecution: ToolExecutionData = {
                            toolName: toolCall.name,
                            arguments: toolCall.arguments,
                            status: 'cancelled',
                            result: 'Cancelled by user',
                        };
                        allToolExecutions.push(cancelledExecution);

                        if (onToolExecution) {
                            onToolExecution({
                                toolName: toolCall.name,
                                arguments: toolCall.arguments,
                                result: 'Cancelled by user',
                                cancelled: true,
                            });
                        }

                        toolResults.push({
                            id: `tool-cancelled-${Date.now()}-${toolCall.id}`,
                            role: MessageRole.User,
                            content: formatToolResult(toolCall.name, 'Cancelled by user', false),
                            timestamp: Date.now(),
                        });
                        continue;
                    }
                }

                const toolExecution: ToolExecutionData = {
                    toolName: toolCall.name,
                    arguments: toolCall.arguments,
                    status: 'executing',
                };

                const result = await executeTool(toolCall);
                const executionTimeMs = Date.now() - startTime;

                toolExecution.status = result.isError ? 'error' : 'success';
                toolExecution.result = result.content;
                toolExecution.executionTimeMs = executionTimeMs;
                if (result.isError) {
                    toolExecution.error = result.content;
                }

                allToolExecutions.push(toolExecution);

                if (onToolExecution) {
                    onToolExecution({
                        toolName: toolCall.name,
                        arguments: toolCall.arguments,
                        result: result.content,
                        error: result.isError ? result.content : undefined,
                        executionTimeMs,
                    });
                }

                const toolResultMessage: ChatMessage = {
                    id: `tool-result-${Date.now()}-${toolCall.id}`,
                    role: MessageRole.User,
                    content: formatToolResult(toolCall.name, result.content, result.isError),
                    timestamp: Date.now(),
                };

                toolResults.push(toolResultMessage);
            } catch (error) {
                const toolExecution: ToolExecutionData = {
                    toolName: toolCall.name,
                    arguments: toolCall.arguments,
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error),
                };
                allToolExecutions.push(toolExecution);

                const errorMessage: ChatMessage = {
                    id: `tool-error-${Date.now()}-${toolCall.id}`,
                    role: MessageRole.User,
                    content: formatToolResult(
                        toolCall.name,
                        `Error: ${error instanceof Error ? error.message : String(error)}`,
                        true
                    ),
                    timestamp: Date.now(),
                };

                toolResults.push(errorMessage);

                if (onToolExecution) {
                    onToolExecution({
                        toolName: toolCall.name,
                        arguments: toolCall.arguments,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }

        const assistantMessage: ChatMessage = {
            ...response.message,
            content: removeToolCallTags(response.message.content) || '(Using tools...)',
        };

        currentRequest = {
            ...currentRequest,
            messages: [
                ...currentRequest.messages,
                assistantMessage,
                ...toolResults,
            ],
        };
    }

    if (!finalResponse) {
        throw new Error('Maximum tool calling iterations reached');
    }

    if (allToolExecutions.length > 0) {
        finalResponse.message.toolExecutions = allToolExecutions;
    }

    return finalResponse;
}
