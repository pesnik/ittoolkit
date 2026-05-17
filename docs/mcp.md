# MCP (Model Context Protocol) integration

`ittoolkit` participates in the MCP ecosystem from both sides:

| Direction | What it does | Where it lives |
|-----------|--------------|----------------|
| **Server** (export) | Exposes ittoolkit's tool catalog + audit/workflow/skill resources to external MCP clients (Claude Desktop, Cursor, Open Interpreter, Windsurf, …) | `src-tauri/src/mcp_server.rs` |
| **Client** (import) | Spawns external MCP servers (Postgres, Slack, Jira, GitHub, …) and surfaces their tools to ittoolkit's planner each turn | `src-tauri/src/mcp_client.rs` + `src/lib/mcp/client.ts` |

The two halves are independent — turn either on without the other.

---

## Running ittoolkit as an MCP server (for Claude Desktop, etc.)

The main binary detects the `--mcp-server` CLI flag. When present, it
bypasses the GUI and runs a stdio JSON-RPC server speaking the
2024-11-05 MCP protocol.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```jsonc
{
  "mcpServers": {
    "ittoolkit": {
      "command": "/Applications/IT Toolkit.app/Contents/MacOS/ittoolkit",
      "args": ["--mcp-server"]
    }
  }
}
```

What Claude Desktop sees:
- **Tools**: `computer_screenshot`, `computer_screen_size`,
  `computer_cursor_position`, `computer_find`, plus interactive stubs
  for `computer_left_click`, `computer_type`, `computer_key`. Write
  actions return an "interactive only — open the ittoolkit app to
  approve" message; actual dispatch still happens inside ittoolkit's
  GUI under the local user's direct approval.
- **Resources**: `file://~/.ittoolkit/audit.jsonl` (audit log),
  `file://~/.ittoolkit/workflows` (RPA workflow JSON), and
  `file://~/.ittoolkit/skills` (Anthropic-compatible Agent Skills).

This separation is intentional: ittoolkit's tool *catalog* is freely
exposable for planning, but every write requires the local user to
approve from the GUI — even when the planner that issued the call is a
different agent running in a different app.

---

## Consuming external MCP servers

The MCP client is configured by `~/.ittoolkit/mcp-clients.json`:

```jsonc
{
  "servers": {
    "postgres-local": {
      "command": "uvx",
      "args": ["mcp-server-postgres", "--db-url", "postgres://localhost/mydb"],
      "env": {}
    },
    "slack": {
      "command": "/usr/local/bin/mcp-server-slack",
      "args": [],
      "env": { "SLACK_BOT_TOKEN": "xoxb-…" }
    }
  }
}
```

Edit this file directly or use **Settings → AI → Advanced → External MCP
servers** in the app (visible when `featureFlags.mcpServer` is on).

Each configured server is spawned on demand. Its tools are surfaced to
the planner with namespaced names: `<server-id>__<tool>`. The agent
calls them like any other function; the inference loop routes the call
back to the right server based on the namespace.

Some good starting servers to wire up:

| Server | Install | Use case |
|--------|---------|----------|
| Filesystem | `npx -y @modelcontextprotocol/server-filesystem /allowed/dir` | Browse a fixed directory |
| Postgres | `uvx mcp-server-postgres --db-url …` | SQL queries against a DB |
| GitHub | `npx -y @modelcontextprotocol/server-github` | PR / issue access |
| Slack | `npx -y @modelcontextprotocol/server-slack` | Channel history, messages |
| Memory | `npx -y @modelcontextprotocol/server-memory` | Persistent KV store |

Find more at [modelcontextprotocol.io/servers](https://modelcontextprotocol.io)
and [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers).

---

## Trust model

External MCP servers run on your machine as child processes with the
permissions of the ittoolkit app. **They can:**

- Read any environment variable you pass in `env`.
- Read/write any file the spawning user can.
- Make network requests.

They cannot bypass ittoolkit's approval flow — write-classified tool
calls still surface a confirmation card before dispatch. But the
*description* of an MCP tool is attacker-controlled (the server author
writes it), and a malicious description can attempt prompt injection.
Treat MCP servers like installing a CLI tool: only run servers from
sources you trust, especially when the planner has the computer-use
harness enabled.

A "verified server" UI lock is M5.x follow-up work; for now ittoolkit
just shows the command line in the Settings list so you can review what
you're spawning.

---

## Protocol notes

- Wire: JSON-RPC 2.0, newline-delimited, over stdio.
- Negotiated version: `2024-11-05`.
- Implemented methods: `initialize`, `notifications/initialized`,
  `tools/list`, `tools/call`, `resources/list`, `resources/read`,
  `ping`.
- Not yet supported: `prompts/list`, `prompts/get`, server-initiated
  notifications, HTTP+SSE transport. The catalog grows as the agent's
  use cases demand them.
