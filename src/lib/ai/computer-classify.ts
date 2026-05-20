export type ComputerRisk = 'read' | 'write';

const READ_METHODS = new Set([
    'computer_screenshot',
    'computer.screenshot',
    'computer_screen_size',
    'computer.screen_size',
    'computer_cursor_position',
    'computer.cursor_position',
    'computer_find',
    'computer.find',
]);

export function classifyComputerAction(toolName: string): ComputerRisk {
    return READ_METHODS.has(toolName) ? 'read' : 'write';
}

const WRITE_DESCRIPTIONS: Record<string, (args: Record<string, unknown>) => string> = {
    computer_mouse_move: (a) => `Move mouse to (${a.x}, ${a.y})`,
    computer_left_click: (a) => a.x !== undefined ? `Left-click at (${a.x}, ${a.y})` : 'Left-click at current position',
    computer_right_click: (a) => a.x !== undefined ? `Right-click at (${a.x}, ${a.y})` : 'Right-click at current position',
    computer_middle_click: (a) => a.x !== undefined ? `Middle-click at (${a.x}, ${a.y})` : 'Middle-click at current position',
    computer_double_click: (a) => a.x !== undefined ? `Double-click at (${a.x}, ${a.y})` : 'Double-click at current position',
    computer_left_click_drag: (a) => `Drag from (${a.x1},${a.y1}) to (${a.x2},${a.y2})`,
    computer_type: (a) => {
        const text = String(a.text ?? '');
        const preview = text.length > 6 ? text.slice(0, 6) + '...' : text;
        return `Type "${preview}" (${text.length} chars)`;
    },
    computer_key: (a) => `Press key: ${a.key}`,
    computer_scroll: (a) => `Scroll ${a.direction} (${a.clicks ?? 3} clicks)`,
};

export function describeComputerAction(toolName: string, args: Record<string, unknown>): string {
    const fn = WRITE_DESCRIPTIONS[toolName];
    if (fn) return fn(args);
    return `${toolName}(${JSON.stringify(args)})`;
}
