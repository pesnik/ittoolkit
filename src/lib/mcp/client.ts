import { invoke } from '@tauri-apps/api/core';

export interface McpServerSpec {
    command: string;
    args: string[];
    env: Record<string, string>;
}

export interface McpClientsFile {
    servers: Record<string, McpServerSpec>;
}

export interface McpToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export async function listMcpServers(): Promise<McpClientsFile> {
    return invoke<McpClientsFile>('mcp_clients_list');
}

export async function upsertMcpServer(id: string, spec: McpServerSpec): Promise<void> {
    return invoke('mcp_clients_upsert', { id, spec });
}

export async function removeMcpServer(id: string): Promise<void> {
    return invoke('mcp_clients_remove', { id });
}

export async function getMcpTools(id: string): Promise<McpToolDef[]> {
    return invoke<McpToolDef[]>('mcp_client_tools', { id });
}

export async function callMcpTool(id: string, tool: string, arguments_: Record<string, unknown>): Promise<unknown> {
    return invoke('mcp_client_call', { id, tool, arguments: arguments_ });
}

export async function gatherMcpTools(): Promise<Array<{ serverId: string; tool: McpToolDef }>> {
    try {
        const config = await listMcpServers();
        const results: Array<{ serverId: string; tool: McpToolDef }> = [];
        for (const [id] of Object.entries(config.servers)) {
            try {
                const tools = await getMcpTools(id);
                for (const tool of tools) {
                    results.push({ serverId: id, tool });
                }
            } catch {
                // Skip servers that fail — don't block entire tool load
            }
        }
        return results;
    } catch {
        return [];
    }
}
