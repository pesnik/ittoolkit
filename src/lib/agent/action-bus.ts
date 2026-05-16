export const AGENT_ACTION_EVENT = 'agent-action';

export type AgentActionType =
  | 'navigate'
  | 'render_tree'
  | 'open_file'
  | 'highlight'
  | 'select'
  | 'confirm_action'
  | 'show_toast';

export interface AgentActionEvent {
  type: AgentActionType;
  payload: Record<string, unknown>;
  sourceTurnId?: string;
}

export function emitAgentAction(action: AgentActionEvent) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(AGENT_ACTION_EVENT, { detail: action }),
  );
}

export function onAgentAction(
  handler: (action: AgentActionEvent) => void,
): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<AgentActionEvent>).detail);
  };
  window.addEventListener(AGENT_ACTION_EVENT, listener);
  return () => window.removeEventListener(AGENT_ACTION_EVENT, listener);
}
