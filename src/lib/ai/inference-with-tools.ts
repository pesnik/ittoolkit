import { invoke } from '@tauri-apps/api/core';
import { InferenceRequest, InferenceResponse, ChatMessage, MessageRole, ToolExecutionData, ToolResultAction } from '@/types/ai-types';
import { runInference } from './ai-service';
import { detectToolCall, extractToolCalls, formatToolResult, removeToolCallTags } from './tool-calling';
import { runtimeSettings } from '@/lib/runtimeSettings';
import { classifyShellCommand } from './shell-classify';

export interface ToolExecutionEvent {
    /** Unique per call within a turn. The model can invoke the same tool
     *  multiple times in one turn (e.g. several `execute_command` calls);
     *  consumers must track state by this id rather than by toolName. */
    id: string;
    toolName: string;
    arguments: Record<string, unknown>;
    result?: string;
    error?: string;
    executionTimeMs?: number;
    cancelled?: boolean;
    /** Structured actions emitted by the tool (e.g. confirm_action cards,
     *  navigate chips). Carried through so the streaming UI can render them. */
    actions?: ToolResultAction[];
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

// Classification of which shell commands need a confirmation prompt is
// delegated to ./shell-classify. That module tokenizes the command and
// resolves wrappers (sudo/env/timeout/sh -c/find -exec/xargs/eval/$(…))
// so that e.g. `find … -exec rm -rf {} +` is correctly identified as a
// write — prefix matching on `^rm` does not catch that.
const classifyCommand = classifyShellCommand;

interface ExecuteCommandResponse {
    stdout: string;
    stderr: string;
    exit_code: number;
    timed_out: boolean;
}

/**
 * Some providers (and some models when given multiple tools) emit a malformed
 * tool call where the entire JSON tool-call object ends up in the `name`
 * field instead of being unwrapped. e.g.
 *   { name: '{"id":"call_1","name":"execute_command","arguments":{...}}', arguments: {} }
 * Unwrap that in-place before dispatching so we don't bail with "unknown tool".
 */
function unwrapNestedToolCall(toolCall: {
    name: string;
    arguments: Record<string, unknown>;
}): { name: string; arguments: Record<string, unknown> } {
    const trimmed = toolCall.name?.trim?.() ?? '';
    if (!trimmed.startsWith('{')) return toolCall;
    try {
        const parsed = JSON.parse(trimmed);
        if (
            parsed &&
            typeof parsed === 'object' &&
            typeof parsed.name === 'string' &&
            parsed.arguments &&
            typeof parsed.arguments === 'object'
        ) {
            console.warn(
                '[inference-with-tools] Recovered tool call wrapped in name field. Original name:',
                trimmed.slice(0, 120) + (trimmed.length > 120 ? '…' : ''),
            );
            return {
                name: parsed.name,
                arguments: parsed.arguments as Record<string, unknown>,
            };
        }
    } catch {
        // not parseable — fall through and let dispatch report unknown tool
    }
    return toolCall;
}

/** Budget object threaded through one inference iteration (one model response,
 *  potentially several tool calls). Rate-limits structured agent_action emits
 *  so a misbehaving model can't flood the UI with chips/cards in a single turn. */
interface TurnBudget {
    /** Remaining agent_action emits permitted this iteration. */
    actionsRemaining: number;
}

const MAX_ACTIONS_PER_TURN = 5;
const MAX_PATH_CHARS = 4096;
const MAX_PLAIN_TEXT_CHARS = 500;
const MAX_PATHS_PER_ACTION = 100;

/** Sensitive path prefixes that force severity to "high" regardless of what
 *  the model claimed. Match either a leading "/Some/Thing" segment OR a
 *  case-insensitive Windows-style "C:\\Windows" prefix. */
const SENSITIVE_PREFIXES = [
    /^\/(System|usr|bin|sbin|etc|Library|var|boot|opt|root)(\/|$)/,
    /^[A-Z]:\\(Windows|Program Files|Program Files \(x86\)|ProgramData)(\\|$)/i,
];

const HIGH_RISK_TOTAL_SIZE = 10 * 1024 ** 3; // 10 GiB
const HIGH_RISK_PATH_COUNT = 50;

/** Strip control chars (except space) and clamp to maxLen. Used so any text
 *  the model emits and the UI surfaces (title, description) cannot contain
 *  hidden newlines, escape sequences, or grow unbounded. */
function plainText(value: unknown, maxLen: number): string {
    if (typeof value !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    const cleaned = value.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen - 1) + '…' : cleaned;
}

/** Validate a single path string emitted by the model. We accept absolute
 *  POSIX paths and Windows drive paths. Reject anything with embedded NULs,
 *  newlines, or beyond MAX_PATH_CHARS. Returns the trimmed path on success
 *  or null if invalid. */
function validatePath(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const p = raw.trim();
    if (!p) return null;
    if (p.length > MAX_PATH_CHARS) return null;
    if (/[\u0000\n\r]/.test(p)) return null;
    const isPosixAbs = p.startsWith('/') || p.startsWith('~/');
    const isWindowsAbs = /^[A-Za-z]:[\\/]/.test(p);
    if (!isPosixAbs && !isWindowsAbs) return null;
    return p;
}

/** Pick the higher of (claimed, derived) severity. The agent can over-claim
 *  risk (which we honor) but never under-claim — sensitive prefixes, large
 *  operations, and many-path batches force at least "high". */
function escalateSeverity(
    claimed: 'low' | 'medium' | 'high',
    paths: string[],
    totalSize: number,
): 'low' | 'medium' | 'high' {
    const isSensitive = paths.some((p) =>
        SENSITIVE_PREFIXES.some((re) => re.test(p)),
    );
    if (isSensitive) return 'high';
    if (totalSize >= HIGH_RISK_TOTAL_SIZE) return 'high';
    if (paths.length >= HIGH_RISK_PATH_COUNT) return 'high';
    return claimed;
}

async function executeTool(
    toolCall: { name: string; arguments: Record<string, unknown> },
    turnBudget: TurnBudget,
): Promise<{
    content: string;
    isError: boolean;
    actions?: ToolResultAction[];
}> {
    const normalized = unwrapNestedToolCall(toolCall);
    console.log('[inference-with-tools] dispatch:', {
        id: (toolCall as { id?: string }).id,
        name: normalized.name,
        argKeys: Object.keys(normalized.arguments ?? {}),
        argsPreview: JSON.stringify(normalized.arguments).slice(0, 200),
    });

    if (normalized.name === 'agent_action') {
        return executeAgentAction(normalized.arguments, turnBudget);
    }
    if (normalized.name === 'search_conversations') {
        return executeSearchConversations(normalized.arguments);
    }
    if (normalized.name !== 'execute_command') {
        console.warn('[inference-with-tools] Unknown tool name:', normalized.name, 'args:', normalized.arguments);
        return {
            content: `Unknown tool "${normalized.name}". Available tools: "execute_command" (cmd, working_dir, timeout_secs), "search_conversations" (query, limit), "agent_action" (action, paths). Use one of these exact names.`,
            isError: true,
        };
    }
    return executeShellCommand(normalized.arguments);
}

/** Handle agent_action tool call: validate arguments at the LLM/UI boundary,
 *  then return a structured action the UI renders natively. The validator
 *  is the only thing standing between model output and the user's file
 *  explorer / shell — keep it strict. */
function executeAgentAction(
    args: Record<string, unknown>,
    turnBudget: TurnBudget,
): {
    content: string;
    isError: boolean;
    actions: ToolResultAction[];
} {
    if (turnBudget.actionsRemaining <= 0) {
        return {
            content: `agent_action: per-turn action limit (${MAX_ACTIONS_PER_TURN}) exceeded. Batch related paths into one confirm_action, or split the work into a follow-up turn.`,
            isError: true,
            actions: [],
        };
    }

    const rawAction = typeof args.action === 'string' ? args.action.trim() : '';
    const ALLOWED_ACTIONS = new Set(['navigate', 'open_file', 'highlight', 'confirm_action']);
    if (!ALLOWED_ACTIONS.has(rawAction)) {
        return {
            content: `agent_action: invalid "action" value ${JSON.stringify(args.action)}. Must be one of: navigate, open_file, highlight, confirm_action.`,
            isError: true,
            actions: [],
        };
    }
    const action = rawAction as 'navigate' | 'open_file' | 'highlight' | 'confirm_action';

    const rawPaths = Array.isArray(args.paths) ? args.paths : [];
    const validPaths: string[] = [];
    for (const candidate of rawPaths.slice(0, MAX_PATHS_PER_ACTION)) {
        const p = validatePath(candidate);
        if (p) validPaths.push(p);
    }
    if (validPaths.length === 0) {
        return {
            content: `agent_action: "paths" must contain at least one absolute path (POSIX "/…" or Windows "C:\\…"), no newlines or NUL bytes, ≤ ${MAX_PATH_CHARS} chars each. Got: ${JSON.stringify(args.paths)?.slice(0, 200)}.`,
            isError: true,
            actions: [],
        };
    }

    turnBudget.actionsRemaining -= 1;

    if (action === 'navigate' || action === 'open_file') {
        const path = validPaths[0];
        return {
            content: `Action emitted: ${action} to ${path}`,
            isError: false,
            actions: [{ type: action, payload: { path } }],
        };
    }

    if (action === 'highlight') {
        return {
            content: `Action emitted: highlight ${validPaths.length} path(s).`,
            isError: false,
            actions: [{ type: 'highlight', payload: { paths: validPaths } }],
        };
    }

    // confirm_action — strictest validation. The suggestedCommand here is the
    // exact string the UI will hand to execute_command on user approval, so
    // do NOT relax requirements; missing fields mean we cannot safely run.
    const title = plainText(args.title, MAX_PLAIN_TEXT_CHARS);
    const description = plainText(args.description, MAX_PLAIN_TEXT_CHARS);
    if (!title || !description) {
        return {
            content: 'agent_action(confirm_action): both "title" and "description" are required, plain text, ≤ 500 chars.',
            isError: true,
            actions: [],
        };
    }
    const suggestedCommand = typeof args.suggestedCommand === 'string' ? args.suggestedCommand.trim() : '';
    const suggestedWorkingDir = typeof args.suggestedWorkingDir === 'string'
        ? validatePath(args.suggestedWorkingDir)
        : null;
    if (!suggestedCommand || !suggestedWorkingDir) {
        return {
            content: 'agent_action(confirm_action): "suggestedCommand" and "suggestedWorkingDir" (absolute path) are required so the app can run the action verbatim on user approval.',
            isError: true,
            actions: [],
        };
    }
    if (/[\u0000\n\r]/.test(suggestedCommand)) {
        return {
            content: 'agent_action(confirm_action): "suggestedCommand" must not contain embedded newlines or NUL bytes.',
            isError: true,
            actions: [],
        };
    }
    const totalSize = typeof args.totalSize === 'number' && args.totalSize >= 0 ? args.totalSize : 0;
    const claimedSeverity: 'low' | 'medium' | 'high' =
        args.severity === 'low' || args.severity === 'medium' || args.severity === 'high'
            ? args.severity
            : 'medium'; // safer default than 'low' when the model omits it
    const severity = escalateSeverity(claimedSeverity, validPaths, totalSize);

    const actionId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return {
        content: `Action emitted: confirm_action — ${title}${severity !== claimedSeverity ? ` (severity escalated ${claimedSeverity} → ${severity})` : ''}`,
        isError: false,
        actions: [{
            type: 'confirm_action',
            payload: {
                title,
                description,
                items: validPaths,
                totalSize,
                severity,
                actionId,
                suggestedCommand,
                suggestedWorkingDir,
            },
        }],
    };
}

async function executeShellCommand(args: Record<string, unknown>): Promise<{
    content: string;
    isError: boolean;
}> {
    // Accept a few common aliases the model sometimes emits in place of the
    // documented keys. Underscores in JSON keys occasionally get rendered as
    // spaces or stripped by markdown in the UI, so it's easy to think the
    // model is misbehaving when it actually isn't. Either way, normalizing
    // here gives us a clear error if the actual problem is missing data.
    const cmd =
        (args.cmd as string | undefined)
        ?? (args.command as string | undefined)
        ?? (args.shell as string | undefined);
    const working_dir =
        (args.working_dir as string | undefined)
        ?? (args.workingDir as string | undefined)
        ?? (args.cwd as string | undefined)
        ?? (args.path as string | undefined);
    const timeout_secs =
        (args.timeout_secs as number | undefined)
        ?? (args.timeoutSecs as number | undefined)
        ?? (args.timeout as number | undefined);

    if (!cmd || !cmd.trim()) {
        console.warn('[inference-with-tools] execute_command got no usable cmd. args:', args);
        return {
            content: `execute_command failed: required argument "cmd" was missing or empty. Got arguments: ${JSON.stringify(args)}. Call it like: {"cmd": "ls -la", "working_dir": "/path"}.`,
            isError: true,
        };
    }
    if (!working_dir || !working_dir.trim()) {
        console.warn('[inference-with-tools] execute_command got no usable working_dir. args:', args);
        return {
            content: `execute_command failed: required argument "working_dir" was missing or empty. Got arguments: ${JSON.stringify(args)}. Use an absolute path like "/" or "/Users/you".`,
            isError: true,
        };
    }

    const result = await invoke<ExecuteCommandResponse>('execute_command', {
        cmd,
        workingDir: working_dir,
        timeoutSecs: timeout_secs ?? null,
    });

    let content = '';
    if (result.stdout) content += result.stdout;
    if (result.stderr) {
        if (content) content += '\n';
        content += result.stderr;
    }

    // Exit code 1 with stdout is NOT an error — tools like du, grep, and diff
    // use exit code 1 for informational purposes (missing paths, no matches).
    // Only exit code 2+ or exit code 1 without stdout is a real error.
    const isError = result.timed_out || (result.exit_code !== 0 && (result.exit_code > 1 || !result.stdout));

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

interface SearchConversationsHit {
    id: string;
    title: string;
    updated: string;
    snippets: string[];
}

async function executeSearchConversations(args: Record<string, unknown>): Promise<{
    content: string;
    isError: boolean;
}> {
    const query = ((args.query as string) ?? '').trim();
    const limit = typeof args.limit === 'number' ? args.limit : undefined;
    if (!query) {
        return { content: 'search_conversations: missing required argument "query"', isError: true };
    }
    try {
        const hits = await invoke<SearchConversationsHit[]>('search_conversations_content', {
            query,
            limit,
        });
        if (hits.length === 0) {
            return { content: `No prior conversations matched "${query}".`, isError: false };
        }
        const formatted = hits
            .map((h) => {
                const lines = [`### ${h.title} (${h.id.slice(0, 6)}, updated ${h.updated})`];
                for (const s of h.snippets) lines.push(`- ${s}`);
                return lines.join('\n');
            })
            .join('\n\n');
        return { content: formatted, isError: false };
    } catch (e) {
        return { content: `search_conversations failed: ${e}`, isError: true };
    }
}

export async function runInferenceWithTools(
    request: InferenceRequest,
    options: InferenceWithToolsOptions = {}
): Promise<InferenceResponse> {
    const { onChunk, onToolExecution, onProgress, onConfirmExecution, isCancelled } = options;

    // Per-turn trace id. Tag every log line and outgoing request with it so
    // a single turn (potentially several inference calls + several tool
    // executions) can be reconstructed from disjoint Rust/JS logs.
    const turnId = `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[turn ${turnId}] starting (model=${request.modelConfig.modelId}, messages=${request.messages.length})`);

    const maxIterations = runtimeSettings.maxToolIterations;
    let currentRequest = { ...request };
    let iterations = 0;
    let finalResponse: InferenceResponse | null = null;
    const allToolExecutions: ToolExecutionData[] = [];

    while (iterations < maxIterations) {
        if (isCancelled?.()) {
            throw new Error('Inference cancelled');
        }
        iterations++;
        console.log(`[turn ${turnId}] iteration ${iterations}: sending ${currentRequest.messages.length} messages`);

        const response = await runInference(currentRequest, onChunk, onProgress);

        const respContentLen = (response.message.content ?? '').length;
        const respToolCalls = response.message.toolCalls?.length ?? 0;
        console.log(`[turn ${turnId}] iteration ${iterations} response: content=${respContentLen} chars, toolCalls=${respToolCalls}`);

        // Detect a degenerate "nothing returned" response. Some providers do
        // this when rate-limited, when the prompt exceeds the *real* model
        // context, or when content is filtered. Without this guard the user
        // sees a blank assistant bubble and has no idea what happened.
        if (respContentLen === 0 && respToolCalls === 0) {
            console.warn(`[turn ${turnId}] empty response from model — likely rate limit, context overflow, or content filter`);
            return {
                ...response,
                message: {
                    ...response.message,
                    content:
                        'The model returned an empty response. Common causes:\n' +
                        '  • Free-tier rate limit on the provider (try again in a minute, or switch models)\n' +
                        '  • Prompt exceeded the model\'s real context window (open Settings → Advanced and verify the context window matches the model)\n' +
                        '  • Content filter on the provider rejected the input/output\n\n' +
                        `Trace id: ${turnId} — search the dev console for this id to see what was sent.`,
                    error: 'empty_model_response',
                },
            };
        }

        let toolCalls: any[] = [];

        if (response.message.toolCalls && response.message.toolCalls.length > 0) {
            console.log(
                '[inference-with-tools] Native toolCalls received:',
                response.message.toolCalls.map((tc: any) => ({
                    id: tc.id,
                    namePreview: typeof tc?.function?.name === 'string'
                        ? tc.function.name.slice(0, 120)
                        : tc?.function?.name,
                    argsType: typeof tc?.function?.arguments,
                    argsPreview: typeof tc?.function?.arguments === 'string'
                        ? tc.function.arguments.slice(0, 200)
                        : JSON.stringify(tc?.function?.arguments).slice(0, 200),
                })),
            );
            toolCalls = response.message.toolCalls.map((tc: any) => {
                let parsedArgs: Record<string, unknown> = {};
                const rawArgs = tc?.function?.arguments;
                if (typeof rawArgs === 'string' && rawArgs.trim()) {
                    try {
                        parsedArgs = JSON.parse(rawArgs);
                    } catch (e) {
                        console.warn('[inference-with-tools] arguments string was not valid JSON:', rawArgs);
                    }
                } else if (rawArgs && typeof rawArgs === 'object') {
                    parsedArgs = rawArgs;
                }
                return {
                    id: tc.id,
                    name: tc?.function?.name ?? '',
                    arguments: parsedArgs,
                };
            });
        } else {
            const hasToolCalls = detectToolCall(response.message.content);

            if (!hasToolCalls) {
                finalResponse = response;
                break;
            }

            toolCalls = extractToolCalls(response.message.content);
            console.log(
                '[inference-with-tools] Extracted tool calls from content:',
                toolCalls.map((tc) => ({
                    id: tc.id,
                    namePreview: typeof tc.name === 'string' ? tc.name.slice(0, 120) : tc.name,
                    argKeys: Object.keys(tc.arguments ?? {}),
                })),
            );
        }

        if (toolCalls.length === 0) {
            finalResponse = response;
            break;
        }

        const toolResults: ChatMessage[] = [];
        // One TurnBudget per inference iteration. Rate-limits structured
        // agent_action emits so the model can't flood the UI with chips/
        // cards in a single response. Re-allotted each iteration since
        // the user is meant to confirm/dismiss between iterations.
        const turnBudget: TurnBudget = { actionsRemaining: MAX_ACTIONS_PER_TURN };

        for (const toolCall of toolCalls) {
            try {
                const startTime = Date.now();

                if (onToolExecution) {
                    onToolExecution({
                        id: toolCall.id,
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
                                id: toolCall.id,
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

                const result = await executeTool(toolCall, turnBudget);
                const executionTimeMs = Date.now() - startTime;

                toolExecution.status = result.isError ? 'error' : 'success';
                toolExecution.result = result.content;
                toolExecution.executionTimeMs = executionTimeMs;
                if (result.isError) {
                    toolExecution.error = result.content;
                }
                if (result.actions?.length) {
                    toolExecution.actions = result.actions;
                }

                allToolExecutions.push(toolExecution);

                if (onToolExecution) {
                    onToolExecution({
                        id: toolCall.id,
                        toolName: toolCall.name,
                        arguments: toolCall.arguments,
                        result: result.content,
                        error: result.isError ? result.content : undefined,
                        executionTimeMs,
                        actions: result.actions?.length ? result.actions : undefined,
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
                        id: toolCall.id,
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
        throw new Error(
            `Maximum tool calling iterations reached (${maxIterations}). ` +
            `Raise this in Settings → Advanced → Agent if the task legitimately needs more steps.`,
        );
    }

    if (allToolExecutions.length > 0) {
        finalResponse.message.toolExecutions = allToolExecutions;
    }

    return finalResponse;
}
