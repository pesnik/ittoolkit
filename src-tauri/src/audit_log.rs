// Append-only audit log for destructive agent actions.
//
// Every confirm_action card the agent emits, and every Execute / Dismiss
// decision the user makes, is recorded as one JSON line in
// ~/.ittoolkit/audit.jsonl. Append-only on purpose — the first time a file
// gets deleted in anger, this is the trail we'll be glad we kept.
//
// The log is local-only; nothing is sent anywhere. Size is bounded by
// rotating the file once it exceeds MAX_LOG_BYTES.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::command;

const AUDIT_SUBDIR: &str = ".ittoolkit";
const AUDIT_FILE: &str = "audit.jsonl";
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024; // 5 MiB; rotate to .1 once exceeded

fn audit_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let dir = home.join(AUDIT_SUBDIR);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create audit dir: {}", e))?;
    }
    Ok(dir.join(AUDIT_FILE))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActionEvent {
    /// "emit" | "confirm" | "dismiss"
    pub kind: String,
    pub action_id: String,
    pub severity: String,
    /// Plain-text title (already sanitized at the JS boundary).
    pub title: String,
    /// Items the action targeted. Capped at 200 entries on disk to keep lines bounded.
    pub paths: Vec<String>,
    /// Exact shell command the app would run (captured at emit time).
    pub suggested_command: String,
    pub suggested_working_dir: String,
    /// Set on `confirm` events: exit code of the executed command, or -1 if dispatch failed.
    pub exit_code: Option<i32>,
}

fn rotate_if_needed(path: &PathBuf) -> Result<(), String> {
    let metadata = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(()), // first write — nothing to rotate
    };
    if metadata.len() < MAX_LOG_BYTES {
        return Ok(());
    }
    let rotated = path.with_extension("jsonl.1");
    fs::rename(path, &rotated).map_err(|e| format!("Failed to rotate audit log: {}", e))?;
    Ok(())
}

#[command]
pub fn log_action_event(event: ActionEvent) -> Result<(), String> {
    let path = audit_path()?;
    rotate_if_needed(&path)?;

    let mut event = event;
    if event.paths.len() > 200 {
        event.paths.truncate(200);
    }

    let ts = Utc::now().to_rfc3339();
    let mut record = serde_json::to_value(&event)
        .map_err(|e| format!("Failed to serialize audit event: {}", e))?;
    if let Some(obj) = record.as_object_mut() {
        obj.insert("ts".to_string(), serde_json::Value::String(ts));
    }
    let line = serde_json::to_string(&record)
        .map_err(|e| format!("Failed to serialize audit record: {}", e))?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open audit log: {}", e))?;
    writeln!(file, "{}", line).map_err(|e| format!("Failed to write audit log: {}", e))?;
    Ok(())
}
