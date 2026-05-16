// AX-tree → flat indexed element list. The model receives this as the
// perception primitive; element indices it returns in browser_act are
// resolved back to coordinates / locators here.

import type { Page } from 'playwright-core';
import { log } from './log.js';

export interface AxNode {
    index: number;
    role: string;
    name: string;
    value?: string;
    description?: string;
    /** True when the node has no children, false otherwise. Useful for the
     *  model to know "this is a leaf the user could interact with" vs
     *  "this is a container; click a child". */
    leaf: boolean;
    /** Children indices, if any. Flattened so the model can scan linearly. */
    children?: number[];
}

const INTERACTIVE_ROLES = new Set([
    'button',
    'link',
    'textbox',
    'searchbox',
    'combobox',
    'checkbox',
    'radio',
    'switch',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'tab',
    'slider',
    'spinbutton',
]);

const STRUCTURAL_ROLES = new Set([
    'heading',
    'list',
    'listitem',
    'navigation',
    'main',
    'banner',
    'contentinfo',
    'complementary',
    'region',
    'form',
    'dialog',
    'alertdialog',
    'tablist',
    'tabpanel',
    'menu',
    'menubar',
]);

interface RawAx {
    role?: string;
    name?: string;
    value?: string;
    description?: string;
    children?: RawAx[];
}

interface FlattenOptions {
    maxElements: number;
}

function shouldKeep(node: RawAx): boolean {
    if (!node.role) return false;
    if (INTERACTIVE_ROLES.has(node.role)) return true;
    if (STRUCTURAL_ROLES.has(node.role) && (node.name?.trim().length ?? 0) > 0) return true;
    // Plain text nodes carry the page's prose; keep them when they have a name
    // so the model can read the page content without scrolling pixels.
    if (node.role === 'text' && (node.name?.trim().length ?? 0) > 0) return true;
    if (node.role === 'StaticText' && (node.name?.trim().length ?? 0) > 0) return true;
    return false;
}

function clamp(s: string | undefined, n: number): string | undefined {
    if (!s) return undefined;
    const t = s.replace(/\s+/g, ' ').trim();
    if (!t) return undefined;
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Walk a Playwright accessibility snapshot and emit a flat indexed list. */
function flatten(root: RawAx, opts: FlattenOptions): AxNode[] {
    const out: AxNode[] = [];
    const queue: Array<{ node: RawAx; parentIndex: number | null }> = [{ node: root, parentIndex: null }];

    while (queue.length > 0 && out.length < opts.maxElements) {
        const { node, parentIndex } = queue.shift()!;
        const children = node.children ?? [];

        if (shouldKeep(node)) {
            const idx = out.length;
            const flat: AxNode = {
                index: idx,
                role: node.role!,
                name: clamp(node.name, 200) ?? '',
                value: clamp(node.value, 200),
                description: clamp(node.description, 200),
                leaf: children.length === 0,
            };
            out.push(flat);
            if (parentIndex !== null) {
                const parent = out[parentIndex];
                parent.children = parent.children ?? [];
                parent.children.push(idx);
            }
            for (const c of children) queue.push({ node: c, parentIndex: idx });
        } else {
            // Skip this node but keep walking its children — they may carry
            // the real interactive content. The parent index stays the same.
            for (const c of children) queue.push({ node: c, parentIndex });
        }
    }

    return out;
}

export async function captureAxTree(page: Page, maxElements: number): Promise<AxNode[]> {
    try {
        const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
        if (!snapshot) return [];
        return flatten(snapshot as RawAx, { maxElements });
    } catch (e) {
        log.warn('captureAxTree failed', { err: String(e) });
        return [];
    }
}

export async function captureScreenshot(page: Page): Promise<string | undefined> {
    try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
        return buf.toString('base64');
    } catch (e) {
        log.warn('captureScreenshot failed', { err: String(e) });
        return undefined;
    }
}
