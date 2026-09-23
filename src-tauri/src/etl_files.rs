//! File inspection is isolated from execution. SSH passwords are session-only.
use serde::Deserialize;
use std::io::Write;
use std::process::{Command, Stdio};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectRequest {
    root: String,
    host: Option<String>,
    username: Option<String>,
    port: Option<u16>,
    password: Option<String>,
}

#[tauri::command]
pub async fn inspect_etl_files(request: InspectRequest) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || inspect(request)).await.map_err(|e| e.to_string())?
}

fn inspect(request: InspectRequest) -> Result<serde_json::Value, String> {
    run_script(request, include_str!("../resources/inspect_etl.py"), serde_json::json!({}))
}

/// Execute one bundled inspection/bridge program; input files are never executable.
pub(crate) fn run_script(request: InspectRequest, script: &str, mut config: serde_json::Value) -> Result<serde_json::Value, String> {
    config["root"] = serde_json::Value::String(request.root);
    let config = config.to_string();
    let mut command;
    let mut askpass = None;
    if let Some(host) = request.host.filter(|h| !h.is_empty()) {
        let user = request.username.ok_or("SSH 用户名不能为空")?;
        if !host.chars().all(|c| c.is_ascii_alphanumeric() || ".:-_".contains(c))
            || !user.chars().all(|c| c.is_ascii_alphanumeric() || "_-".contains(c))
            || host.starts_with('-') || user.is_empty() {
            return Err("SSH 地址或用户名无效".into());
        }
        command = Command::new("ssh");
        command.args(["-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3", "-o", "StrictHostKeyChecking=yes", "-p", &request.port.unwrap_or(22).to_string()]);
        if let Some(password) = request.password.filter(|p| !p.is_empty()) {
            let path = std::env::temp_dir().join(format!("sonde-askpass-{}", uuid::Uuid::new_v4()));
            #[cfg(unix)] {
                use std::os::unix::fs::OpenOptionsExt;
                let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o700).open(&path).map_err(|e| e.to_string())?;
                file.write_all(b"#!/bin/sh\nprintf '%s' \"$SONDE_SSH_PASSWORD\"\n").map_err(|e| e.to_string())?;
            }
            #[cfg(not(unix))] { return Err("此平台请使用 SSH 密钥认证".into()); }
            command.env("SSH_ASKPASS", &path).env("SSH_ASKPASS_REQUIRE", "force").env("DISPLAY", "sonde").env("SONDE_SSH_PASSWORD", password);
            askpass = Some(path);
        } else {
            command.args(["-o", "BatchMode=yes"]);
        }
        // JSON becomes one shell-quoted argv value. The inspected files never become commands.
        let quoted = format!("'{}'", config.replace('\'', "'\\''"));
        command.arg(format!("{user}@{host}")).arg(format!("python3 - {quoted}"));
    } else {
        command = Command::new("python3");
        command.args(["-", &config]);
    }
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let result = (|| {
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        child.stdin.take().ok_or("无法写入检查脚本")?.write_all(script.as_bytes()).map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!("服务端请求失败：{}", String::from_utf8_lossy(&output.stderr)));
        }
        serde_json::from_slice(&output.stdout).map_err(|e| format!("服务端响应无效：{e}"))
    })();
    if let Some(path) = askpass { let _ = std::fs::remove_file(path); }
    result
}
