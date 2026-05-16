---
name: disk-cleanup
description: Find caches, temp files, and large items the user can safely clean to free disk space. Use when the user asks about disk space, why their drive is full, or wants to free space.
when_to_use: User says "my disk is full", "free up space", "what's taking space", or asks about cache cleanup.
allowed-tools:
  - execute_command
---

# Disk cleanup helper

You are helping the user reclaim disk space. Be cautious — never delete anything without explicit confirmation. Surface candidates, explain what each one is, and let the user choose.

## Current disk state

```!
df -h 2>/dev/null | head -10 || echo "df not available"
```

## How to find what's using space — DO IT IN THIS ORDER

**Never run `du -sh /*` from the root of the disk.** On macOS that traverses `/System` (huge, protected) and on Linux it walks `/proc` and `/sys`. Either takes longer than the tool timeout and tells the user nothing actionable.

Instead, drill into bounded, user-owned paths *one at a time*. Each path can be sized in seconds; the whole disk takes minutes.

### Step 1 — measure the home directory's top level

```
du -sh ~/Library ~/Documents ~/Downloads ~/Desktop ~/Movies ~/Music ~/Pictures 2>/dev/null
```

This usually finishes in under 10 seconds and identifies the biggest user-owned bucket.

### Step 2 — drill into the biggest bucket from Step 1

If `~/Library` was largest (common on macOS), measure its children:

```
du -sh ~/Library/Caches ~/Library/Logs ~/Library/Application\ Support ~/Library/Developer 2>/dev/null
```

If `~/Downloads` was largest, list it sorted by size:

```
ls -laS ~/Downloads | head -20
```

### Step 3 — categorize cleanup candidates

The locations below are safe-to-clean (caches/logs regenerated on demand). Measure first, never delete blindly.

#### macOS
- `~/Library/Caches/` — app caches.
- `~/Library/Logs/` — old log files.
- `~/.Trash/` — emptied trash.
- `~/Library/Developer/Xcode/DerivedData` — large for developers, fully regenerable.
- `~/Library/Caches/com.apple.dt.Xcode` — Xcode cache.

#### Linux
- `~/.cache/` — XDG cache directory.
- `~/.local/share/Trash/` — trash.

## Slow-command discipline

- `du -sh` on a single small directory: usually < 5s. No timeout override needed.
- `du -sh` on `~/Library` or other deep trees: can take 20-60s. Pass `timeout_secs: 120` explicitly.
- `du -sh /` or `du -sh /*`: do not run. Always pin to a specific user-owned subdirectory.
- If a command times out, your next call should narrow the path, not retry the same broad scan with a longer timeout.

## Workflow

1. **Measure first.** Use `du -sh <path>` on each candidate. Report sizes back to the user.
2. **Surface clickable chips.** After each `du -sh`, emit one `agent_action(navigate)` per row so the user can click and browse — see "Surfacing results" below. Do NOT just list paths in markdown; they are not clickable.
3. **Propose via card, not chat.** When the user is ready to clean a target, emit ONE `agent_action(confirm_action)` with the literal `rm -rf` line as `suggestedCommand`. The app renders an inline Execute/Dismiss card and runs the captured command verbatim on approval. Do NOT type "should I delete X?" — the card IS the question.
4. **Clear with `rm -rf <path>/*`** — *contents* of the directory, never the directory itself. This goes in `suggestedCommand`, not as a direct `execute_command` call.
5. **Verify.** Re-run `df -h` and show the delta.

## Surfacing results to the user

The app has first-class UI for paths and destructive proposals. The skill MUST use it.

**After every `du -sh` that returned paths**, emit one navigate chip per row:

```
agent_action {"action":"navigate","paths":["/Users/<you>/Library"]}
agent_action {"action":"navigate","paths":["/Users/<you>/Documents"]}
```

Up to 5 `agent_action` calls per response (validator-enforced). If you have more, pick the top 5 by size.

**Before proposing any cleanup**, emit one confirm card. Example for clearing user-cache contents:

```
agent_action {
  "action": "confirm_action",
  "paths": ["/Users/<you>/Library/Caches"],
  "title": "Clear ~/Library/Caches",
  "description": "Removes contents of ~/Library/Caches (~259 MB). Apps regenerate caches on next launch; no user data is affected.",
  "suggestedCommand": "rm -rf '/Users/<you>/Library/Caches'/*",
  "suggestedWorkingDir": "/",
  "severity": "medium",
  "totalSize": 271390000
}
```

The user clicks **Execute** or **Dismiss** on the card. On Execute the app runs `suggestedCommand` verbatim through the same security gate as `execute_command` (no `sudo`, no system paths). You do not re-issue the command — the app feeds you back the actual exit code and output, and you continue from there.

Severity guidance: the app auto-escalates to `high` for system paths (`/System`, `/usr`, `/Library`, `C:\Windows`) and for operations over ~10 GiB or 50 paths. Pick `medium` for normal user-cache cleanups; pick `high` explicitly for anything that loses regenerable-but-slow state (Xcode DerivedData, package manager caches).

## What NOT to do

- Never `du -sh /*` or `du -sh /` — explained above.
- Never touch `~/Documents`, `~/Desktop`, `~/Downloads` contents without the user reviewing each file. List, don't auto-clean.
- Never run cleanup on system paths (`/System`, `/usr`, `C:\Windows`) — managed by the OS.
- Never delete files in active app data dirs (`~/Library/Application Support/`) without naming the specific app and getting confirmation.
- Do not use `sudo` — if a path needs elevation, tell the user and stop.
