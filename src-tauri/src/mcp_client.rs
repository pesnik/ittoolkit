use crate::mcp_types::{self, McpTool, PROTOCOL_VERSION};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{command, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

const CLIENTS_FILE: &str = ".ittoolkit/mcp-clients.json";
const RPC_TIMEOUT_SECS: u64 = 30;
const SPAWN_INIT_TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpClientsFile {
    #[serde(default)]
    pub servers: HashMap<String, McpServerSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

type PendingMap = HashMap<u64, oneshot::Sender<Result<Value, String>>>;

struct Connection {
    child: Child,
    stdin: ChildStdin,
    pending: Arc<Mutex<PendingMap>>,
    next_id: u64,
    tools: Vec<McpTool>,
}

#[derive(Default)]
struct McpClientInner {
    connections: HashMap<String, Connection>,
}

#[derive(Default)]
pub struct McpClientState {
    inner: Arc<Mutex<McpClientInner>>,
}

fn config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot resolve home dir".to_string())?;
    Ok(home.join(CLIENTS_FILE))
}

fn read_config() -> McpClientsFile {
    let path = match config_path() {
        Ok(p) => p,
        Err(_) => return McpClientsFile::default(),
    };
    if !path.exists() {
        return McpClientsFile::default();
    }
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return McpClientsFile::default(),
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn write_config(cfg: &McpClientsFile) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

async fn next_id(conn: &mut Connection) -> u64 {
    conn.next_id = conn.next_id.wrapping_add(1);
    if conn.next_id == 0 {
        conn.next_id = 1;
    }
    conn.next_id
}

async fn send_frame(conn: &mut Connection, frame: &Value) -> Result<(), String> {
    let mut line = serde_json::to_string(frame).map_err(|e| e.to_string())?;
    line.push('\n');
    conn.stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("write frame: {}", e))?;
    conn.stdin.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn request(conn: &mut Connection, method: &str, params: Value) -> Result<Value, String> {
    let id = next_id(conn).await;
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = conn.pending.lock().await;
        pending.insert(id, tx);
    }
    let frame = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    send_frame(conn, &frame).await?;
    match tokio::time::timeout(std::time::Duration::from_secs(RPC_TIMEOUT_SECS), rx).await {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err("MCP server dropped response channel".into()),
        Err(_) => {
            let mut pending = conn.pending.lock().await;
            pending.remove(&id);
            Err(format!("MCP server timeout after {}s", RPC_TIMEOUT_SECS))
        }
    }
}

async fn notify(conn: &mut Connection, method: &str, params: Value) -> Result<(), String> {
    let frame = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    });
    send_frame(conn, &frame).await
}

async fn spawn_server(spec: &McpServerSpec) -> Result<Connection, String> {
    let mut cmd = Command::new(&spec.command);
    cmd.args(&spec.args);
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {}", spec.command, e))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "child stdin missing".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "child stdout missing".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "child stderr missing".to_string())?;

    let pending: Arc<Mutex<PendingMap>> = Arc::new(Mutex::new(HashMap::new()));

    let cmd_for_log = spec.command.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            log::info!("[mcp:{}] {}", cmd_for_log, line);
        }
    });

    let pending_reader = Arc::clone(&pending);
    let cmd_for_reader = spec.command.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let frame: Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("[mcp:{}] unparseable: {} ({})", cmd_for_reader, trimmed, e);
                    continue;
                }
            };
            let Some(id) = frame.get("id").and_then(|v| v.as_u64()) else {
                continue;
            };
            let tx = {
                let mut p = pending_reader.lock().await;
                p.remove(&id)
            };
            if let Some(tx) = tx {
                let result = if let Some(err) = frame.get("error") {
                    let msg = err
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("mcp error")
                        .to_string();
                    Err(msg)
                } else {
                    Ok(frame.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = tx.send(result);
            }
        }
        log::info!("[mcp:{}] stdout closed", cmd_for_reader);
    });

    let mut conn = Connection {
        child,
        stdin,
        pending,
        next_id: 0,
        tools: Vec::new(),
    };

    let init_params = serde_json::json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": { "tools": {} },
        "clientInfo": { "name": "ittoolkit", "version": env!("CARGO_PKG_VERSION") }
    });
    let init_raw = tokio::time::timeout(
        std::time::Duration::from_secs(SPAWN_INIT_TIMEOUT_SECS),
        request(&mut conn, "initialize", init_params),
    )
    .await
    .map_err(|_| "MCP server initialize timed out".to_string())??;
    let init: mcp_types::InitializeResult =
        serde_json::from_value(init_raw).map_err(|e| e.to_string())?;
    let _ = init;
    notify(&mut conn, "notifications/initialized", Value::Null).await?;

    let tools_raw = request(&mut conn, "tools/list", Value::Null).await?;
    let tools: mcp_types::ListToolsResult =
        serde_json::from_value(tools_raw).map_err(|e| e.to_string())?;
    conn.tools = tools.tools;

    Ok(conn)
}

#[command]
pub async fn mcp_clients_list() -> Result<McpClientsFile, String> {
    Ok(read_config())
}

#[command]
pub async fn mcp_clients_upsert(id: String, spec: McpServerSpec) -> Result<(), String> {
    let mut cfg = read_config();
    cfg.servers.insert(id, spec);
    write_config(&cfg)
}

#[command]
pub async fn mcp_clients_remove(id: String) -> Result<(), String> {
    let mut cfg = read_config();
    cfg.servers.remove(&id);
    write_config(&cfg)
}

#[command]
pub async fn mcp_client_tools(
    id: String,
    state: State<'_, McpClientState>,
) -> Result<Vec<McpTool>, String> {
    let cfg = read_config();
    let spec = cfg
        .servers
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no MCP server '{}' configured", id))?;
    let inner = Arc::clone(&state.inner);
    let mut guard = inner.lock().await;
    if !guard.connections.contains_key(&id) {
        let conn = spawn_server(&spec).await?;
        guard.connections.insert(id.clone(), conn);
    }
    let conn = guard.connections.get(&id).unwrap();
    Ok(conn.tools.clone())
}

#[command]
pub async fn mcp_client_call(
    id: String,
    tool: String,
    arguments: Value,
    state: State<'_, McpClientState>,
) -> Result<Value, String> {
    let cfg = read_config();
    let spec = cfg
        .servers
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no MCP server '{}' configured", id))?;
    let inner = Arc::clone(&state.inner);
    let mut guard = inner.lock().await;
    if !guard.connections.contains_key(&id) {
        let conn = spawn_server(&spec).await?;
        guard.connections.insert(id.clone(), conn);
    }
    let conn = guard.connections.get_mut(&id).unwrap();
    let params = mcp_types::CallToolParams { name: tool, arguments };
    let result = request(
        conn,
        "tools/call",
        serde_json::to_value(params).map_err(|e| e.to_string())?,
    )
    .await?;
    Ok(result)
}

#[command]
pub async fn mcp_client_shutdown(
    id: Option<String>,
    state: State<'_, McpClientState>,
) -> Result<(), String> {
    let inner = Arc::clone(&state.inner);
    let mut guard = inner.lock().await;
    let ids: Vec<String> = match id {
        Some(only) => vec![only],
        None => guard.connections.keys().cloned().collect(),
    };
    for id in ids {
        if let Some(mut conn) = guard.connections.remove(&id) {
            let _ = conn.child.kill().await;
        }
    }
    Ok(())
}
