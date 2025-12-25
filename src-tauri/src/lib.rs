mod scanner;
mod commands;
mod ai;
mod ai_commands;
mod cleaner;
mod mcp;
mod mcp_commands_native; // Native Rust MCP implementation (replaces subprocess)
mod system_tools;
mod partition;
mod partition_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .manage(ai_commands::InferenceState::default())
    .manage(mcp_commands_native::NativeMCPState::new()) // Use native MCP state
    .invoke_handler(tauri::generate_handler![
        commands::scan_dir,
        commands::refresh_scan,
        commands::clear_cache,
        commands::reveal_in_explorer,
        commands::open_file,
        commands::delete_item,
        commands::get_drives,
        commands::cancel_scan,
        ai_commands::get_ai_providers_status,
        ai_commands::get_provider_models,
        ai_commands::run_ai_inference,
        ai_commands::cancel_inference,
        ai_commands::check_provider_availability,
        ai_commands::download_model,
        commands::scan_junk,
        commands::scan_junk_with_options,
        commands::clean_junk,
        commands::clean_junk_with_options,
        mcp_commands_native::initialize_mcp,
        mcp_commands_native::get_mcp_tools,
        mcp_commands_native::execute_mcp_tool,
        mcp_commands_native::shutdown_mcp,
        mcp_commands_native::is_mcp_initialized,
        // System Tools
        system_tools::get_disk_info,
        system_tools::get_network_interfaces,
        system_tools::ping_host,
        system_tools::dns_lookup,
        system_tools::scan_ports,
        system_tools::get_system_info,
        system_tools::get_services,
        system_tools::service_action,
        system_tools::get_process_list,
        system_tools::kill_process,
        system_tools::get_security_logs,
        system_tools::get_open_ports,
        // Partition Management
        partition_commands::get_disks,
        partition_commands::get_partitions,
        partition_commands::get_partition_info,
        partition_commands::validate_expand_partition,
        partition_commands::validate_shrink_partition,
        partition_commands::expand_partition,
        partition_commands::shrink_partition,
        partition_commands::create_space_reallocation_plan,
        partition_commands::unmount_partition,
        partition_commands::mount_partition
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

