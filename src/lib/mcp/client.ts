/**
 * MCP client wrapper.
 *
 * Reads ~/.ittoolkit/mcp-clients.json via the Rust supervisor, queries each
 * configured external MCP server for its tool list, and translates them
 * into the OpenAI-compat function-tool shape the existing inference loop
 * consumes. Tool names are namespaced as `<server-id>__<tool>` so the
 * dispatcher can route calls back to the right server.
 */

import { invoke } from '@tauri-apps/api/core';
import { Tool } from '@/types/ai-types';

export interface McpServerSpec {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}

export interface McpClientsFile {
    servers: Record<string, McpServerSpec>;
}

export interface McpToolDescriptor {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export const MCP_TOOL_SEPARATOR = '__';

export async function listMcpServers(): Promise<McpClientsFile> {
    try {
        return await invoke<McpClientsFile>('mcp_clients_list');
    } catch (e) {
        console.warn('[mcp] mcp_clients_list failed', e);
        return { servers: {} };
    }
}

export async function upsertMcpServer(id: string, spec: McpServerSpec): Promise<void> {
    await invoke('mcp_clients_upsert', { id, spec });
}

export async function removeMcpServer(id: string): Promise<void> {
    await invoke('mcp_clients_remove', { id });
}

export async function mcpServerTools(id: string): Promise<McpToolDescriptor[]> {
    return invoke<McpToolDescriptor[]>('mcp_client_tools', { id });
}

export async function mcpCall(
    id: string,
    tool: string,
    args: Record<string, unknown>,
): Promise<unknown> {
    return invoke('mcp_client_call', { id, tool, arguments: args });
}

/**
 * Query every configured MCP server and return their tools as OpenAI
 * function-tools with namespaced names. Servers that fail to start (e.g.
 * missing binary) are skipped silently — the agent works with the rest.
 */
export async function gatherMcpTools(): Promise<{
    tools: Tool[];
    routes: Map<string, { serverId: string; remoteName: string }>;
}> {
    const file = await listMcpServers();
    const tools: Tool[] = [];
    const routes = new Map<string, { serverId: string; remoteName: string }>();
    for (const serverId of Object.keys(file.servers)) {
        try {
            const remote = await mcpServerTools(serverId);
            for (const t of remote) {
                const localName = `${serverId}${MCP_TOOL_SEPARATOR}${t.name}`;
                tools.push({
                    type: 'function',
                    function: {
                        name: localName,
                        description: `[via MCP server "${serverId}"] ${t.description}`,
                        parameters: t.inputSchema ?? { type: 'object', properties: {} },
                    },
                });
                routes.set(localName, { serverId, remoteName: t.name });
            }
        } catch (e) {
            console.warn(`[mcp] server "${serverId}" failed to start; tools skipped`, e);
        }
    }
    return { tools, routes };
}
