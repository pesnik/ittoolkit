use serde::{Deserialize, Serialize};
use std::process::Command;
use sysinfo::{Disks, Networks, System};
use tauri::command;

// ============= Disk Manager Structures =============

#[derive(Debug, Serialize, Deserialize)]
pub struct DiskInfo {
    pub name: String,
    pub size: u64,
    pub used: u64,
    pub available: u64,
    pub mount_point: Option<String>,
    pub file_system: Option<String>,
    pub disk_type: Option<String>,
    pub removable: bool,
}

// ============= Network Structures =============

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkInterface {
    pub name: String,
    pub ip_address: Option<String>,
    pub mac_address: Option<String>,
    pub is_up: bool,
}

// ============= System Info Structures =============

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os_name: String,
    pub os_version: String,
    pub hostname: String,
    pub uptime_seconds: u64,
    pub cpu_count: usize,
    pub total_memory: u64,
    pub available_memory: u64,
}

// ============= Service Structures =============

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub name: String,
    pub display_name: String,
    pub status: String,
    pub startup_type: Option<String>,
    pub description: Option<String>,
}

// ============= Process Structures =============

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_usage: f32,
    pub memory_usage: u64,
    pub status: String,
}

// ============= DISK COMMANDS =============

#[command]
pub fn get_disk_info() -> Result<Vec<DiskInfo>, String> {
    let disks = Disks::new_with_refreshed_list();

    let disk_list: Vec<DiskInfo> = disks
        .iter()
        .map(|disk| {
            let total = disk.total_space();
            let available = disk.available_space();
            let used = total - available;

            DiskInfo {
                name: disk.name().to_string_lossy().to_string(),
                size: total,
                used,
                available,
                mount_point: Some(disk.mount_point().to_string_lossy().to_string()),
                file_system: Some(disk.file_system().to_string_lossy().to_string()),
                disk_type: Some(format!("{:?}", disk.kind())),
                removable: disk.is_removable(),
            }
        })
        .collect();

    Ok(disk_list)
}

// ============= NETWORK COMMANDS =============

#[command]
pub fn get_network_interfaces() -> Result<Vec<NetworkInterface>, String> {
    let networks = Networks::new_with_refreshed_list();

    let interface_list: Vec<NetworkInterface> = networks
        .iter()
        .map(|(name, data)| {
            NetworkInterface {
                name: name.to_string(),
                ip_address: None, // sysinfo doesn't provide IP directly
                mac_address: Some(data.mac_address().to_string()),
                is_up: data.received() > 0 || data.transmitted() > 0,
            }
        })
        .collect();

    Ok(interface_list)
}

#[command]
pub async fn ping_host(host: String, count: u32) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let output = Command::new("ping")
        .args(&["-n", &count.to_string(), &host])
        .output()
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("ping")
        .args(&["-c", &count.to_string(), &host])
        .output()
        .map_err(|e| e.to_string())?;

    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

#[command]
pub async fn dns_lookup(host: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let output = Command::new("nslookup")
        .arg(&host)
        .output()
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "windows"))]
    let output = match Command::new("dig").arg(&host).output() {
        Ok(out) => out,
        Err(e) => {
            // Fallback to host command if dig is not available
            Command::new("host")
                .arg(&host)
                .output()
                .map_err(|e2| format!("dig and host failed: {}, {}", e, e2))?
        }
    };

    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

#[command]
pub async fn scan_ports(host: String, ports: Vec<u16>) -> Result<String, String> {
    use std::net::TcpStream;
    use std::time::Duration;

    let mut results = Vec::new();

    for port in ports {
        let address = format!("{}:{}", host, port);
        let result = TcpStream::connect_timeout(
            &address.parse().map_err(|e: std::net::AddrParseError| e.to_string())?,
            Duration::from_secs(1)
        );

        match result {
            Ok(_) => results.push(format!("Port {} is OPEN", port)),
            Err(_) => results.push(format!("Port {} is CLOSED", port)),
        }
    }

    Ok(results.join("\n"))
}

// ============= SYSTEM INFO COMMANDS =============

#[command]
pub fn get_system_info() -> Result<SystemInfo, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    Ok(SystemInfo {
        os_name: System::name().unwrap_or_else(|| "Unknown".to_string()),
        os_version: System::os_version().unwrap_or_else(|| "Unknown".to_string()),
        hostname: System::host_name().unwrap_or_else(|| "Unknown".to_string()),
        uptime_seconds: System::uptime(),
        cpu_count: sys.cpus().len(),
        total_memory: sys.total_memory(),
        available_memory: sys.available_memory(),
    })
}

#[command]
pub fn get_services() -> Result<Vec<ServiceInfo>, String> {
    // This is platform-specific - implementing basic version for now
    // On Windows, would use sc query or Get-Service
    // On Linux, would use systemctl or service

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args(&["-Command", "Get-Service | Select-Object Name, DisplayName, Status, StartType | ConvertTo-Json"])
            .output()
            .map_err(|e| e.to_string())?;

        let json_str = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;

        // Parse JSON - simplified for now
        // In production, use proper JSON parsing
        Ok(vec![]) // Placeholder
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On Linux/macOS, return empty for now
        // Would implement systemctl list-units parsing
        Ok(vec![])
    }
}

#[command]
pub async fn service_action(service_name: String, action: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("sc")
            .args(&[&action, &service_name])
            .output()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("systemctl")
            .args(&[&action, &service_name])
            .output()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("launchctl")
            .args(&[&action, &service_name])
            .output()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ============= SECURITY/PROCESS COMMANDS =============

#[command]
pub fn get_process_list() -> Result<Vec<ProcessInfo>, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let processes: Vec<ProcessInfo> = sys
        .processes()
        .iter()
        .map(|(pid, process)| ProcessInfo {
            pid: pid.as_u32(),
            name: process.name().to_string(),
            cpu_usage: process.cpu_usage(),
            memory_usage: process.memory(),
            status: format!("{:?}", process.status()),
        })
        .collect();

    Ok(processes)
}

#[command]
pub async fn kill_process(pid: u32) -> Result<(), String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    if let Some(process) = sys.process(sysinfo::Pid::from_u32(pid)) {
        if process.kill() {
            Ok(())
        } else {
            Err("Failed to kill process".to_string())
        }
    } else {
        Err("Process not found".to_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

#[command]
pub fn get_security_logs() -> Result<Vec<LogEntry>, String> {
    // Placeholder - would parse actual system logs
    // Windows: Event Viewer
    // Linux: /var/log/auth.log, journalctl
    Ok(vec![])
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PortInfo {
    pub port: u16,
    pub protocol: String,
    pub process_name: String,
    pub pid: u32,
}

#[command]
pub fn get_open_ports() -> Result<Vec<PortInfo>, String> {
    // Would use netstat or ss on Linux, Get-NetTCPConnection on Windows
    // Placeholder for now
    Ok(vec![])
}
