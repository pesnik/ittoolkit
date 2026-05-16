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
2. **Ask.** Don't propose to delete until the user has seen sizes and picked targets.
3. **Confirm per-target.** For each chosen path, state exactly what you'll run before running it.
4. **Clear with `rm -rf <path>/*`** — *contents* of the directory, never the directory itself.
5. **Verify.** Re-run `df -h` and show the delta.

## What NOT to do

- Never `du -sh /*` or `du -sh /` — explained above.
- Never touch `~/Documents`, `~/Desktop`, `~/Downloads` contents without the user reviewing each file. List, don't auto-clean.
- Never run cleanup on system paths (`/System`, `/usr`, `C:\Windows`) — managed by the OS.
- Never delete files in active app data dirs (`~/Library/Application Support/`) without naming the specific app and getting confirmation.
- Do not use `sudo` — if a path needs elevation, tell the user and stop.
