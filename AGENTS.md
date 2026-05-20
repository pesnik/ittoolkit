# IT Toolkit — Agent Context

## Stack

- **Tauri 2** (Rust) — backend, system APIs, file I/O, sidecar management
- **Next.js 15 / React 19** — frontend SPA (no SSR; Tauri WebView is the browser)
- **Fluent UI v9** (`@fluentui/react-components`) — design system, all UI components
- **TypeScript** throughout the frontend

## Build & Test

```bash
# Frontend
npm install
npm run dev          # dev server on localhost:3000
npm run build        # production build
npx tsc --noEmit     # type-check only

# Rust backend
cd src-tauri && cargo check            # check compilation (fast)
cd src-tauri && cargo build             # full debug build
cd src-tauri && cargo test              # run Rust tests
cd src-tauri && cargo clippy            # lints

# Full Tauri dev (frontend + backend)
npm run tauri dev
npm run tauri build    # release build
```

## Critical: Fluent UI v9 + `createPortal`

Fluent UI v9 scopes its CSS variables (design tokens) to the `<FluentProvider>` DOM node, not `:root`. Any React component rendered via `createPortal` to `document.body` lands **outside** that DOM node — it renders unstyled (no border, no background, wrong colors) and `Input`/`Select` components become non-interactive.

**Rule:** Every `createPortal(content, document.body)` call **must** wrap `content` in a `<FluentProvider>` using the active theme:

```tsx
import { FluentProvider, webLightTheme, webDarkTheme } from '@fluentui/react-components';
import { useTheme } from '@/lib/ThemeContext';

const { theme: appTheme } = useTheme();
const fluentTheme = appTheme === 'light' ? webLightTheme : webDarkTheme;

return createPortal(
    <FluentProvider theme={fluentTheme}>{panel}</FluentProvider>,
    document.body,
);
```

## Theme

- `src/lib/ThemeContext.tsx` — `ThemeProvider` wraps children in `FluentProvider`; exposes `useTheme()` hook
- `src/app/providers.tsx` — top-level `Providers` component, mounts `ThemeProvider`
- Default theme: **dark** (`webDarkTheme`)
- Persisted to `localStorage` under key `'app-theme'`

## Workflow System

### Schema versions
- **v1** — raw tool-call tape (legacy). Struct: `WorkflowFile` in `workflow_recorder.rs`.
- **v2** — intent-annotated, actor-aware, typed. Fields: `version: 2`, `variables`, typed `steps` with `intent`, `actor`, `retry`, `postcondition`. TypeScript type: `WorkflowFileV2`.

`workflow_load` returns `serde_json::Value` (raw JSON) to support both versions without a strict struct. The frontend uses the `isV2(wf)` guard in `src/types/workflow-types.ts` to dispatch.

### Actor model
| Actor | Meaning |
|-------|---------|
| `auto` | Deterministic, no LLM |
| `agent` | LLM fills from conversation context |
| `human` | Pauses for user interaction |

### Key files
| Path | Purpose |
|------|---------|
| `src-tauri/src/workflow_recorder.rs` | Tauri commands: record, list, load, replay bind, run checkpoints |
| `src/lib/workflows/engine.ts` | TypeScript execution loop, three-tier recovery |
| `src/lib/workflows/agent-recovery.ts` | LLM recovery sub-loop for failed steps |
| `src/components/WorkflowRunPanel.tsx` | Floating execution UI (portal — see FluentProvider note above) |
| `src/components/workflow/StepRow.tsx` | Per-step card with actor badge and retry state |
| `src/components/workflow/VariablesPanel.tsx` | Live variable display |
| `src/components/workflow/HumanGate.tsx` | Human input / intervention pause cards |
| `src/types/workflow-types.ts` | All workflow TypeScript types |
| `src-tauri/resources/default-workflows/` | Bundled canonical workflow JSON files |

### Seeding
Default workflows are seeded to `~/.ittoolkit/workflows/` on app startup (merge-only, never overwrites user edits). Same pattern as skills via `seed_default_workflows` in `workflow_recorder.rs`.

## Browser Automation

- **Sidecar**: `src-tauri/sidecar/browser/` — Playwright Node.js process managed by Tauri
- **Site profiles**: `src-tauri/sidecar/browser/src/site-profiles.ts` — per-hostname locator strategies, ready selectors, pre-act delays
- **Site skills**: `src-tauri/resources/default-skills/browser-sites/<hostname>/SKILL.md` — LLM knowledge injected on `browser_navigate`
- Profiled sites: Slack, GitHub, Linear, Figma, Notion, **M365 Admin**, **Okta Admin**, **Jira/Confluence**, **ServiceNow**

## Tauri / Rust Notes

- `AppHandle::path()` requires `use tauri::Manager;` in scope.
- New Tauri commands must be registered in `src-tauri/src/lib.rs` `invoke_handler!`.
- New resource directories must be added to `src-tauri/tauri.conf.json` under `bundle.resources`.
- `serde_json::Value` is used for schema-agnostic JSON passthrough when Rust structs would be too strict (e.g. `workflow_load`).

## Tool invocation hierarchy — CLI first, browser second, computer-use last

When choosing how to perform an action, always try the **most reliable, fastest, least permission-dependent** approach first:

| Priority | Layer | Why first | Examples |
|----------|-------|-----------|----------|
| **1st** | CLI / shell / scripting | Deterministic, fast, no Accessibility permission, LLMs excel at text | `shell_exec`, AppleScript, PowerShell, `open` URL schemes, `osascript`, `networksetup`, `reg.exe` |
| **2nd** | Browser automation | Web apps have stable DOM selectors, no OS permission needed | `browser_open`, `browser_navigate`, `browser_act`, `browser_extract` |
| **3rd** | Computer-use (GUI) | Fragile (coordinates change, needs AX permission), last resort | `computer_screenshot`, `computer_find`, `computer_mouse_move`, `computer_click` |

**Rule of thumb:** If you can accomplish the task with a shell command, AppleScript, PowerShell, or an HTTP API call — do that. Only reach for browser or computer-use when the task genuinely requires visual GUI interaction (native app with no CLI, captcha, unusual WebView).

**Examples of CLI-first thinking:**
- "Open Wi-Fi settings" → `open "x-apple.systempreferences:com.apple.wifi-settings"` (not `computer_find` + click)
- "What's my IP address" → `curl ifconfig.me` or `ipconfig getifaddr en0` (not screenshot)
- "Check disk space" → `df -h` (not browser to cloud console)
- "Create a file" → `echo ... > file.txt` (not GUI text editor)

## Platform-specific CLI patterns

Know these by heart. They are faster, more reliable, and require fewer permissions than GUI automation.

### macOS (AppleScript + shell)

| Task | Command |
|------|---------|
| Open System Settings pane | `open "x-apple.systempreferences:com.apple.<pane>"` — panes: `wifi-settings`, `network`, `bluetooth`, `displays`, `sound`, `keyboard`, `mouse`, `trackpad`, `privacy-security`, `touchid`, `notifications`, `battery`, `general` |
| Open any app | `open -a "App Name"` or `open /Applications/App.app` |
| Get frontmost app | `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'` |
| Click a UI element | `osascript -e 'tell application "System Events" to tell process "AppName" to click button "OK" of window 1'` |
| Type text | `osascript -e 'tell application "System Events" to keystroke "text"'` |
| Press a key | `osascript -e 'tell application "System Events" to keystroke return'` — modifiers: `command`, `option`, `control`, `shift` (e.g. `keystroke "s" using command down`) |
| Get window position/size | `osascript -e 'tell application "System Events" to get position of window 1 of process "AppName"'` |
| Get network info | `networksetup -listallhardwareports`, `ipconfig getifaddr en0`, `networksetup -getairportnetwork en0` |
| System info | `system_profiler SPHardwareDataType`, `sysctl hw.memsize`, `sw_vers` |
| Power management | `pmset -g batt` (battery status), `pmset -g` (power settings) |
| File metadata | `mdls <file>`, `mdfind <query>` (Spotlight search) |
| Clipboard | `pbpaste` (read), `echo "text" \| pbcopy` (write) |
| Notification | `osascript -e 'display notification "msg" with title "Title"'` |
| Finder automation | `osascript -e 'tell app "Finder" to select file "path"'` |
| Dialog boxes | `osascript -e 'display dialog "question" buttons {"No","Yes"} default button "Yes"'` |

**AppleScript + System Events** is often a full replacement for `computer_find` on macOS — it can query UI elements by name, role, or position without Accessibility permission for basic process-level commands. For element-level access (buttons, text fields), it needs Accessibility permission (same as `computer_find`), but the `keystroke` and `click` approaches work for focused windows.

### Windows (PowerShell)

| Task | Command |
|------|---------|
| Open Settings pane | `Start-Process "ms-settings:<pane>"` — panes: `network-wifi`, `bluetooth`, `display`, `sound`, `troubleshoot`, `windowsupdate`, `privacy`, `about` |
| Open any app | `Start-Process "appName"` or `Start-Process "C:\Path\app.exe"` |
| Get foreground window | `Add-Type @' ... '@; [ActiveWindow]::GetActiveWindowTitle()` |
| System info | `Get-ComputerInfo`, `Get-CimInstance Win32_OperatingSystem` |
| Network config | `Get-NetAdapter`, `Get-NetIPAddress`, `ipconfig /all`, `netsh wlan show interfaces` |
| Process management | `Get-Process`, `Stop-Process -Name "name"` |
| Registry | `Get-ItemProperty -Path "HKLM:\Software\..."`, `Set-ItemProperty` |
| Service management | `Get-Service`, `Restart-Service`, `Start-Service`, `Stop-Service` |
| File operations | `Get-Content`, `Set-Content`, `Copy-Item`, `Remove-Item`, `New-Item` |
| Clipboard | `Get-Clipboard`, `Set-Clipboard` |
| Dialog boxes | `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('msg')` |
| Scheduled tasks | `Get-ScheduledTask`, `New-ScheduledTask`, `Start-ScheduledTask` |
| Event log | `Get-WinEvent -LogName System -MaxEvents 10` |
| User accounts | `Get-LocalUser`, `Set-LocalUser`, `net user` |

### Linux (shell)

| Task | Command |
|------|---------|
| Open settings | `gnome-control-center wifi`, `gnome-settings` (varies by DE) |
| System info | `uname -a`, `cat /etc/os-release`, `lscpu`, `lsblk`, `free -h` |
| Network | `ip a`, `nmcli`, `iwconfig`, `ss -tln` |
| Package management | `apt list --installed`, `dpkg -l`, `brew list` (macOS) |
| Services | `systemctl status`, `journalctl -xe` |
