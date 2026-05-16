/**
 * Vision-payload screenshot retention.
 *
 * Each computer-use / browser-observe tool call adds 30–80 KB of base64 to
 * the context window. Without a cap, a multi-step session re-pays every
 * screenshot every turn. We retain only the N most-recent screenshots;
 * older tool-result messages keep their text body but lose `images`, and
 * the text is annotated so the model knows a screenshot was elided.
 *
 * Wire-format only — stored conversations on disk never carry `images`
 * to begin with (it's populated at tool-dispatch time).
 */

import { ChatMessage } from '@/types/ai-types';

const OMITTED_MARKER = '\n\n[screenshot omitted — only the latest N=3 are kept in context to save tokens]';

export interface ScreenshotRetentionResult {
    messages: ChatMessage[];
    /** Number of screenshots stripped from older messages. */
    strippedCount: number;
    /** Number of messages still carrying images after retention. */
    retainedCount: number;
}

export function trimScreenshotPayload(
    messages: ChatMessage[],
    maxKept: number = 3,
): ScreenshotRetentionResult {
    if (maxKept <= 0) {
        const out = messages.map((m) => {
            if (!m.images?.length) return m;
            return {
                ...m,
                images: undefined,
                content: appendMarkerOnce(m.content),
            };
        });
        const stripped = messages.filter((m) => m.images?.length).length;
        return { messages: out, strippedCount: stripped, retainedCount: 0 };
    }

    // Walk newest → oldest; retain the first `maxKept` with images, strip the rest.
    const result: ChatMessage[] = new Array(messages.length);
    let kept = 0;
    let stripped = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!m.images?.length) {
            result[i] = m;
            continue;
        }
        if (kept < maxKept) {
            result[i] = m;
            kept += 1;
        } else {
            result[i] = {
                ...m,
                images: undefined,
                content: appendMarkerOnce(m.content),
            };
            stripped += 1;
        }
    }

    return { messages: result, strippedCount: stripped, retainedCount: kept };
}

function appendMarkerOnce(content: string): string {
    if (content.includes(OMITTED_MARKER.trim())) return content;
    return content + OMITTED_MARKER;
}
