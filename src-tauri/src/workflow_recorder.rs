// Workflow recorder — captures browser_rpc calls into a replayable file.
//
// Phase-1 RPA capability seam. browser_commands::browser_rpc consults the
// global recorder before forwarding to the sidecar; if recording is active,
// the call is appended. Workflows save to ~/.ittoolkit/workflows/.
//
// No use cases are shipped — this is the engine plus an empty UI shell.
// Future runbooks (Okta unlock, M365 password reset) stamp out from
// user-recorded sessions without changes here.
//
// Trust model in M4: replays from chat re-use the existing
// onConfirmExecution flow per step. Replays from the UI auto-approve all
// steps but surface a yellow warning. A proper admin-signed workflow flow
// arrives with M5+.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::command;
use tokio::fs;
use tokio::sync::Mutex;

const WORKFLOWS_DIR: &str = ".ittoolkit/workflows";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStep {
    /// JSON-RPC method, e.g. "browser.observe".
    pub tool: String,
    /// Params sent to the sidecar at record time. Replay binds
    /// `{{ name }}` substrings in string-typed values to caller-provided
    /// parameters.
    pub params: Value,
    /// "read" | "write" | "destructive" from browser_classify at record time.
    pub classification: String,
    /// Page URL observed when the step executed (best-effort).
    pub observed_url: Option<String>,
    pub observed_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowFile {
    pub name: String,
    /// Slug used as the filename (kebab-case of name).
    pub slug: String,
    pub version: u32,
    pub created_at: String,
    /// Model that ran the original session — purely informational.
    pub model_used: Option<String>,
    /// Declared parameters: `[{ name, type, required }]`. Phase 1 keeps
    /// this loose — schema enforcement is M5+.
    pub parameters: Vec<WorkflowParameter>,
    pub steps: Vec<WorkflowStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowParameter {
    pub name: String,
    pub r#type: String, // "string" | "number" | "boolean"
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub name: String,
    pub slug: String,
    pub created_at: String,
    pub step_count: usize,
    pub path: String,
}

struct ActiveRecording {
    name: String,
    started_at: String,
    model_used: Option<String>,
    steps: Vec<WorkflowStep>,
}

#[derive(Default)]
pub struct WorkflowRecorder {
    active: Arc<Mutex<Option<ActiveRecording>>>,
}

impl WorkflowRecorder {
    pub async fn append(&self, step: WorkflowStep) {
        let mut guard = self.active.lock().await;
        if let Some(rec) = guard.as_mut() {
            rec.steps.push(step);
        }
    }
}

fn slugify(input: &str) -> String {
    let lower = input.trim().to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut prev_dash = false;
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("workflow");
    }
    out
}

fn workflows_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    Ok(home.join(WORKFLOWS_DIR))
}

#[command]
pub async fn workflow_recording_start(
    name: String,
    model_used: Option<String>,
    recorder: tauri::State<'_, WorkflowRecorder>,
) -> Result<bool, String> {
    let mut guard = recorder.active.lock().await;
    if guard.is_some() {
        return Err("a recording is already in progress — stop it first".to_string());
    }
    *guard = Some(ActiveRecording {
        name,
        started_at: Utc::now().to_rfc3339(),
        model_used,
        steps: Vec::new(),
    });
    Ok(true)
}

#[command]
pub async fn workflow_recording_stop(
    recorder: tauri::State<'_, WorkflowRecorder>,
) -> Result<Option<WorkflowFile>, String> {
    let active = {
        let mut guard = recorder.active.lock().await;
        guard.take()
    };
    let Some(active) = active else {
        return Ok(None);
    };

    let slug = slugify(&active.name);
    let file = WorkflowFile {
        name: active.name,
        slug: slug.clone(),
        version: 1,
        created_at: active.started_at,
        model_used: active.model_used,
        parameters: Vec::new(),
        steps: active.steps,
    };

    let dir = workflows_dir()?;
    fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let mut path = dir.join(format!("{}.workflow.json", slug));
    // Avoid clobbering an existing workflow by adding a suffix.
    let mut suffix = 2u32;
    while path.exists() {
        path = dir.join(format!("{}-{}.workflow.json", slug, suffix));
        suffix += 1;
        if suffix > 99 {
            return Err("too many workflows with the same slug".to_string());
        }
    }
    let serialized = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(&path, serialized).await.map_err(|e| e.to_string())?;
    Ok(Some(file))
}

#[command]
pub async fn workflow_recording_status(
    recorder: tauri::State<'_, WorkflowRecorder>,
) -> Result<Option<RecordingStatus>, String> {
    let guard = recorder.active.lock().await;
    Ok(guard.as_ref().map(|r| RecordingStatus {
        name: r.name.clone(),
        started_at: r.started_at.clone(),
        step_count: r.steps.len(),
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub name: String,
    pub started_at: String,
    pub step_count: usize,
}

#[command]
pub async fn workflow_list() -> Result<Vec<WorkflowSummary>, String> {
    let dir = workflows_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let mut read_dir = fs::read_dir(&dir).await.map_err(|e| e.to_string())?;
    while let Some(entry) = read_dir.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let body = fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
        let Ok(file) = serde_json::from_str::<WorkflowFile>(&body) else {
            continue;
        };
        out.push(WorkflowSummary {
            name: file.name,
            slug: file.slug,
            created_at: file.created_at,
            step_count: file.steps.len(),
            path: path.to_string_lossy().to_string(),
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[command]
pub async fn workflow_load(slug: String) -> Result<WorkflowFile, String> {
    let dir = workflows_dir()?;
    let path = dir.join(format!("{}.workflow.json", slug));
    if !path.exists() {
        return Err(format!("workflow not found: {}", slug));
    }
    let body = fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

#[command]
pub async fn workflow_delete(slug: String) -> Result<bool, String> {
    let dir = workflows_dir()?;
    let path = dir.join(format!("{}.workflow.json", slug));
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(&path).await.map_err(|e| e.to_string())?;
    Ok(true)
}

/// Replay engine. Streams ReplayEvents via Tauri event `workflow-replay-event`.
/// Per-step approval enforcement is the UI's job — this engine just runs
/// the steps and re-classifies each. The UI surfaces approval prompts for
/// write/destructive steps before allowing the next invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayEvent {
    pub step_index: usize,
    pub status: String, // "started" | "done" | "error" | "needs_approval"
    pub method: Option<String>,
    pub classification: Option<String>,
    pub error: Option<String>,
}

fn bind_params(value: &Value, params: &serde_json::Map<String, Value>) -> Value {
    match value {
        Value::String(s) => {
            // Replace `{{ name }}` (with optional whitespace) with the
            // corresponding parameter's string form. Leaves unknown names
            // alone so the step's natural failure mode (e.g. blank input)
            // surfaces to the user instead of a silent miss.
            let mut out = s.clone();
            for (k, v) in params {
                let needle_a = format!("{{{{ {} }}}}", k);
                let needle_b = format!("{{{{{}}}}}", k);
                let replacement = match v {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                out = out.replace(&needle_a, &replacement);
                out = out.replace(&needle_b, &replacement);
            }
            Value::String(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(|i| bind_params(i, params)).collect()),
        Value::Object(obj) => {
            let mut new = serde_json::Map::with_capacity(obj.len());
            for (k, v) in obj {
                new.insert(k.clone(), bind_params(v, params));
            }
            Value::Object(new)
        }
        other => other.clone(),
    }
}

#[command]
pub async fn workflow_replay_bind(
    slug: String,
    parameters: serde_json::Map<String, Value>,
) -> Result<Vec<WorkflowStep>, String> {
    // Loads the workflow and returns the parameter-bound step list so the
    // UI / chat can iterate and dispatch through browser_rpc with the
    // same approval flow shell commands already use. Keeping replay
    // single-stepped in the caller (rather than a fire-and-forget Rust
    // task) lets us reuse the existing risk-tier UI plumbing.
    let dir = workflows_dir()?;
    let path = dir.join(format!("{}.workflow.json", slug));
    if !path.exists() {
        return Err(format!("workflow not found: {}", slug));
    }
    let body = fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    let file: WorkflowFile = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    Ok(file
        .steps
        .into_iter()
        .map(|step| WorkflowStep {
            tool: step.tool,
            params: bind_params(&step.params, &parameters),
            classification: step.classification,
            observed_url: step.observed_url,
            observed_title: step.observed_title,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn slugify_handles_specials() {
        assert_eq!(slugify("Okta unlock user"), "okta-unlock-user");
        assert_eq!(slugify("  Foo!! Bar  "), "foo-bar");
        assert_eq!(slugify(""), "workflow");
    }

    #[test]
    fn bind_params_replaces_double_brace() {
        let template = json!({ "url": "https://x.com/{{ user }}/profile", "n": 3 });
        let mut params = serde_json::Map::new();
        params.insert("user".to_string(), Value::String("ada".to_string()));
        let bound = bind_params(&template, &params);
        assert_eq!(bound["url"], "https://x.com/ada/profile");
        assert_eq!(bound["n"], 3);
    }

    #[test]
    fn bind_params_tolerates_no_whitespace() {
        let template = json!("{{name}}-suffix");
        let mut params = serde_json::Map::new();
        params.insert("name".to_string(), Value::String("ittk".to_string()));
        assert_eq!(bind_params(&template, &params), Value::String("ittk-suffix".to_string()));
    }
}
