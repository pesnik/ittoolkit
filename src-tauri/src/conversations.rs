use chrono::Utc;
use log::warn;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

const CONVERSATIONS_SUBDIR: &str = ".ittoolkit/conversations";
const MAX_TITLE_CHARS: usize = 60;
const MAX_SLUG_CHARS: usize = 40;

fn conversations_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let dir = home.join(CONVERSATIONS_SUBDIR);
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create conversations dir: {}", e))?;
    }
    Ok(dir)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConversationFrontmatter {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    pub created: String,
    pub updated: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub mode: Option<String>,
    pub created: String,
    pub updated: String,
    pub file_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoredToolExecution {
    pub tool_name: String,
    pub arguments: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_executions: Vec<StoredToolExecution>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub mode: Option<String>,
    pub created: String,
    pub updated: String,
    pub file_path: String,
    pub messages: Vec<StoredMessage>,
}

fn slugify_title(title: &str) -> String {
    let s = slug::slugify(title);
    if s.len() > MAX_SLUG_CHARS {
        s[..MAX_SLUG_CHARS].trim_end_matches('-').to_string()
    } else if s.is_empty() {
        "chat".to_string()
    } else {
        s
    }
}

fn title_from_first_message(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return "New chat".to_string();
    }
    let first_line = trimmed.lines().next().unwrap_or(trimmed);
    if first_line.chars().count() <= MAX_TITLE_CHARS {
        return first_line.to_string();
    }
    let mut out = String::new();
    let mut last_space = 0usize;
    for (i, ch) in first_line.char_indices() {
        if i > MAX_TITLE_CHARS {
            let cut = if last_space > 0 { last_space } else { i };
            out = first_line[..cut].trim_end().to_string();
            break;
        }
        if ch.is_whitespace() {
            last_space = i;
        }
    }
    if out.is_empty() {
        first_line.chars().take(MAX_TITLE_CHARS).collect()
    } else {
        out + "…"
    }
}

fn format_role_header(role: &str, timestamp: i64) -> String {
    let dt = chrono::DateTime::<Utc>::from_timestamp_millis(timestamp).unwrap_or_else(Utc::now);
    format!("## {} ({})", role, dt.format("%H:%M:%S"))
}

fn serialize_message(msg: &StoredMessage) -> String {
    let header = format_role_header(&msg.role, msg.timestamp);
    let mut out = format!("{}\n\n{}\n", header, msg.content.trim_end());
    for exec in &msg.tool_executions {
        let call_json = serde_json::json!({
            "name": exec.tool_name,
            "arguments": exec.arguments,
            "status": exec.status,
        });
        out.push_str("\n```tool_call\n");
        out.push_str(&serde_json::to_string_pretty(&call_json).unwrap_or_default());
        out.push_str("\n```\n");
        if let Some(result) = &exec.result {
            out.push_str("\n```tool_result\n");
            out.push_str(result);
            if !result.ends_with('\n') {
                out.push('\n');
            }
            out.push_str("```\n");
        } else if let Some(err) = &exec.error {
            out.push_str("\n```tool_error\n");
            out.push_str(err);
            if !err.ends_with('\n') {
                out.push('\n');
            }
            out.push_str("```\n");
        }
    }
    out.push('\n');
    out
}

fn serialize_conversation(conv: &Conversation) -> Result<String, String> {
    let fm = ConversationFrontmatter {
        id: conv.id.clone(),
        title: conv.title.clone(),
        model: conv.model.clone(),
        provider: conv.provider.clone(),
        mode: conv.mode.clone(),
        created: conv.created.clone(),
        updated: conv.updated.clone(),
    };
    let yaml = serde_yaml::to_string(&fm)
        .map_err(|e| format!("Failed to serialize frontmatter: {}", e))?;
    let mut out = String::with_capacity(yaml.len() + 64);
    out.push_str("---\n");
    out.push_str(&yaml);
    if !yaml.ends_with('\n') {
        out.push('\n');
    }
    out.push_str("---\n\n");
    for msg in &conv.messages {
        out.push_str(&serialize_message(msg));
    }
    Ok(out)
}

fn split_frontmatter(content: &str) -> Result<(ConversationFrontmatter, &str), String> {
    let stripped = content.strip_prefix("---\n").ok_or("Missing frontmatter")?;
    let end_marker = stripped
        .find("\n---\n")
        .or_else(|| stripped.find("\n---"))
        .ok_or("Frontmatter not terminated")?;
    let yaml_str = &stripped[..end_marker];
    let after = &stripped[end_marker..];
    let body = after.trim_start_matches('\n').trim_start_matches("---").trim_start_matches('\n');
    let fm: ConversationFrontmatter = serde_yaml::from_str(yaml_str)
        .map_err(|e| format!("Frontmatter parse error: {}", e))?;
    Ok((fm, body))
}

fn parse_role_header(line: &str) -> Option<(String, i64)> {
    let rest = line.strip_prefix("## ")?;
    let paren_start = rest.rfind(" (")?;
    let paren_end = rest.rfind(')')?;
    if paren_end <= paren_start {
        return None;
    }
    let role = rest[..paren_start].trim().to_string();
    let time_str = &rest[paren_start + 2..paren_end];
    let today = Utc::now().date_naive();
    let parsed = chrono::NaiveTime::parse_from_str(time_str, "%H:%M:%S").ok()?;
    let dt = today.and_time(parsed).and_utc();
    Some((role, dt.timestamp_millis()))
}

fn parse_messages(body: &str) -> Vec<StoredMessage> {
    let mut messages = Vec::new();
    let lines: Vec<&str> = body.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        if let Some((role, ts)) = parse_role_header(lines[i]) {
            let start = i + 1;
            let mut end = lines.len();
            for (j, line) in lines.iter().enumerate().skip(start) {
                if parse_role_header(line).is_some() {
                    end = j;
                    break;
                }
            }
            let raw = lines[start..end].join("\n");
            let (content, execs) = extract_tool_blocks(&raw);
            messages.push(StoredMessage {
                id: format!("msg-{}-{}", messages.len(), ts),
                role,
                content: content.trim().to_string(),
                timestamp: ts,
                tool_executions: execs,
            });
            i = end;
        } else {
            i += 1;
        }
    }
    messages
}

fn extract_tool_blocks(text: &str) -> (String, Vec<StoredToolExecution>) {
    let mut execs: Vec<StoredToolExecution> = Vec::new();
    let mut remaining = String::new();
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;
    let mut pending_call: Option<(String, serde_json::Value, String)> = None;
    while i < lines.len() {
        let line = lines[i];
        if line.trim_start() == "```tool_call" {
            if let Some(close) = find_fence_close(&lines, i + 1) {
                let payload = lines[i + 1..close].join("\n");
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload) {
                    let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let args = v.get("arguments").cloned().unwrap_or(serde_json::Value::Null);
                    let status = v.get("status").and_then(|x| x.as_str()).unwrap_or("success").to_string();
                    pending_call = Some((name, args, status));
                }
                i = close + 1;
                continue;
            }
        }
        if line.trim_start() == "```tool_result" {
            if let Some(close) = find_fence_close(&lines, i + 1) {
                let payload = lines[i + 1..close].join("\n");
                if let Some((name, args, status)) = pending_call.take() {
                    execs.push(StoredToolExecution {
                        tool_name: name,
                        arguments: args,
                        result: Some(payload),
                        error: None,
                        status,
                    });
                }
                i = close + 1;
                continue;
            }
        }
        if line.trim_start() == "```tool_error" {
            if let Some(close) = find_fence_close(&lines, i + 1) {
                let payload = lines[i + 1..close].join("\n");
                if let Some((name, args, _status)) = pending_call.take() {
                    execs.push(StoredToolExecution {
                        tool_name: name,
                        arguments: args,
                        result: None,
                        error: Some(payload),
                        status: "error".to_string(),
                    });
                }
                i = close + 1;
                continue;
            }
        }
        remaining.push_str(line);
        remaining.push('\n');
        i += 1;
    }
    if let Some((name, args, status)) = pending_call {
        execs.push(StoredToolExecution {
            tool_name: name,
            arguments: args,
            result: None,
            error: None,
            status,
        });
    }
    (remaining, execs)
}

fn find_fence_close(lines: &[&str], from: usize) -> Option<usize> {
    for (idx, line) in lines.iter().enumerate().skip(from) {
        if line.trim_start() == "```" {
            return Some(idx);
        }
    }
    None
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, content).map_err(|e| format!("Failed to write tmp file: {}", e))?;
    fs::rename(&tmp, path).map_err(|e| format!("Failed to rename tmp file: {}", e))?;
    Ok(())
}

fn find_conversation_path(id: &str) -> Result<PathBuf, String> {
    let dir = conversations_dir()?;
    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read dir: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
            if name.ends_with(&format!("-{}", id)) || name == id {
                return Ok(path);
            }
        }
        // Fallback: check frontmatter
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok((fm, _)) = split_frontmatter(&content) {
                if fm.id == id {
                    return Ok(path);
                }
            }
        }
    }
    Err(format!("Conversation not found: {}", id))
}

fn load_conversation_from_path(path: &Path) -> Result<Conversation, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("Read failed: {}", e))?;
    let (fm, body) = split_frontmatter(&content)?;
    let messages = parse_messages(body);
    Ok(Conversation {
        id: fm.id,
        title: fm.title,
        model: fm.model,
        provider: fm.provider,
        mode: fm.mode,
        created: fm.created,
        updated: fm.updated,
        file_path: path.to_string_lossy().to_string(),
        messages,
    })
}

#[command]
pub fn list_conversations() -> Result<Vec<ConversationSummary>, String> {
    let dir = conversations_dir()?;
    let mut summaries = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read dir: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                warn!("Skipping unreadable conversation {:?}: {}", path, e);
                continue;
            }
        };
        match split_frontmatter(&content) {
            Ok((fm, _)) => summaries.push(ConversationSummary {
                id: fm.id,
                title: fm.title,
                model: fm.model,
                provider: fm.provider,
                mode: fm.mode,
                created: fm.created,
                updated: fm.updated,
                file_path: path.to_string_lossy().to_string(),
            }),
            Err(e) => warn!("Skipping malformed conversation {:?}: {}", path, e),
        }
    }
    summaries.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(summaries)
}

#[command]
pub fn load_conversation(id: String) -> Result<Conversation, String> {
    let path = find_conversation_path(&id)?;
    load_conversation_from_path(&path)
}

#[command]
pub fn create_conversation(
    first_message: StoredMessage,
    model: Option<String>,
    provider: Option<String>,
    mode: Option<String>,
) -> Result<Conversation, String> {
    let dir = conversations_dir()?;
    let id_full = uuid::Uuid::new_v4().to_string();
    let short_id: String = id_full.chars().take(6).collect();
    let title = title_from_first_message(&first_message.content);
    let slug = slugify_title(&title);
    let now = Utc::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let iso = now.to_rfc3339();
    let file_name = format!("{}-{}-{}.md", date_str, slug, short_id);
    let path = dir.join(&file_name);

    let conv = Conversation {
        id: id_full,
        title,
        model,
        provider,
        mode,
        created: iso.clone(),
        updated: iso,
        file_path: path.to_string_lossy().to_string(),
        messages: vec![first_message],
    };

    let content = serialize_conversation(&conv)?;
    atomic_write(&path, &content)?;
    Ok(conv)
}

#[command]
pub fn append_message(id: String, message: StoredMessage) -> Result<(), String> {
    let path = find_conversation_path(&id)?;
    let mut conv = load_conversation_from_path(&path)?;
    conv.messages.push(message);
    conv.updated = Utc::now().to_rfc3339();
    let content = serialize_conversation(&conv)?;
    atomic_write(&path, &content)
}

#[command]
pub fn update_conversation_title(id: String, title: String) -> Result<(), String> {
    let path = find_conversation_path(&id)?;
    let mut conv = load_conversation_from_path(&path)?;
    conv.title = title;
    conv.updated = Utc::now().to_rfc3339();
    let content = serialize_conversation(&conv)?;
    atomic_write(&path, &content)
}

#[command]
pub fn delete_conversation(id: String) -> Result<(), String> {
    let path = find_conversation_path(&id)?;
    fs::remove_file(&path).map_err(|e| format!("Failed to delete: {}", e))
}
