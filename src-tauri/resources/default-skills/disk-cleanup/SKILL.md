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

## Common safe-to-clean locations

These are the categories worth inspecting first. Use `execute_command` (with `du -sh`) to size them before suggesting cleanup.

### macOS
- `~/Library/Caches/` — app caches, regenerated on demand. Safe to clear when an app is closed.
- `~/Library/Logs/` — old log files.
- `~/.Trash/` — emptied trash.
- `/Library/Caches/` — system caches (requires admin; mention but don't auto-run).
- `~/Library/Developer/Xcode/DerivedData` — large for developers.

### Linux
- `~/.cache/` — XDG cache directory.
- `/var/log/` — system logs (root only; mention).
- `~/.local/share/Trash/` — trash.

### Windows (cross-platform pointers)
- `%LOCALAPPDATA%\Temp` — temp files.
- `%LOCALAPPDATA%\Microsoft\Windows\INetCache` — IE/Edge cache.

## Workflow

1. Run `du -sh` on each candidate path that exists on this OS to measure it.
2. Report sizes back to the user with a brief explanation of what each location holds.
3. Ask which ones they want to clear.
4. For each confirmed target, run the appropriate clear command (`rm -rf <path>/*` for caches, never the path itself).
5. After cleanup, re-run `df -h` and show the delta.

## What NOT to do

- Never touch `~/Documents`, `~/Desktop`, `~/Downloads` without the user reviewing each file.
- Never run cleanup on system paths (`/System`, `/usr`, `C:\Windows`) — those are managed by the OS.
- Never delete files in active app data dirs (`~/Library/Application Support/`) without naming the specific app and getting confirmation.
- Do not use `sudo` — if a path needs elevation, tell the user and stop.
