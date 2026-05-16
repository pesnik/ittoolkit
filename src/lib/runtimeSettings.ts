/**
 * Runtime-mutable, localStorage-backed numeric/string settings.
 *
 * Companion to `featureFlags.ts` — that one is boolean-only by design (toggles).
 * This module covers settings that need a value (iteration caps, thresholds,
 * model parameter overrides). Same persistence + change-event pattern so UI
 * can subscribe.
 *
 * Usage:
 *     import { runtimeSettings, setRuntimeSetting } from '@/lib/runtimeSettings';
 *     const max = runtimeSettings.maxToolIterations;
 *     setRuntimeSetting('maxToolIterations', 25);
 */

interface RuntimeSettingsShape {
    /** Max number of tool-call → execute → re-call iterations in a single user turn.
     *  Modern agentic systems use 15-50; we default to 20 (Claude Code uses a
     *  token-budget cap instead, but iteration count is a simpler model).
     *  Bumping too high risks runaway cost; too low cuts off legitimate
     *  exploration like multi-step disk traversal. */
    maxToolIterations: number;
}

const DEFAULTS: RuntimeSettingsShape = {
    maxToolIterations: 20,
};

const BOUNDS: Record<keyof RuntimeSettingsShape, { min: number; max: number }> = {
    maxToolIterations: { min: 1, max: 100 },
};

const STORAGE_KEY = 'ittoolkit.runtimeSettings';
const CHANGE_EVENT = 'runtime-setting-change';

function loadOverrides(): Partial<RuntimeSettingsShape> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed as Partial<RuntimeSettingsShape>;
    } catch {
        // ignore corrupt storage
    }
    return {};
}

const overrides: Partial<RuntimeSettingsShape> = loadOverrides();

export const runtimeSettings: RuntimeSettingsShape = new Proxy({} as RuntimeSettingsShape, {
    get(_, key) {
        if (typeof key !== 'string') return undefined;
        if (!(key in DEFAULTS)) return undefined;
        const k = key as keyof RuntimeSettingsShape;
        const override = overrides[k];
        return override === undefined ? DEFAULTS[k] : override;
    },
    has(_, key) {
        return typeof key === 'string' && key in DEFAULTS;
    },
    ownKeys() {
        return Object.keys(DEFAULTS);
    },
    getOwnPropertyDescriptor(_, key) {
        if (typeof key !== 'string' || !(key in DEFAULTS)) return undefined;
        return { enumerable: true, configurable: true, writable: false };
    },
});

function persist(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch {
        // ignore quota / disabled storage
    }
}

export function setRuntimeSetting<K extends keyof RuntimeSettingsShape>(
    key: K,
    value: RuntimeSettingsShape[K],
): void {
    if (typeof value === 'number') {
        const bound = BOUNDS[key];
        if (bound && (value < bound.min || value > bound.max)) {
            console.warn(`[runtimeSettings] ${key}=${value} outside bounds [${bound.min}, ${bound.max}], clamping`);
            value = Math.max(bound.min, Math.min(bound.max, value)) as RuntimeSettingsShape[K];
        }
    }
    overrides[key] = value;
    persist();
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key, value } }));
    }
}

export function resetRuntimeSetting<K extends keyof RuntimeSettingsShape>(key: K): void {
    delete overrides[key];
    persist();
    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent(CHANGE_EVENT, { detail: { key, value: DEFAULTS[key] } }),
        );
    }
}

export function getRuntimeSettingDefault<K extends keyof RuntimeSettingsShape>(key: K): RuntimeSettingsShape[K] {
    return DEFAULTS[key];
}

export function isRuntimeSettingOverridden<K extends keyof RuntimeSettingsShape>(key: K): boolean {
    return key in overrides;
}

export function getRuntimeSettingBounds<K extends keyof RuntimeSettingsShape>(key: K): { min: number; max: number } | undefined {
    return BOUNDS[key];
}

export const RUNTIME_SETTING_CHANGE_EVENT = CHANGE_EVENT;

export type RuntimeSetting = keyof RuntimeSettingsShape;
