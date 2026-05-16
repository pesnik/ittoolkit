import { invoke } from '@tauri-apps/api/core';

/** What the user/agent did with a destructive action proposal. */
export type ActionEventKind = 'emit' | 'confirm' | 'dismiss';

export interface ActionAuditEvent {
    kind: ActionEventKind;
    actionId: string;
    severity: 'low' | 'medium' | 'high';
    title: string;
    paths: string[];
    suggestedCommand: string;
    suggestedWorkingDir: string;
    /** Only on `confirm` events: the exit code of the command, or -1 on dispatch failure. */
    exitCode?: number;
}

/** Append an audit event to ~/.ittoolkit/audit.jsonl. Fire-and-forget — the
 *  log is best-effort; failures are logged to the console but never thrown
 *  to the caller because a flaky disk shouldn't break the chat. */
export function logActionEvent(event: ActionAuditEvent): void {
    void invoke('log_action_event', { event }).catch((e) => {
        console.warn('[audit] failed to record action event', { event, error: e });
    });
}
