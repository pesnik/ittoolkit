/**
 * Phase 5 memory: forgetting policy.
 *
 * Memory without decay is a liability — old facts that are no longer true
 * actively mislead the model. We apply two cheap rules:
 *
 *   1. Profile facts: drop facts older than STALE_DAYS that were only
 *      reinforced once. Anything reinforced multiple times survives —
 *      it's likely a stable trait, not a one-off observation.
 *
 *   2. Conversation summaries: don't delete, but annotate at injection
 *      time when they're getting old, so the model can downweight them.
 */

import { UserProfile } from '@/types/ai-types';

const STALE_FACT_DAYS = 90;
const STALE_FACT_REINFORCEMENT_FLOOR = 2;
const SUMMARY_STALE_DAYS = 30;

export function decayProfile(profile: UserProfile): UserProfile {
    if (!profile?.facts?.length) return profile;
    const now = Date.now();
    const cutoffMs = STALE_FACT_DAYS * 24 * 60 * 60 * 1000;
    const kept = profile.facts.filter((fact) => {
        const lastReinforced = Date.parse(fact.lastReinforcedAt);
        if (Number.isNaN(lastReinforced)) return true;
        const ageMs = now - lastReinforced;
        if (ageMs < cutoffMs) return true;
        return fact.reinforcementCount >= STALE_FACT_REINFORCEMENT_FLOOR;
    });
    if (kept.length === profile.facts.length) return profile;
    return { ...profile, facts: kept };
}

export function summaryStalenessNote(summaryUpdatedAt: string | undefined): string {
    if (!summaryUpdatedAt) return '';
    const updated = Date.parse(summaryUpdatedAt);
    if (Number.isNaN(updated)) return '';
    const ageDays = (Date.now() - updated) / (24 * 60 * 60 * 1000);
    if (ageDays < SUMMARY_STALE_DAYS) return '';
    const days = Math.round(ageDays);
    return `\n\n_Note: this summary is ${days} days old. The user may have moved on or changed direction since then — verify before assuming anything is still in flight._`;
}

export const FORGETTING_CONFIG = {
    staleFactDays: STALE_FACT_DAYS,
    staleFactReinforcementFloor: STALE_FACT_REINFORCEMENT_FLOOR,
    summaryStaleDays: SUMMARY_STALE_DAYS,
};
