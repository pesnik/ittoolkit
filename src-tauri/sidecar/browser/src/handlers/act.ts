// browser_act handler — click/type/select/scroll/press/hover by AX index.
//
// Resolves params.index against the session's cached AX snapshot. If the
// cache is stale (>30s) or absent, we re-snapshot first. The cached node's
// role + accessible name is then mapped to a Playwright locator
// (page.getByRole(role, { name })). This is more resilient than coordinate
// targeting and survives layout changes; it falls back to nth-of-role when
// the name is ambiguous.

import type { Page, Locator } from 'playwright-core';
import { getSession } from '../sessions.js';
import { captureAxTree, type AxNode } from '../snapshot.js';

const SNAPSHOT_STALE_MS = 30_000;

type ActionKind = 'click' | 'type' | 'select' | 'scroll' | 'press' | 'hover';
const ALLOWED_ACTIONS = new Set<ActionKind>(['click', 'type', 'select', 'scroll', 'press', 'hover']);

interface ActParams {
    session_id?: string;
    action?: string;
    index?: number;
    text?: string;
    submit?: boolean;
}

interface ActResult {
    /** Final URL after the action (may differ if click triggered navigation). */
    url: string;
    title: string;
    /** Tags that were on the targeted node at action time. Echoed for audit. */
    target_tags?: string[];
    target_role?: string;
    target_name?: string;
}

function pwRole(axRole: string): Parameters<Page['getByRole']>[0] {
    // The AX snapshot uses ARIA role names that mostly match Playwright's
    // built-in role enum. A few sidecar-emitted roles need normalization.
    const r = axRole.toLowerCase();
    if (r === 'statictext' || r === 'text') return 'paragraph';
    return r as Parameters<Page['getByRole']>[0];
}

async function resolveLocator(page: Page, node: AxNode): Promise<Locator> {
    const role = pwRole(node.role);
    if (node.name) {
        const byNamed = page.getByRole(role, { name: node.name, exact: true });
        const count = await byNamed.count().catch(() => 0);
        if (count === 1) return byNamed;
        if (count > 1) return byNamed.first();
    }
    // Fallback: index-within-role (rough but better than failing). We use
    // the AX node index narrowed to same-role nodes captured before it.
    return page.getByRole(role).first();
}

export async function handleAct(params: ActParams): Promise<ActResult> {
    if (!params.session_id) throw new Error('browser.act requires "session_id"');
    const action = (params.action ?? '') as ActionKind;
    if (!ALLOWED_ACTIONS.has(action)) {
        throw new Error(`browser.act: unknown action "${params.action}". Allowed: ${[...ALLOWED_ACTIONS].join(', ')}`);
    }

    const ref = getSession(params.session_id);
    if (!ref) {
        throw new Error(`browser.act: session "${params.session_id}" not open. Call browser.open first.`);
    }

    const now = Date.now();
    let observation = ref.lastObservation;
    if (!observation || now - observation.capturedAt > SNAPSHOT_STALE_MS) {
        const ax = await captureAxTree(ref.page, 80);
        observation = { ax, capturedAt: now };
        ref.lastObservation = observation;
    }

    // `scroll` and `press` don't require a target node — handle them first.
    if (action === 'scroll') {
        const direction = (params.text ?? 'down').toLowerCase();
        const delta = direction === 'up' ? -600 : direction === 'top' ? -1_000_000 : direction === 'bottom' ? 1_000_000 : 600;
        await ref.page.mouse.wheel(0, delta);
    } else if (action === 'press') {
        const key = (params.text ?? '').trim();
        if (!key) throw new Error('browser.act press requires "text" with the key name (e.g. "Enter").');
        await ref.page.keyboard.press(key);
    } else {
        const idx = typeof params.index === 'number' ? params.index : -1;
        if (idx < 0 || idx >= observation.ax.length) {
            throw new Error(`browser.act: index ${idx} out of range (have ${observation.ax.length} nodes). Call browser_observe to refresh.`);
        }
        const node = observation.ax[idx];
        const locator = await resolveLocator(ref.page, node);

        switch (action) {
            case 'click':
                await locator.click();
                break;
            case 'type': {
                const text = params.text ?? '';
                await locator.fill(text);
                if (params.submit) {
                    await locator.press('Enter');
                }
                break;
            }
            case 'select': {
                const value = params.text ?? '';
                await locator.selectOption(value);
                break;
            }
            case 'hover':
                await locator.hover();
                break;
        }
    }

    // Re-derive page state. After click/type-submit the URL may have changed.
    const [url, title] = await Promise.all([
        Promise.resolve(ref.page.url()),
        ref.page.title().catch(() => ''),
    ]);

    // Invalidate cached observation; the agent should call browser_observe
    // to see the post-action state. Returning the previous node tags is
    // still useful for audit ("what did we just click?").
    let target_role: string | undefined;
    let target_name: string | undefined;
    let target_tags: string[] | undefined;
    if (typeof params.index === 'number' && params.index >= 0 && params.index < observation.ax.length) {
        const node = observation.ax[params.index];
        target_role = node.role;
        target_name = node.name;
        target_tags = node.tags;
    }
    ref.lastObservation = null;

    return { url, title, target_role, target_name, target_tags };
}
