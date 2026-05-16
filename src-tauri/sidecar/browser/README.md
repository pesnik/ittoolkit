# Browser-use sidecar

A small Node + Playwright process that the Tauri host (`src-tauri/src/browser_commands.rs`) spawns on demand to give the agent a real browser.

## Wire protocol

Newline-delimited JSON-RPC 2.0 over stdio. One JSON document per line.

Request → response (host → sidecar):

```jsonc
{ "jsonrpc": "2.0", "id": "call_42", "method": "browser.observe",
  "params": { "session_id": "s1" } }
```

```jsonc
{ "jsonrpc": "2.0", "id": "call_42", "result": { "url": "…", "title": "…",
  "ax": [ … ], "screenshot": "…base64…" } }
```

Event (sidecar → host, `id` omitted/null):

```jsonc
{ "jsonrpc": "2.0", "method": "browser.frame",
  "params": { "session_id": "s1", "jpeg": "…" } }
```

## Methods (M1)

- `browser.ping` → `{ ok: true }`. Liveness check.
- `browser.open` → `{ session_id }`.
- `browser.navigate` → `{ url, title }`.
- `browser.observe` → `{ url, title, ax, screenshot? }`.
- `browser.close` → `{ closed: true }`.

`browser.act` and `browser.extract` arrive in M2/M3.

## Running locally

```bash
npm install
npm run install-chromium
npm run dev    # interactive: type JSON-RPC frames on stdin, one per line
```

For production builds the sidecar is bundled as a Tauri `externalBin` —
that packaging step is M1.x follow-up work; see `tauri.conf.json`.
