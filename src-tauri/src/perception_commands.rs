// Perception supervisor — manages the Python OmniParser sidecar (CU-M4).
//
// Architecture mirrors `browser_commands.rs` from the parallel browser-use
// branch: lazy spawn on first request, JSON-RPC over stdio, oneshot router
// for in-flight responses, stderr drained into the Rust log.
//
// The sidecar is best-effort: if Python is missing or the sidecar exits,
// the supervisor surfaces an error the agent renders as
// "perception unavailable" — the calling code (`computer_find`) falls back
// to UI-TARS-only grounding and the action still works, just with less
// candidate pre-filtering.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{command, AppHandle, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

const SIDECAR_DIR_REL: &str = "sidecar/perception";
const RPC_TIMEOUT_SECS: u64 = 60;

type PendingMap = HashMap<u64, oneshot::Sender<Result<Value, String>>>;

#[derive(Default)]
struct SupervisorInner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    pending: PendingMap,
    next_id: u64,
    /// True once `ensure_spawned` has tried and we know whether the sidecar
    /// is reachable. Subsequent calls short-circuit when it isn't.
    spawn_attempted: bool,
    spawn_failed: Option<String>,
}

#[derive(Default)]
pub struct PerceptionSupervisor {
    inner: Arc<Mutex<SupervisorInner>>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PerceptionRpcRequest {
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

fn sidecar_dir() -> Result<PathBuf> {
    let cwd = std::env::current_dir()?;
    let dir = cwd.join(SIDECAR_DIR_REL);
    if !dir.exists() {
        return Err(anyhow!(
            "perception sidecar dir not found at {} — bundled in CU-M4 scaffold",
            dir.display()
        ));
    }
    Ok(dir)
}

fn build_command(dir: &PathBuf) -> Result<Command> {
    // Try `python3` first, then `python`. The sidecar source lives under
    // src/perception so we set PYTHONPATH explicitly to avoid forcing the
    // user to `pip install -e .` for the stub path.
    let python = which_python().ok_or_else(|| {
        anyhow!(
            "python3 / python not found in PATH — perception sidecar unavailable. \
             The agent can still ground via UI-TARS directly; this only affects the \
             OmniParser candidate-pre-filter step."
        )
    })?;
    let mut cmd = Command::new(python);
    cmd.args(["-u", "-m", "perception"]);
    cmd.current_dir(dir);
    let mut path = std::env::var_os("PYTHONPATH").unwrap_or_default();
    if !path.is_empty() {
        path.push(":");
    }
    path.push(dir.join("src"));
    cmd.env("PYTHONPATH", path);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    Ok(cmd)
}

fn which_python() -> Option<String> {
    for candidate in ["python3", "python"] {
        if std::process::Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Some(candidate.to_string());
        }
    }
    None
}

async fn ensure_spawned(
    inner: Arc<Mutex<SupervisorInner>>,
    _app: &AppHandle,
) -> Result<(), String> {
    {
        let guard = inner.lock().await;
        if guard.child.is_some() && guard.stdin.is_some() {
            return Ok(());
        }
        if guard.spawn_attempted {
            if let Some(err) = &guard.spawn_failed {
                return Err(err.clone());
            }
        }
    }

    let dir = sidecar_dir().map_err(|e| e.to_string())?;
    let mut cmd = match build_command(&dir) {
        Ok(c) => c,
        Err(e) => {
            let mut guard = inner.lock().await;
            guard.spawn_attempted = true;
            guard.spawn_failed = Some(e.to_string());
            return Err(e.to_string());
        }
    };

    log::info!("spawning perception sidecar from {}", dir.display());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("failed to spawn perception sidecar: {}", e);
            let mut guard = inner.lock().await;
            guard.spawn_attempted = true;
            guard.spawn_failed = Some(msg.clone());
            return Err(msg);
        }
    };

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "sidecar stdin missing".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar stdout missing".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "sidecar stderr missing".to_string())?;

    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            log::info!("[perception-sidecar] {}", line);
        }
    });

    let inner_for_reader = Arc::clone(&inner);
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
                    log::warn!("perception sidecar emitted unparseable line: {} ({})", trimmed, e);
                    continue;
                }
            };
            let Some(id) = frame.get("id").and_then(|v| v.as_u64()) else {
                // No id — must be a sidecar-initiated notification. Ignore
                // for now; we don't have any notification surface yet.
                continue;
            };
            let pending_sender = {
                let mut guard = inner_for_reader.lock().await;
                guard.pending.remove(&id)
            };
            if let Some(tx) = pending_sender {
                let result = if let Some(err) = frame.get("error") {
                    let msg = err
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("perception sidecar error")
                        .to_string();
                    Err(msg)
                } else {
                    Ok(frame.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = tx.send(result);
            } else {
                log::warn!("perception sidecar response for unknown id {}: {}", id, trimmed);
            }
        }
        log::info!("perception sidecar stdout closed");
    });

    {
        let mut guard = inner.lock().await;
        guard.child = Some(child);
        guard.stdin = Some(stdin);
        guard.spawn_attempted = true;
        guard.spawn_failed = None;
    }
    Ok(())
}

async fn next_id(inner: &Arc<Mutex<SupervisorInner>>) -> u64 {
    let mut guard = inner.lock().await;
    guard.next_id = guard.next_id.wrapping_add(1);
    if guard.next_id == 0 {
        guard.next_id = 1;
    }
    guard.next_id
}

async fn send_rpc(
    inner: Arc<Mutex<SupervisorInner>>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let id = next_id(&inner).await;
    let (tx, rx) = oneshot::channel();
    {
        let mut guard = inner.lock().await;
        guard.pending.insert(id, tx);
    }
    let frame = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    let mut line = serde_json::to_string(&frame).map_err(|e| e.to_string())?;
    line.push('\n');
    {
        let mut guard = inner.lock().await;
        let stdin = guard
            .stdin
            .as_mut()
            .ok_or_else(|| "perception sidecar stdin closed".to_string())?;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("failed to write to perception sidecar: {}", e))?;
        stdin.flush().await.map_err(|e| e.to_string())?;
    }
    match tokio::time::timeout(std::time::Duration::from_secs(RPC_TIMEOUT_SECS), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("perception sidecar dropped response channel".to_string()),
        Err(_) => {
            let mut guard = inner.lock().await;
            guard.pending.remove(&id);
            Err(format!("perception sidecar timeout after {}s", RPC_TIMEOUT_SECS))
        }
    }
}

#[command]
pub async fn perception_rpc(
    app: AppHandle,
    request: PerceptionRpcRequest,
    state: State<'_, PerceptionSupervisor>,
) -> Result<Value, String> {
    let inner = Arc::clone(&state.inner);
    ensure_spawned(Arc::clone(&inner), &app).await?;
    send_rpc(inner, request.method, request.params).await
}

#[command]
pub async fn perception_shutdown(state: State<'_, PerceptionSupervisor>) -> Result<(), String> {
    let inner = Arc::clone(&state.inner);
    let mut guard = inner.lock().await;
    if let Some(mut child) = guard.child.take() {
        let _ = guard.stdin.take();
        match tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await {
            Ok(_) => log::info!("perception sidecar exited cleanly"),
            Err(_) => {
                let _ = child.kill().await;
            }
        }
    }
    guard.pending.clear();
    Ok(())
}
