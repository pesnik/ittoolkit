// MCP server — stdio JSON-RPC mode invoked via `--mcp-server` CLI flag.
//
// When the binary starts with that flag, main.rs short-circuits Tauri's
// GUI boot and runs this server loop instead. The server speaks the same
// MCP wire protocol Claude Desktop / Open Interpreter / Cursor expect,
// exposing ittoolkit's tool catalog and audit/workflow/skill resources.
//
// Phase 1 scope (CU-M5 first cut):
//   - initialize / initialized
//   - tools/list                — returns computer_* tool metadata
//   - tools/call                — refuses with a clear "interactive only"
//                                 message; write actions stay in the GUI
//                                 where the user can see the approval
//                                 card and the kill switch. We expose the
//                                 catalog so other agents can plan with
//                                 it; the actual execution flows through
//                                 the local user.
//   - resources/list            — exposes audit log + workflow list URIs
//   - resources/read            — returns the file contents
//
// Future (CU-M5.x):
//   - tools/call with an approval-token handshake so external agents can
//     submit work that surfaces as a notification in the GUI.

use crate::mcp_types::{
    self, CallToolParams, CallToolResult, ContentBlock, InitializeResult, JsonRpcRequest,
    JsonRpcResponse, ListResourcesResult, ListToolsResult, McpResource, McpTool, ResourcesCapability,
    ServerCapabilities, ServerInfo, ToolsCapability, PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};

const SERVER_NAME: &str = "ittoolkit";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Entry point invoked from main.rs when --mcp-server is on the CLI.
/// Blocks the calling thread; never returns until stdin closes.
pub fn run_stdio() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut buf = String::new();

    log_stderr("ittoolkit MCP server ready (stdio)");

    loop {
        buf.clear();
        match reader.read_line(&mut buf) {
            Ok(0) => {
                log_stderr("stdin closed; exiting");
                break;
            }
            Ok(_) => {
                let line = buf.trim();
                if line.is_empty() {
                    continue;
                }
                let req: JsonRpcRequest = match serde_json::from_str(line) {
                    Ok(r) => r,
                    Err(e) => {
                        write_frame(
                            &stdout,
                            &mcp_types::err(Value::Null, -32700, format!("parse error: {}", e)),
                        );
                        continue;
                    }
                };
                handle(&stdout, req);
            }
            Err(e) => {
                log_stderr(&format!("read error: {}", e));
                break;
            }
        }
    }
}

fn handle(stdout: &std::io::Stdout, req: JsonRpcRequest) {
    // Notifications (no id) get no response.
    let id = match req.id.clone() {
        Some(v) if !v.is_null() => Some(v),
        _ => None,
    };

    match req.method.as_str() {
        "initialize" => {
            if let Some(id) = id {
                let result = InitializeResult {
                    protocol_version: PROTOCOL_VERSION.to_string(),
                    capabilities: ServerCapabilities {
                        tools: Some(ToolsCapability { list_changed: Some(false) }),
                        resources: Some(ResourcesCapability {
                            subscribe: Some(false),
                            list_changed: Some(false),
                        }),
                    },
                    server_info: ServerInfo {
                        name: SERVER_NAME.to_string(),
                        version: SERVER_VERSION.to_string(),
                    },
                };
                write_frame(
                    stdout,
                    &mcp_types::ok(id, serde_json::to_value(result).unwrap()),
                );
            }
        }
        "notifications/initialized" => {
            // No response for notifications.
        }
        "tools/list" => {
            if let Some(id) = id {
                let result = ListToolsResult { tools: tool_catalog() };
                write_frame(
                    stdout,
                    &mcp_types::ok(id, serde_json::to_value(result).unwrap()),
                );
            }
        }
        "tools/call" => {
            if let Some(id) = id {
                let params: CallToolParams = match req.params {
                    Some(p) => match serde_json::from_value(p) {
                        Ok(v) => v,
                        Err(e) => {
                            write_frame(
                                stdout,
                                &mcp_types::err(id, -32602, format!("invalid params: {}", e)),
                            );
                            return;
                        }
                    },
                    None => {
                        write_frame(
                            stdout,
                            &mcp_types::err(id, -32602, "tools/call requires params"),
                        );
                        return;
                    }
                };
                let result = CallToolResult {
                    content: vec![ContentBlock::Text {
                        text: format!(
                            "ittoolkit's '{}' tool is interactive: it requires user approval inside the ittoolkit app before executing. Open ittoolkit, ensure the computer-use harness is enabled, and dispatch the action from there. The MCP server exposes the catalog for planning; actual execution stays under the local user's direct supervision.",
                            params.name
                        ),
                    }],
                    is_error: Some(true),
                };
                write_frame(
                    stdout,
                    &mcp_types::ok(id, serde_json::to_value(result).unwrap()),
                );
            }
        }
        "resources/list" => {
            if let Some(id) = id {
                let result = ListResourcesResult { resources: resource_catalog() };
                write_frame(
                    stdout,
                    &mcp_types::ok(id, serde_json::to_value(result).unwrap()),
                );
            }
        }
        "resources/read" => {
            if let Some(id) = id {
                let result = read_resource(&req.params);
                match result {
                    Ok(v) => write_frame(stdout, &mcp_types::ok(id, v)),
                    Err((code, msg)) => write_frame(stdout, &mcp_types::err(id, code, msg)),
                }
            }
        }
        "ping" => {
            if let Some(id) = id {
                write_frame(stdout, &mcp_types::ok(id, json!({})));
            }
        }
        other => {
            if let Some(id) = id {
                write_frame(
                    stdout,
                    &mcp_types::err(id, -32601, format!("method not found: {}", other)),
                );
            }
        }
    }
}

fn write_frame(stdout: &std::io::Stdout, frame: &JsonRpcResponse) {
    let line = match serde_json::to_string(frame) {
        Ok(s) => s,
        Err(e) => {
            log_stderr(&format!("serialize error: {}", e));
            return;
        }
    };
    let mut handle = stdout.lock();
    if writeln!(handle, "{}", line).is_err() {
        log_stderr("stdout write failed");
    }
    let _ = handle.flush();
}

fn log_stderr(msg: &str) {
    let _ = writeln!(std::io::stderr(), "[ittoolkit-mcp] {}", msg);
}

/// Hardcoded mirror of the agent-callable computer_* tool catalog. Keep in
/// sync with `src/lib/ai/ai-service.ts`. We hardcode rather than read from
/// the running Tauri state so the MCP-server CLI mode boots without
/// Tauri's runtime.
fn tool_catalog() -> Vec<McpTool> {
    vec![
        McpTool {
            name: "computer_screenshot".into(),
            description: "Capture a screenshot of the user's screen and return base64 JPEG + dims. Read-only.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "display_index": { "type": "number", "description": "Optional display index (omit for primary)." }
                }
            }),
        },
        McpTool {
            name: "computer_screen_size".into(),
            description: "Return display layout: index, x, y, width, height, scale, primary, name. Read-only.".into(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        McpTool {
            name: "computer_cursor_position".into(),
            description: "Return current cursor (x, y). Read-only.".into(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        McpTool {
            name: "computer_find".into(),
            description: "Locate a UI element by natural-language description; returns (x, y) without clicking. Routes through OmniParser + UI-TARS locally.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "display_index": { "type": "number" }
                },
                "required": ["query"]
            }),
        },
        McpTool {
            name: "computer_left_click".into(),
            description: "Left-click at (x, y) — interactive (user approval required in ittoolkit).".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "x": { "type": "number" }, "y": { "type": "number" } }
            }),
        },
        McpTool {
            name: "computer_type".into(),
            description: "Type text into focused element — interactive (user approval required).".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"]
            }),
        },
        McpTool {
            name: "computer_key".into(),
            description: "Press a key or chord (e.g. \"Enter\", \"cmd+space\") — interactive.".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "key": { "type": "string" } },
                "required": ["key"]
            }),
        },
    ]
}

fn resource_catalog() -> Vec<McpResource> {
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/"));
    let audit = home.join(".ittoolkit").join("audit.jsonl");
    let workflows = home.join(".ittoolkit").join("workflows");
    let skills = home.join(".ittoolkit").join("skills");
    vec![
        McpResource {
            uri: format!("file://{}", audit.display()),
            name: "Audit log".into(),
            description: Some("Append-only JSONL log of confirmed/denied agent actions.".into()),
            mime_type: Some("application/jsonl".into()),
        },
        McpResource {
            uri: format!("file://{}", workflows.display()),
            name: "Recorded workflows".into(),
            description: Some("Directory of .workflow.json files for RPA replay.".into()),
            mime_type: Some("inode/directory".into()),
        },
        McpResource {
            uri: format!("file://{}", skills.display()),
            name: "Installed skills".into(),
            description: Some("Anthropic-compatible Agent Skills (SKILL.md per folder).".into()),
            mime_type: Some("inode/directory".into()),
        },
    ]
}

fn read_resource(params: &Option<Value>) -> Result<Value, (i32, String)> {
    let uri = params
        .as_ref()
        .and_then(|v| v.get("uri"))
        .and_then(|v| v.as_str())
        .ok_or((-32602, "resources/read requires 'uri'".to_string()))?;
    let path = uri.strip_prefix("file://").ok_or((
        -32602,
        format!("only file:// URIs supported, got '{}'", uri),
    ))?;
    match std::fs::read(path) {
        Ok(bytes) => {
            let text = String::from_utf8_lossy(&bytes).to_string();
            Ok(json!({
                "contents": [{
                    "uri": uri,
                    "mimeType": "text/plain",
                    "text": text
                }]
            }))
        }
        Err(e) => Err((-32000, format!("read failed: {}", e))),
    }
}
