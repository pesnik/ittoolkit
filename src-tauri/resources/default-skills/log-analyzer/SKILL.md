---
name: log-analyzer
description: Triage recent system errors, crashes, and warnings from system logs. Use when an app crashed, the machine froze, or the user sees unexplained errors.
when_to_use: "system is crashing", "app keeps quitting", "what just happened", "check the logs", "any errors recently".
allowed-tools:
  - execute_command
---

# Log analyzer

You are triaging recent system activity. The blocks below pre-load some safe, read-only log queries. Use them as a starting point; you can run more via `execute_command` if needed.

## Recent OS errors (last hour, where available)

```!
if [ "$(uname)" = "Darwin" ]; then
  log show --last 1h --predicate 'eventMessage CONTAINS[c] "error" OR eventMessage CONTAINS[c] "fail"' --info 2>/dev/null | tail -40
elif command -v journalctl >/dev/null 2>&1; then
  journalctl --since "1 hour ago" -p err --no-pager 2>/dev/null | tail -40
else
  echo "(no supported log source on this OS)"
fi
```

## Recent crash reports

```!
if [ "$(uname)" = "Darwin" ]; then
  ls -lt ~/Library/Logs/DiagnosticReports/ 2>/dev/null | head -10
elif [ -d /var/crash ]; then
  ls -lt /var/crash 2>/dev/null | head -10
else
  echo "(no crash report directory found)"
fi
```

## How to use this

1. Read the pre-loaded output above.
2. Group errors: are they the same component repeating, or scattered?
3. The most useful signal is usually a single failing process named over and over — name it to the user and explain what it likely does.
4. If a crash report stands out, suggest reading it with `cat` or `less` (one specific file at a time).
5. **Do not invent error messages.** If the logs above are empty, tell the user the system has been clean for the last hour.

## What to look for

- **Repeated kernel messages** — driver / hardware issue.
- **Memory pressure / OOM kills** — the user needs more RAM or a runaway process.
- **Permission denied / sandbox violations** — a misconfigured app or missing TCC grant on macOS.
- **Network unreachable / DNS failures** — point them at the `network-diagnostics` skill.
- **Disk full / I/O errors** — point them at the `disk-cleanup` skill, then suggest checking SMART.

## What NOT to do

- Don't dump entire log files into the response — summarize. Logs are huge.
- Don't speculate beyond what's in the output. If you're not sure, say so and suggest the next read.
- Don't suggest editing or deleting log files — they're useful evidence.
