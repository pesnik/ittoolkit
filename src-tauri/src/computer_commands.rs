use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use enigo::{
    Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings,
};
use image::ImageEncoder;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{command, AppHandle, Emitter, State};
use xcap::Monitor;

const SCREENSHOT_JPEG_QUALITY: u8 = 70;
const PRE_ACTION_PAUSE_MS: u64 = 250;
const ABORT_EVENT: &str = "computer-action-aborted";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    pub screenshot: String,
    pub width: u32,
    pub height: u32,
    pub display_index: usize,
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub index: usize,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub is_primary: bool,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenSizeResult {
    pub displays: Vec<DisplayInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPosResult {
    pub x: i32,
    pub y: i32,
}

fn list_monitors() -> Result<Vec<Monitor>, String> {
    Monitor::all().map_err(|e| format!("failed to enumerate monitors: {}", e))
}

fn pick_display(monitors: &[Monitor], requested: Option<usize>) -> Result<usize, String> {
    if monitors.is_empty() {
        return Err("no displays detected".to_string());
    }
    if let Some(idx) = requested {
        if idx >= monitors.len() {
            return Err(format!(
                "display_index {} out of range (have {} displays)",
                idx,
                monitors.len()
            ));
        }
        return Ok(idx);
    }
    let primary = monitors.iter().position(|m| m.is_primary().unwrap_or(false));
    Ok(primary.unwrap_or(0))
}

#[command]
pub async fn computer_screenshot(display_index: Option<usize>) -> Result<ScreenshotResult, String> {
    tokio::task::spawn_blocking(move || -> Result<ScreenshotResult, String> {
        let monitors = list_monitors()?;
        let idx = pick_display(&monitors, display_index)?;
        let monitor = &monitors[idx];
        let img = monitor
            .capture_image()
            .map_err(|e| format!("capture_image failed: {}", e))?;

        let width = img.width();
        let height = img.height();
        let rgb: image::RgbImage = image::DynamicImage::ImageRgba8(img).to_rgb8();

        let mut buf = Vec::with_capacity((width * height) as usize);
        {
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                Cursor::new(&mut buf),
                SCREENSHOT_JPEG_QUALITY,
            );
            encoder
                .write_image(rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8)
                .map_err(|e| format!("jpeg encode failed: {}", e))?;
        }

        let x = monitor.x().map_err(|e| e.to_string())?;
        let y = monitor.y().map_err(|e| e.to_string())?;

        Ok(ScreenshotResult {
            screenshot: BASE64.encode(&buf),
            width,
            height,
            display_index: idx,
            x,
            y,
        })
    })
    .await
    .map_err(|e| format!("screenshot task panic: {}", e))?
}

#[command]
pub async fn computer_screen_size() -> Result<ScreenSizeResult, String> {
    tokio::task::spawn_blocking(|| -> Result<ScreenSizeResult, String> {
        let monitors = list_monitors()?;
        let mut displays = Vec::with_capacity(monitors.len());
        for (i, m) in monitors.iter().enumerate() {
            displays.push(DisplayInfo {
                index: i,
                x: m.x().map_err(|e| e.to_string())?,
                y: m.y().map_err(|e| e.to_string())?,
                width: m.width().map_err(|e| e.to_string())?,
                height: m.height().map_err(|e| e.to_string())?,
                scale_factor: m.scale_factor().unwrap_or(1.0),
                is_primary: m.is_primary().unwrap_or(false),
                name: m.name().unwrap_or_else(|_| format!("display-{}", i)),
            });
        }
        Ok(ScreenSizeResult { displays })
    })
    .await
    .map_err(|e| format!("screen_size task panic: {}", e))?
}

#[command]
pub async fn computer_cursor_position() -> Result<CursorPosResult, String> {
    tokio::task::spawn_blocking(|| -> Result<CursorPosResult, String> {
        platform_cursor_position()
    })
    .await
    .map_err(|e| format!("cursor_position task panic: {}", e))?
}

#[cfg(target_os = "macos")]
fn platform_cursor_position() -> Result<CursorPosResult, String> {
    use std::process::Command;
    let out = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to return position of mouse of (first process whose frontmost is true)",
        ])
        .output()
        .map_err(|e| format!("osascript spawn failed: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "cursor position requires Accessibility permission for ittoolkit; \
             open System Settings \u{2192} Privacy & Security \u{2192} Accessibility and enable it. \
             (osascript: {})",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let parts: Vec<&str> = text.trim().split(',').collect();
    if parts.len() != 2 {
        return Err(format!("unparseable osascript output: {}", text.trim()));
    }
    let x: i32 = parts[0].trim().parse().map_err(|e| format!("parse x: {}", e))?;
    let y: i32 = parts[1].trim().parse().map_err(|e| format!("parse y: {}", e))?;
    Ok(CursorPosResult { x, y })
}

#[cfg(target_os = "windows")]
fn platform_cursor_position() -> Result<CursorPosResult, String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT { x: 0, y: 0 };
    unsafe {
        GetCursorPos(&mut pt).map_err(|e| format!("GetCursorPos failed: {}", e))?;
    }
    Ok(CursorPosResult { x: pt.x, y: pt.y })
}

#[cfg(all(target_os = "linux"))]
fn platform_cursor_position() -> Result<CursorPosResult, String> {
    if std::env::var("WAYLAND_DISPLAY").is_ok() && std::env::var("DISPLAY").is_err() {
        return Err(
            "Wayland does not expose global cursor coordinates; switch to X11 or use \
             a Wayland-native screenshot picker. (computer_cursor_position is read-only.)"
                .to_string(),
        );
    }
    let out = std::process::Command::new("xdotool")
        .arg("getmouselocation")
        .output()
        .map_err(|e| format!("xdotool not installed or not in PATH: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "xdotool getmouselocation failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut x: i32 = 0;
    let mut y: i32 = 0;
    for field in text.split_whitespace() {
        if let Some(v) = field.strip_prefix("x:") {
            x = v.parse().unwrap_or(0);
        } else if let Some(v) = field.strip_prefix("y:") {
            y = v.parse().unwrap_or(0);
        }
    }
    Ok(CursorPosResult { x, y })
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_cursor_position() -> Result<CursorPosResult, String> {
    Err("computer_cursor_position not supported on this platform".to_string())
}

#[derive(Default)]
pub struct ComputerState {
    pub abort: Arc<AtomicBool>,
}

async fn execute_write<F, R>(
    state: &State<'_, ComputerState>,
    app: &AppHandle,
    method: &str,
    f: F,
) -> Result<R, String>
where
    F: FnOnce(&mut Enigo) -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    if state.abort.load(Ordering::SeqCst) {
        state.abort.store(false, Ordering::SeqCst);
        let _ = app.emit(ABORT_EVENT, method.to_string());
        return Err(format!("{} aborted by kill switch before dispatch", method));
    }

    tokio::time::sleep(Duration::from_millis(PRE_ACTION_PAUSE_MS)).await;

    if state.abort.load(Ordering::SeqCst) {
        state.abort.store(false, Ordering::SeqCst);
        let _ = app.emit(ABORT_EVENT, method.to_string());
        return Err(format!("{} aborted by kill switch during pre-action pause", method));
    }

    tokio::task::spawn_blocking(move || {
        let mut enigo =
            Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {}", e))?;
        f(&mut enigo)
    })
    .await
    .map_err(|e| format!("computer write task panic: {}", e))?
}

fn parse_chord(spec: &str) -> Result<(Vec<Key>, Key), String> {
    let parts: Vec<&str> = spec.split('+').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return Err("empty key spec".to_string());
    }
    let mut mods: Vec<Key> = Vec::new();
    let final_part = parts[parts.len() - 1];
    for m in &parts[..parts.len() - 1] {
        mods.push(parse_modifier(m)?);
    }
    let final_key = parse_key(final_part)?;
    Ok((mods, final_key))
}

fn parse_modifier(name: &str) -> Result<Key, String> {
    match name.to_ascii_lowercase().as_str() {
        "ctrl" | "control" => Ok(Key::Control),
        "shift" => Ok(Key::Shift),
        "alt" | "option" => Ok(Key::Alt),
        "cmd" | "command" | "meta" | "super" | "win" => Ok(Key::Meta),
        other => Err(format!("unknown modifier: {}", other)),
    }
}

fn parse_key(name: &str) -> Result<Key, String> {
    let lower = name.to_ascii_lowercase();
    match lower.as_str() {
        "enter" | "return" => Ok(Key::Return),
        "tab" => Ok(Key::Tab),
        "escape" | "esc" => Ok(Key::Escape),
        "space" => Ok(Key::Space),
        "backspace" => Ok(Key::Backspace),
        "delete" | "del" => Ok(Key::Delete),
        "up" => Ok(Key::UpArrow),
        "down" => Ok(Key::DownArrow),
        "left" => Ok(Key::LeftArrow),
        "right" => Ok(Key::RightArrow),
        "home" => Ok(Key::Home),
        "end" => Ok(Key::End),
        "pageup" | "pgup" => Ok(Key::PageUp),
        "pagedown" | "pgdn" => Ok(Key::PageDown),
        s if s.chars().count() == 1 => Ok(Key::Unicode(s.chars().next().unwrap())),
        _ => Err(format!("unknown key: {}", name)),
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub status: String,
    pub method: String,
}

#[command]
pub async fn computer_mouse_move(
    app: AppHandle,
    state: State<'_, ComputerState>,
    x: i32,
    y: i32,
) -> Result<ActionResult, String> {
    execute_write(&state, &app, "computer_mouse_move", move |enigo| {
        enigo
            .move_mouse(x, y, Coordinate::Abs)
            .map_err(|e| format!("move_mouse: {}", e))
    })
    .await?;
    Ok(ActionResult { status: "ok".into(), method: "computer_mouse_move".into() })
}

async fn click_at(
    app: AppHandle,
    state: State<'_, ComputerState>,
    button: Button,
    x: Option<i32>,
    y: Option<i32>,
    method: &'static str,
) -> Result<ActionResult, String> {
    execute_write(&state, &app, method, move |enigo| {
        if let (Some(x), Some(y)) = (x, y) {
            enigo
                .move_mouse(x, y, Coordinate::Abs)
                .map_err(|e| format!("move_mouse: {}", e))?;
        }
        enigo
            .button(button, Direction::Click)
            .map_err(|e| format!("button click: {}", e))
    })
    .await?;
    Ok(ActionResult { status: "ok".into(), method: method.into() })
}

#[command]
pub async fn computer_left_click(
    app: AppHandle,
    state: State<'_, ComputerState>,
    x: Option<i32>,
    y: Option<i32>,
) -> Result<ActionResult, String> {
    click_at(app, state, Button::Left, x, y, "computer_left_click").await
}

#[command]
pub async fn computer_right_click(
    app: AppHandle,
    state: State<'_, ComputerState>,
    x: Option<i32>,
    y: Option<i32>,
) -> Result<ActionResult, String> {
    click_at(app, state, Button::Right, x, y, "computer_right_click").await
}

#[command]
pub async fn computer_middle_click(
    app: AppHandle,
    state: State<'_, ComputerState>,
    x: Option<i32>,
    y: Option<i32>,
) -> Result<ActionResult, String> {
    click_at(app, state, Button::Middle, x, y, "computer_middle_click").await
}

#[command]
pub async fn computer_double_click(
    app: AppHandle,
    state: State<'_, ComputerState>,
    x: Option<i32>,
    y: Option<i32>,
) -> Result<ActionResult, String> {
    execute_write(&state, &app, "computer_double_click", move |enigo| {
        if let (Some(x), Some(y)) = (x, y) {
            enigo
                .move_mouse(x, y, Coordinate::Abs)
                .map_err(|e| format!("move_mouse: {}", e))?;
        }
        enigo
            .button(Button::Left, Direction::Click)
            .map_err(|e| format!("click 1: {}", e))?;
        enigo
            .button(Button::Left, Direction::Click)
            .map_err(|e| format!("click 2: {}", e))
    })
    .await?;
    Ok(ActionResult { status: "ok".into(), method: "computer_double_click".into() })
}

#[command]
pub async fn computer_left_click_drag(
    app: AppHandle,
    state: State<'_, ComputerState>,
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
) -> Result<ActionResult, String> {
    execute_write(&state, &app, "computer_left_click_drag", move |enigo| {
        enigo
            .move_mouse(x1, y1, Coordinate::Abs)
            .map_err(|e| format!("move_mouse start: {}", e))?;
        enigo
            .button(Button::Left, Direction::Press)
            .map_err(|e| format!("press: {}", e))?;
        enigo
            .move_mouse(x2, y2, Coordinate::Abs)
            .map_err(|e| format!("move_mouse end: {}", e))?;
        enigo
            .button(Button::Left, Direction::Release)
            .map_err(|e| format!("release: {}", e))
    })
    .await?;
    Ok(ActionResult { status: "ok".into(), method: "computer_left_click_drag".into() })
}

#[command]
pub async fn computer_type(
    app: AppHandle,
    state: State<'_, ComputerState>,
    text: String,
) -> Result<ActionResult, String> {
    execute_write(&state, &app, "computer_type", move |enigo| {
        enigo
            .text(&text)
            .map_err(|e| format!("type: {}", e))
    })
    .await?;
    Ok(ActionResult { status: "ok".into(), method: "computer_type".into() })
}

#[command]
pub async fn computer_key(
    app: AppHandle,
    state: State<'_, ComputerState>,
    key: String,
) -> Result<ActionResult, String> {
    let (mods, final_key) = parse_chord(&key)?;
    execute_write(&state, &app, "computer_key", move |enigo| {
        for m in &mods {
            enigo
                .key(*m, Direction::Press)
                .map_err(|e| format!("modifier press: {}", e))?;
        }
        let click_res = enigo.key(final_key, Direction::Click);
        for m in mods.iter().rev() {
            let _ = enigo.key(*m, Direction::Release);
        }
        click_res.map_err(|e| format!("key click: {}", e))
    })
    .await?;
    Ok(ActionResult { status: "ok".into(), method: "computer_key".into() })
}

#[command]
pub async fn computer_scroll(
    app: AppHandle,
    state: State<'_, ComputerState>,
    direction: String,
    clicks: Option<i32>,
) -> Result<ActionResult, String> {
    let amount = clicks.unwrap_or(3).abs();
    let (delta, axis) = match direction.to_ascii_lowercase().as_str() {
        "up" => (-amount, Axis::Vertical),
        "down" => (amount, Axis::Vertical),
        "left" => (-amount, Axis::Horizontal),
        "right" => (amount, Axis::Horizontal),
        other => return Err(format!("unknown scroll direction: {}", other)),
    };
    execute_write(&state, &app, "computer_scroll", move |enigo| {
        enigo
            .scroll(delta, axis)
            .map_err(|e| format!("scroll: {}", e))
    })
    .await?;
    Ok(ActionResult { status: "ok".into(), method: "computer_scroll".into() })
}

#[command]
pub async fn computer_kill(state: State<'_, ComputerState>) -> Result<(), String> {
    state.abort.store(true, Ordering::SeqCst);
    Ok(())
}
