//! Generic HTTP proxy for scheduler integrations. Each scheduler's API logic
//! (endpoints, auth, parsing) lives in the frontend; this command just performs
//! the request from Rust so the webview's CORS policy and self-signed TLS are
//! out of the way. It carries no scheduler-specific knowledge, so adding a new
//! scheduler (Airflow, Kettle, XXL-Job, …) needs no Rust changes at all.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
    /// Request timeout in seconds (defaults to 30).
    #[serde(default)]
    timeout_secs: Option<u64>,
    /// 这一个地址是不是允许自签 / 过期证书。**默认不允许。**
    ///
    /// 原来是无条件 `danger_accept_invalid_certs(true)` —— 注释的理由是"自建调度
    /// 常用自签证书",可它关掉的是**所有**经过这个代理的请求的 TLS 校验,
    /// 包括登录那一次(用户名和口令就在 body 里)。同网段上任何人都能中间人
    /// 截下来,而且没有任何迹象。自签证书是个别地址的情况,不该让所有地址陪绑。
    #[serde(default)]
    allow_invalid_certs: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    status: u16,
    ok: bool,
    body: String,
}

#[tauri::command]
pub async fn scheduler_fetch(request: HttpRequest) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        // 只有这个连接明确勾了"允许自签证书"才放行,不是所有请求都放行。
        .danger_accept_invalid_certs(request.allow_invalid_certs)
        .timeout(Duration::from_secs(request.timeout_secs.unwrap_or(30)))
        .build()
        .map_err(|e| e.to_string())?;

    let method = reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes())
        .map_err(|_| format!("bad HTTP method: {}", request.method))?;

    let mut rb = client.request(method, &request.url);
    for (key, value) in &request.headers {
        rb = rb.header(key, value);
    }
    if let Some(body) = request.body {
        rb = rb.body(body);
    }

    let resp = rb.send().await.map_err(|error| {
        /* 证书不过关的报错原文是一长串 TLS 术语,看的人不知道该怎么办。
           这儿点破:要么证书真有问题,要么这就是个自签的内网地址、去勾那个选项。 */
        let text = error.to_string();
        if !request.allow_invalid_certs
            && (text.contains("certificate") || text.contains("CertificateError") || text.contains("UnknownIssuer"))
        {
            format!("{text}\n\n如果这是内网里用自签证书的调度,在连接设置里勾上「允许自签证书」再试。")
        } else {
            text
        }
    })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse {
        status: status.as_u16(),
        ok: status.is_success(),
        body,
    })
}
