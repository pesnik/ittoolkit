import { invoke } from '@tauri-apps/api/core';
import { SkillManifest } from '@/types/ai-types';

export async function listSkills(): Promise<SkillManifest[]> {
    return invoke<SkillManifest[]>('list_skills');
}

export async function loadSkillBody(name: string, args?: string): Promise<string> {
    return invoke<string>('load_skill_body', { name, args: args ?? '' });
}

export async function getSkillSource(name: string): Promise<string> {
    return invoke<string>('get_skill_source', { name });
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
    return invoke<void>('set_skill_enabled', { name, enabled });
}

export async function setSkillTrusted(name: string, trusted: boolean): Promise<void> {
    return invoke<void>('set_skill_trusted', { name, trusted });
}

export async function openSkillsFolder(): Promise<void> {
    return invoke<void>('open_skills_folder');
}

/**
 * Format the enabled, model-invocable skills as a compact catalog
 * for the {available_skills} prompt variable. One line per skill:
 *   - name: description
 */
export function formatSkillCatalog(skills: SkillManifest[]): string {
    const usable = skills.filter(
        (s) => s.enabled && !s.disableModelInvocation
    );
    if (usable.length === 0) {
        return '(no skills installed)';
    }
    return usable
        .map((s) => {
            const desc = s.whenToUse
                ? `${s.description} ${s.whenToUse}`
                : s.description;
            return `- /${s.name}: ${desc.trim()}`;
        })
        .join('\n');
}

/**
 * Parse a user message starting with "/skill-name [args...]" and
 * return the skill name + remaining args, or null if not a skill invocation.
 */
export function parseSkillInvocation(
    text: string,
    skills: SkillManifest[]
): { name: string; args: string; remainingText: string } | null {
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('/')) return null;
    const space = trimmed.indexOf(' ');
    const newline = trimmed.indexOf('\n');
    let end = trimmed.length;
    if (space !== -1) end = Math.min(end, space);
    if (newline !== -1) end = Math.min(end, newline);
    const name = trimmed.slice(1, end);
    const skill = skills.find((s) => s.name === name && s.enabled);
    if (!skill) return null;
    const rest = trimmed.slice(end).trim();
    return { name: skill.name, args: rest, remainingText: '' };
}
