import { ToolCall } from '@/types/ai-types';

const TOOL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function detectToolCall(content: string): boolean {
    const hasXmlToolCall = content.includes('<tool_call>') && content.includes('</tool_call>');
    if (hasXmlToolCall) return true;

    const rawJsonPattern = /\{\s*"id"\s*:\s*"[^"]+"\s*,\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{/;
    return rawJsonPattern.test(content);
}

export function extractToolCalls(content: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    const xmlRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let match;

    while ((match = xmlRegex.exec(content)) !== null) {
        try {
            const body = match[1].trim();

            // Find the JSON object in the body
            const jsonMatch = body.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                continue;
            }

            // Extract text before JSON as potential tool name (model may put
            // name outside the JSON object)
            const textBefore = body.slice(0, jsonMatch.index).trim();
            const rawJson = jsonMatch[0];

            let parsed: Record<string, any>;
            try {
                parsed = JSON.parse(rawJson);
            } catch {
                continue;
            }

            // If JSON has no name but text before looks like a tool name, use it
            if (!parsed.name && TOOL_NAME_RE.test(textBefore)) {
                parsed.name = textBefore;
            }

            if (parsed.name && parsed.arguments) {
                toolCalls.push({
                    id: parsed.id || `call_${Date.now()}_${toolCalls.length}`,
                    name: parsed.name,
                    arguments: parsed.arguments,
                });
            }
        } catch {
            // skip malformed blocks
        }
    }

    if (toolCalls.length === 0) {
        const jsonObjectRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
        const matches = content.match(jsonObjectRegex);

        if (matches) {
            for (const potentialJson of matches) {
                try {
                    const parsed = JSON.parse(potentialJson);

                    if (parsed.id && parsed.name && parsed.arguments &&
                        typeof parsed.id === 'string' &&
                        typeof parsed.name === 'string' &&
                        typeof parsed.arguments === 'object') {
                        toolCalls.push({
                            id: parsed.id,
                            name: parsed.name,
                            arguments: parsed.arguments,
                        });
                    }
                } catch {
                    // not valid JSON — skip
                }
            }
        }
    }

    return toolCalls;
}

export function removeToolCallTags(content: string): string {
    let cleaned = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');

    const jsonObjectRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    const matches = cleaned.match(jsonObjectRegex);

    if (matches) {
        for (const potentialJson of matches) {
            try {
                const parsed = JSON.parse(potentialJson);

                if (parsed.id && parsed.name && parsed.arguments &&
                    typeof parsed.id === 'string' &&
                    typeof parsed.name === 'string' &&
                    typeof parsed.arguments === 'object') {
                    const escapedJson = potentialJson.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    cleaned = cleaned.replace(new RegExp(escapedJson, 'g'), '');
                }
            } catch {
                // skip
            }
        }
    }

    return cleaned.trim();
}

export function formatToolResult(toolName: string, result: string, isError: boolean): string {
    if (isError) {
        return `<tool_result name="${toolName}" error="true">
${result}
</tool_result>`;
    }

    return `<tool_result name="${toolName}">
${result}
</tool_result>`;
}

export function hasToolResult(content: string): boolean {
    return content.includes('<tool_result') && content.includes('</tool_result>');
}
