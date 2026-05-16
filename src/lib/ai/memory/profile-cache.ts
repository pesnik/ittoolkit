/**
 * In-memory cache of the user profile.
 *
 * prepareMessages() is called on every inference and is synchronous, but
 * loadUserProfile() is async (round-trip to Rust). This module bridges the
 * gap: the cache is populated at app startup and after profile mutations,
 * read synchronously by the system-prompt builder, and refreshed when the
 * background fact-extraction call writes new facts.
 */

import { UserProfile } from '@/types/ai-types';
import { invoke } from '@tauri-apps/api/core';
import { featureFlags } from '@/lib/featureFlags';
import { decayProfile } from './forgetting';

const MAX_FACTS_IN_PROMPT = 20;

async function loadUserProfileDirect(): Promise<UserProfile> {
    try {
        return await invoke<UserProfile>('load_user_profile');
    } catch (e) {
        console.warn('[profile-cache] load failed:', e);
        return { facts: [] };
    }
}

export function buildProfileSystemFragment(profile: UserProfile | null): string {
    if (!profile?.facts?.length) return '';
    const top = profile.facts.slice(0, MAX_FACTS_IN_PROMPT);
    const lines = top.map((f) => `- ${f.text}`);
    return `## What you remember about the user\n\nThese facts have been built up across prior conversations. Use them as context but don't recite them verbatim unless asked.\n\n${lines.join('\n')}`;
}

let cached: UserProfile | null = null;
let loadPromise: Promise<UserProfile> | null = null;

export function getCachedUserProfile(): UserProfile | null {
    return cached;
}

export async function refreshUserProfileCache(): Promise<UserProfile> {
    if (loadPromise) return loadPromise;
    loadPromise = loadUserProfileDirect()
        .then((p) => {
            const next = featureFlags.memoryForgetting ? decayProfile(p) : p;
            cached = next;
            return next;
        })
        .finally(() => {
            loadPromise = null;
        });
    return loadPromise;
}

/** Direct setter for callers that just merged facts and got the new profile back. */
export function setCachedUserProfile(profile: UserProfile): void {
    cached = featureFlags.memoryForgetting ? decayProfile(profile) : profile;
}
