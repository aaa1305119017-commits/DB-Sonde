use serde::Deserialize;
use tauri::Manager;
use std::time::Duration;

#[derive(Deserialize)]
pub struct ReportService {
    url: String,
}

fn service_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "请输入完整的汇报服务地址，例如 http://192.0.2.2:8765".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() || url.path() != "/"
    {
        return Err("汇报服务地址只需协议、主机和端口，不要填写密码、路径或访问码".into());
    }
    Ok(url)
}

#[tauri::command]
pub fn daily_report_source(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("daily-report-source.json");
    if !path.exists() { return Ok(None); }
    let value = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&value).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn daily_report_request(request: ReportService, operation: serde_json::Value) -> Result<serde_json::Value, String> {
    let base = service_url(&request.url)?;
    if !matches!(operation.get("action").and_then(|v| v.as_str()), Some("list" | "read" | "run")) {
        return Err("不支持的每日汇报操作".into());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|e| e.to_string())?;
    let response = client.post(base.join("api/desktop").map_err(|e| e.to_string())?)
        .header("Origin", base.origin().ascii_serialization())
        .header("Content-Type", "application/json")
        .body(serde_json::to_vec(&operation).map_err(|e| e.to_string())?)
        .send().await.map_err(|e| {
            if e.is_timeout() { "连接汇报服务超时，请稍后刷新查看结果".to_string() }
            else { "无法连接汇报服务，请检查服务地址和网络连接".to_string() }
        })?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|_| "读取汇报服务响应失败".to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "汇报服务返回了无法识别的内容".to_string())?;
    if !status.is_success() {
        return Err(value.get("error").and_then(|v| v.as_str()).unwrap_or("汇报服务拒绝了请求").to_string());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::service_url;
    #[test]
    fn accepts_service_origins_without_ssh_credentials() {
        assert_eq!(service_url("http://192.0.2.2:8765").unwrap().origin().ascii_serialization(), "http://192.0.2.2:8765");
        assert!(service_url("http://localhost:8765/").is_ok());
        for invalid in ["ssh://192.0.2.2", "http://user:secret@192.0.2.2:8765", "http://192.0.2.2:8765/#key=secret", "http://192.0.2.2:8765/config.json"] {
            assert!(service_url(invalid).is_err());
        }
    }
}
