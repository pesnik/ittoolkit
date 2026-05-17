// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // When invoked as `ittoolkit --mcp-server` (typically by Claude Desktop /
  // Open Interpreter / Cursor via their MCP client config), bypass Tauri's
  // GUI boot and run a stdio JSON-RPC server instead. The server exposes
  // ittoolkit's tool catalog + audit/workflow/skill resources so external
  // agents can plan against them; write actions still require the GUI
  // user's approval inside the ittoolkit app.
  if std::env::args().any(|a| a == "--mcp-server") {
    app_lib::mcp_server::run_stdio();
    return;
  }
  app_lib::run();
}
