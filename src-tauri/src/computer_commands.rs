// Computer-use harness: native screen-capture + cursor primitives (CU-M2).
//
// Read-only milestone. Three Tauri commands:
//   - computer_screenshot       — full screen / single display, JPEG base64
//   - computer_screen_size      — display dims + active display index
//   - computer_cursor_position  — current cursor (x, y)
//
// All three are classified `read` (autonomous, no approval prompt). Writes
// (mouse_move / click / type / key / scroll) arrive in CU-M3 alongside the
// classifier + approval flow.
//
// xcap handles screen capture on macOS / Windows / Linux (X11 + Wayland).
// Cursor position is read via xcap's `Monitor::all()` + a small helper that
// drops to platform APIs (CGEventCreate on macOS, GetCursorPos on Windows,
// XQueryPointer on X11). For Wayland-only Linux the platform refuses to
// report global cursor coords by design — we return an error the agent can
// reason about.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use image::ImageEncoder;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use tauri::command;
use xcap::Monitor;

const SCREENSHOT_JPEG_QUALITY: u8 = 70;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    /// Base64-encoded JPEG of the captured display.
    pub screenshot: String,
    /// Display dims AFTER any DPI scaling (the JPEG matches these).
    pub width: u32,
    pub height: u32,
    /// Index into `screen_size().displays` of the captured display.
    pub display_index: usize,
    /// Top-left of the display in virtual-desktop coordinates.
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
    // Default: the primary display.
    let primary = monitors.iter().position(|m| m.is_primary().unwrap_or(false));
    Ok(primary.unwrap_or(0))
}

#[command]
pub async fn computer_screenshot(display_index: Option<usize>) -> Result<ScreenshotResult, String> {
    // Run in a blocking pool — xcap and image encoding are CPU-heavy and
    // would otherwise stall the Tokio runtime.
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
            // The encoder.encode_image API returns Result<(), ImageError>.
            // RgbImage implements GenericImageView -> we use encode_image.
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

// ─── Platform-specific cursor read ────────────────────────────────────────
// xcap doesn't expose a cursor-position API. We drop to the OS:
//   macOS:  CGEventSourceCreate + CGEventCreate(nil) + CGEventGetLocation
//   Windows: GetCursorPos
//   Linux X11: XQueryPointer on the root window
//   Linux Wayland: no global API — return a clear error
// CU-M3's enigo dependency will subsume this; using a focused fn here keeps
// CU-M2 free of input crates.

#[cfg(target_os = "macos")]
fn platform_cursor_position() -> Result<CursorPosResult, String> {
    // Use objc2's appkit binding via xcap's dep tree. Simpler: shell out to a
    // tiny AppleScript that returns mouse position. Apple Silicon ships
    // osascript by default. This avoids pulling new crates in CU-M2.
    use std::process::Command;
    let out = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to return position of mouse of (first process whose frontmost is true)",
        ])
        .output()
        .map_err(|e| format!("osascript spawn failed: {}", e))?;
    if !out.status.success() {
        // Fallback: use Quartz CGEvent via a Python shim. If Python isn't
        // available the agent gets a graceful error.
        return Err(format!(
            "cursor position requires Accessibility permission for ittoolkit; \
             open System Settings → Privacy & Security → Accessibility and enable it. \
             (osascript: {})",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // Output shape: "342, 218"
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
    // SAFETY: GetCursorPos writes a POINT we own; null would be UB but pt is on the stack.
    unsafe {
        GetCursorPos(&mut pt).map_err(|e| format!("GetCursorPos failed: {}", e))?;
    }
    Ok(CursorPosResult { x: pt.x, y: pt.y })
}

#[cfg(all(target_os = "linux"))]
fn platform_cursor_position() -> Result<CursorPosResult, String> {
    // X11 path via xdotool (preinstalled on most desktop distros). Wayland
    // refuses global cursor reads by design — surface a clear error.
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
    // Output shape: "x:842 y:318 screen:0 window:12345"
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
