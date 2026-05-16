# RFC 001: Agent-App Bidirectional Integration

**Status:** Draft  
**Date:** 2026-05-16  
**Author:** AI-assisted  
**PR:** (to be linked)

---

## Summary

The agent currently outputs plain text into a chat bubble. Non-technical users see disk paths like `~/Library/Caches: 574M` with no way to interact with them visually. This RFC proposes an event-based action protocol that lets the agent drive the app's native UI (file explorer, dialogs) and lets the user build context in the UI and send it to the agent — closing the loop between chat and canvas.

## Motivation

- **Non-tech users** can't safely reason about `du -sh` output. They need to *see* the folders, *click* to browse, *check* what to delete.
- **Chat-only agents** have no way to manipulate the app UI — every interaction is text-in, text-out. The app has a file explorer, a disk usage chart, and a toolshed, but the agent can't use any of them.
- **Discovery** is poor: skills exist but users have no way to browse or trigger them visually.
- **Trust** is low: when the agent says "I'll delete X", the user has no way to preview or verify before confirming.

## Design

### Core abstraction: Agent Action Bus

A typed event bus — built on the existing `CustomEvent` pattern already used by `runtimeSettings` — that any component can emit or subscribe to.

```typescript
// src/lib/agent/action-bus.ts
type AgentActionType =
  | 'navigate'          // Move file explorer to a path
  | 'render_tree'       // Show inline disk usage tree in chat
  | 'open_file'         // Open file in system editor
  | 'highlight'         // Highlight items in file explorer
  | 'select'            // Select items in file explorer
  | 'confirm_action'    // Show native confirmation dialog for destructive ops
  | 'show_toast';       // Show an app toast notification

interface AgentActionEvent {
  type: AgentActionType;
  payload: Record<string, unknown>;
  sourceTurnId?: string;
}
```

Skills return structured data alongside text via a new `agent_action` tool call. The frontend parses it into interactive UI elements.

### Phases

#### Phase 1 — Structured tool output (foundation)

Tool results carry typed actions alongside human-readable text, so the UI knows what to do with them instead of treating everything as plain text.

| File | Change |
|------|--------|
| `src/types/ai-types.ts` | Add `ToolResultAction` union, extend `ToolExecutionData` |
| `src/lib/agent/action-bus.ts` | New: typed event bus |
| `src/lib/ai/inference-with-tools.ts` | Handle `agent_action` tool calls |
| `src/components/ToolCallDisplay.tsx` | Render action chips |

#### Phase 2 — Clickable paths → File explorer navigation (HIGHEST VALUE)

Agent output paths become clickable chips. Clicking one dispatches a `navigate` action; the file explorer subscribes and opens that folder.

**User flow:**
1. Agent: "`~/Library/Caches: 574M`" renders as text + `[Open]` chip
2. User clicks `[Open]`
3. File explorer navigates to `~/Library/Caches`
4. User sees the actual files, browses visually, decides what to do

| File | Change |
|------|--------|
| `src/components/AgentActionChip.tsx` | New: clickable path chip component |
| `src/components/ToolCallDisplay.tsx` | Parse paths from tool result, render chips |
| `src/components/FileExplorer.tsx` | Subscribe to `agent-action` CustomEvent |
| `src/components/AIPanel.tsx` | Populate `contextPaths` from tool results |

#### Phase 3 — Toolshed: Skill launcher + context builder

A visual dashboard where users browse skills, configure parameters via the file explorer, and launch the agent with pre-built context.

**User flow:**
1. User clicks "Tool Shed" view
2. Grid of skill cards shown (name, description, when-to-use)
3. User clicks "Disk Cleanup" → context builder appears
4. Builder shows: target directory (auto-filled from current explorer location), options
5. "Select folders" button pins the file explorer in selection mode
6. User picks folders, clicks "Done"
7. "Launch Agent" opens AIPanel, pre-fills `/disk-cleanup /path/to/target`

| File | Change |
|------|--------|
| `src/components/Toolshed.tsx` | New: skill card grid + context builder |
| `src/components/FileExplorer.tsx` | Add selection mode, "Ask Agent" button |
| `src/components/SkillContextBuilder.tsx` | New: parameter form with file picker |
| `src/app/page.tsx` | Wire toolshed → agent launch flow |

#### Phase 4 — File explorer → Agent context

User selects items in the explorer and clicks "Ask Agent". The agent receives structured context (paths, sizes, metadata) and knows the user pointed at these items — they didn't type them.

| File | Change |
|------|--------|
| `src/types/ai-types.ts` | Add `userIntent` to `FileSystemContext` |
| `src/components/FileExplorer.tsx` | "Ask Agent" button on selection |
| `src/lib/ai/ai-service.ts` | Inject `userIntent` into system prompt |

#### Phase 5 — Agent-initiated native dialogs

Destructive operations (delete, clean) show a native confirmation dialog with checkboxes, size breakdowns, and a preview button — not just chat text.

| File | Change |
|------|--------|
| `src/components/AgentConfirmationDialog.tsx` | New: native confirmation UI |
| `src/components/AIPanel.tsx` | Subscribe to confirm_action, render dialog |
| `src/lib/ai/inference-with-tools.ts` | Async wait for user response |

### Event bus architecture

```
agent_action tool call
  └─> inference-with-tools.ts
        └─> ToolExecutionData + actions[]
              └─> ToolCallDisplay renders chips
                    └─> User clicks chip
                          └─> emitAgentAction({ type: 'navigate', payload: { path } })
                                └─> window 'agent-action' CustomEvent
                                      └─> FileExplorer subscriber handles navigate
```

The bus is a single module (~40 lines) using the existing `CustomEvent` pattern, zero dependencies.

## Rationale

**Why not AG-UI / CopilotKit?**  
AG-UI is designed for cross-framework agent orchestration (LangGraph ↔ React via SSE). This app has a single agent backend and a single React frontend. A lightweight CustomEvent bus achieves the same bidirectional flow with zero new dependencies and matches the patterns already used in the codebase.

**Why phased delivery?**  
Each phase independently delivers user value. Phase 2 alone (clickable paths) solves the immediate disk-cleanup UX problem. Phases can be shipped incrementally without breaking existing functionality.

**Why CustomEvent over React Context?**  
The file explorer and AI panel are siblings under `page.tsx`. A CustomEvent avoids prop-drilling through intermediate components and matches the existing `runtime-setting-change` / `feature-flag-change` patterns.

## Drawbacks

- Parsing paths from text tool results (Phase 2 initial approach) is heuristic-based. Phase 1's structured actions fix this properly.
- The event bus is untyped at runtime (CustomEvent carries `any` detail). TypeScript types at the emit/subscribe boundaries mitigate this.

## Alternatives considered

1. **CopilotKit / AG-UI full integration** — Powerful but introduces an entire runtime for what a 40-line event bus achieves. Worth revisiting if multi-agent orchestration is needed later.
2. **React Context + reducer** — Would work but couples the file explorer and AI panel more tightly. The CustomEvent pattern lets either component evolve independently.
3. **Rust Tauri events** — Already used for `scan-progress` and `ai-response-chunk`. Possible but adds Rust overhead for UI-only concerns.

## Migration strategy

- Existing `ToolExecutionData` remains backward-compatible (new `actions` field is optional)
- Existing `FileExplorer` continues working unmodified (the event subscriber is additive)
- Existing skills continue working unmodified (the `agent_action` tool is additive)
- Existing `ChatMessage` with `contextPaths` starts being populated where it was previously empty

---

## Implementation notes (appended at merge review)

This section was added during the tech-lead review before merging into `main`. It documents the hardening applied on top of the original design so the constraints aren't lost in commit history.

### Validator at the LLM ↔ UI boundary

`executeAgentAction` in `src/lib/ai/inference-with-tools.ts` validates every argument before any structured action reaches the UI. The boundary is the only place model output is trusted, so all checks live here:

- `action` must be one of the four literal enum values; unknown values return a tool error the model can recover from.
- `paths` must be absolute (POSIX `"/…"`, `~/…`, or Windows `"C:\…"`), free of NUL / CR / LF, ≤ 4096 chars each, deduplicated.
- `title` and `description` go through `plainText(s, 500)` which strips `\p{Cc}` control chars and clamps length. Downstream consumers (chips, audit log, aria-labels) can treat these as safe plain text.
- For `confirm_action`, `suggestedCommand` and `suggestedWorkingDir` are **required**. The command the user sees on the card is the exact bytes the app will run on approval — see "Structured approval" below.
- `severity` defaults to `'medium'` (not `'low'`) when omitted. The model may over-claim risk but never under-claim.

### Severity escalation

`escalateSeverity(claimed, paths, totalSize)` picks the higher of the model's claim vs. a derived floor. The floor is forced to `'high'` when:

- any path matches `^/(System|usr|bin|sbin|etc|Library|var|boot|opt|root)/`
- any path matches Windows `C:\Windows`, `C:\Program Files`, `C:\ProgramData`
- `totalSize >= 10 GiB`
- `paths.length >= 50`

The card shows the escalated severity, the badge color reflects it, and the audit log records both the claimed and the resolved value via the action ID.

### Per-turn action budget

A `TurnBudget` object (default `{ actionsRemaining: 5 }`) is created at each iteration of `runInferenceWithTools` and threaded through `executeTool`. A model that emits more than 5 `agent_action` calls in one response will receive a tool error on the sixth and beyond — preventing a misbehaving prompt from flooding the chat with chips or cards.

### Structured approval (no chat replay)

The original branch sent `"**Action Confirmed:** <id>"` as a freeform user message and asked the model to "proceed with the operation as described," which forced the destructive command to be reconstructed from the model's memory of its own earlier turn. That is racy (file system can change between emit and re-issue) and prompt-injectable (any intervening text could nudge the model toward a different command).

The current flow:

1. The agent emits `agent_action(confirm_action, …, suggestedCommand, suggestedWorkingDir)`.
2. `AIPanel.onToolExecution` captures the action into `pendingActionsRef: Map<actionId, PendingAgentAction>`.
3. The user sees the card and clicks **Execute** or **Dismiss**.
4. On Execute, `handleToolActionResponse` invokes `execute_command` directly with the stored `suggestedCommand` / `suggestedWorkingDir` — byte-for-byte what the user saw — and feeds the actual output back to the model as a continuation message.
5. On Dismiss, a structured rejection ("Do NOT run `<cmd>`") goes back to the model.

The `pendingActionsRef` entry is deleted on use so a double-click can't run the command twice. The model never has the chance to swap the command in between.

### Audit log

`~/.ittoolkit/audit.jsonl` records one row per `emit` / `confirm` / `dismiss` event, with the action ID linking all three. `confirm` rows include the exit code so failures are traceable. The file rotates at 5 MiB and is local-only — nothing leaves the machine. See `src-tauri/src/audit_log.rs`.

### Unconditional shell guardrail

`agent_action(confirm_action)` is layered on top of, not in place of, `shell_classify::is_blocked()` in `src-tauri/src/execute_command.rs`. The unconditional refusal layer (commit `3c6e099`) tokenizes the command, resolves wrappers (`sudo`, `env`, `find -exec`, `sh -c`, `$(…)`), and rejects the worst categories regardless of how they got there. This is the single source of truth for "never run this" and remains the last gate before `sh -c`. The earlier ad-hoc blocklist that the integration branch tried to introduce was dropped at merge.

### Path extraction in the UI

Free-text regex path extraction was removed from `ToolCallDisplay`. Paths-with-spaces (common on macOS volumes like `/Volumes/Time Machine Backups/…`) confused the regex into emitting truncated chips. The chip extractor now consumes:

1. **Structured `agent_action` results first** — when present, these are the source of truth.
2. **Tab-separated tool output (`du`/`ls`/`find`/`stat`/`wc` only)** — fall back here because that output shape is unambiguous.

For any other command output, the agent is expected to emit a structured action.

### Out of scope for this merge

- A test harness for the action bus and validator (filed as follow-up; the repo has zero tests today and adding the harness shouldn't ride this merge).
- Replacing `CustomEvent` with a real store. Premature for the current panel set.
- Migrating to AG-UI / A2UI / MCP-Apps protocols. Worth a future RFC if vendor-protocol compatibility becomes a goal.
