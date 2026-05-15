use tauri::command;

#[command]
pub fn get_user_name() -> Result<String, String> {
    if let Ok(name) = std::env::var("USER") {
        if !name.is_empty() {
            return Ok(name);
        }
    }
    if let Ok(name) = std::env::var("USERNAME") {
        if !name.is_empty() {
            return Ok(name);
        }
    }
    if let Some(home) = dirs::home_dir() {
        if let Some(seg) = home.file_name().and_then(|s| s.to_str()) {
            return Ok(seg.to_string());
        }
    }
    Err("Could not determine user name".to_string())
}
