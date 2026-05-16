import { getSession } from '../sessions.js';
import { captureAxTree, captureScreenshot, type AxNode } from '../snapshot.js';

interface ObserveParams {
    session_id?: string;
    include_screenshot?: boolean;
    max_elements?: number;
}

export async function handleObserve(params: ObserveParams): Promise<{
    url: string;
    title: string;
    ax: AxNode[];
    screenshot?: string;
}> {
    if (!params.session_id) throw new Error('browser.observe requires "session_id"');
    const ref = getSession(params.session_id);
    if (!ref) {
        throw new Error(`browser.observe: session "${params.session_id}" not open. Call browser.open first.`);
    }

    const maxElements = typeof params.max_elements === 'number' && params.max_elements > 0
        ? Math.min(params.max_elements, 200)
        : 80;
    const includeScreenshot = params.include_screenshot !== false;

    const [ax, screenshot, title] = await Promise.all([
        captureAxTree(ref.page, maxElements),
        includeScreenshot ? captureScreenshot(ref.page) : Promise.resolve(undefined),
        ref.page.title().catch(() => ''),
    ]);

    ref.lastObservation = { ax, capturedAt: Date.now() };

    return {
        url: ref.page.url(),
        title,
        ax,
        ...(screenshot ? { screenshot } : {}),
    };
}
