/**
 * Computer-use risk classification (CU-M3).
 *
 * Mirror of `src-tauri/src/computer_classify.rs`. Used in
 * `inference-with-tools.ts` to decide whether a computer_* call requires
 * user approval via `onConfirmExecution`.
 *
 * Conservative model: only screenshot / screen_size / cursor_position /
 * find are autonomous. Everything else (move / click / drag / type / key /
 * scroll) is write — a single click can do anything on the user's desktop.
 */

export type ComputerRisk = 'read' | 'write';

const READ_METHODS = new Set<string>([
    'computer_screenshot',
    'computer_screen_size',
    'computer_cursor_position',
    'computer_find',
]);

export function classifyComputerAction(method: string): ComputerRisk {
    return READ_METHODS.has(method) ? 'read' : 'write';
}

/**
 * Human-friendly one-line summary of an intended computer action — rendered
 * on confirm_action cards alongside the screenshot.
 */
export function describeComputerAction(
    method: string,
    params: Record<string, unknown>,
): string {
    const at = (params.x !== undefined && params.y !== undefined)
        ? ` at (${params.x}, ${params.y})`
        : '';
    switch (method) {
        case 'computer_mouse_move':
            return `Move mouse to (${params.x}, ${params.y})`;
        case 'computer_left_click':
            return `Left-click${at}`;
        case 'computer_right_click':
            return `Right-click${at}`;
        case 'computer_middle_click':
            return `Middle-click${at}`;
        case 'computer_double_click':
            return `Double-click${at}`;
        case 'computer_left_click_drag':
            return `Drag from (${params.x1}, ${params.y1}) to (${params.x2}, ${params.y2})`;
        case 'computer_type':
            return `Type ${truncate(String(params.text ?? ''))}`;
        case 'computer_key':
            return `Press ${String(params.key ?? '?')}`;
        case 'computer_scroll':
            return `Scroll ${String(params.direction ?? 'down')} ${String(params.clicks ?? 3)} clicks`;
        default:
            return method;
    }
}

function truncate(s: string): string {
    // Never log full typed strings — preserve a short prefix for context but
    // not the literal value (matches the password-field PII rule).
    if (s.length <= 8) return `${s.length} chars`;
    return `${s.length} chars (starts "${s.slice(0, 6)}…")`;
}
