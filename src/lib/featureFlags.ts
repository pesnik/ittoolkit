/**
 * Feature flags — single source of truth for in-progress feature toggles.
 *
 * Defaults are compile-time constants. Flip a value here to enable or disable
 * a feature across the whole app. If a flag later needs runtime overrides
 * (env vars, localStorage, remote config), wire them in here without
 * touching call sites.
 *
 * Usage:
 *     import { featureFlags } from '@/lib/featureFlags';
 *     if (featureFlags.headerPresetPicker) { ... }
 */
export const featureFlags = {
    /**
     * Show the saved-preset picker in the AI chat header (OpenAI-compatible only).
     * Off until the mid-conversation switching UX is decided. Preset management
     * still works via Settings → Providers.
     */
    headerPresetPicker: false,
} as const;

export type FeatureFlag = keyof typeof featureFlags;
