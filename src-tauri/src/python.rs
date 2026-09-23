//! Python workbench backend.
//!
//! A relocatable CPython + core data packages ships as a single tarball in the
//! app's resources (see scripts/bundle-python.sh). On first use we extract it
//! into ~/.db-sonde/runtime/python so users never configure an environment.
//! `python_run` spawns a script and streams stdout/stderr back to the UI via
//! `python://event`; a run can be stopped. Simple workspace file CRUD backs the
//! "文件 · Python 脚本" list.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

/// Bump when scripts/bundle-python.sh changes the python/packages, so the app
/// re-extracts on upgrade. Must match RUNTIME_VERSION in that script.
const RUNTIME_VERSION: &str = "py3.12.14-pkgs3";

#[derive(Default)]
pub struct PyRuntime {
    /// run_id -> child pid, for stop().
    procs: Mutex<HashMap<String, u32>>,
    extracting: Arc<Mutex<bool>>,
    error: Arc<Mutex<Option<String>>>,
    /// The `sonde` bridge HTTP server: (port, token), started lazily.
    bridge: Mutex<Option<(u16, String)>>,
    /// Persistent jedi completion server (stdin/stdout line protocol).
    jedi: Mutex<Option<JediProc>>,
}

struct JediProc {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    reader: BufReader<std::process::ChildStdout>,
}

/// The `sonde` Python module written into the runtime's pylib dir. It POSTs
/// SQL back to the local bridge so scripts can query the user's live connections.
const SONDE_PY: &str = r#"""" Sonde 桥:在脚本里直接查你已连接的数据库。

    from sonde import query, connections
    df = query("SELECT * FROM t", conn="原始库")   # -> pandas.DataFrame
    print(connections())                            # 当前打开的连接名
"""
import os as _os, json as _json, urllib.request as _u

_URL = _os.environ.get("SONDE_BRIDGE_URL")
_TOKEN = _os.environ.get("SONDE_BRIDGE_TOKEN", "")


def _call(path, payload):
    if not _URL:
        raise RuntimeError("sonde 桥不可用:请在 Sonde 的 Python 工作台里运行本脚本")
    data = _json.dumps(payload).encode("utf-8")
    req = _u.Request(_URL + path, data=data, method="POST",
                     headers={"Content-Type": "application/json",
                              "X-Sonde-Token": _TOKEN})
    with _u.urlopen(req, timeout=1800) as resp:
        obj = _json.loads(resp.read().decode("utf-8"))
    if not obj.get("ok", False):
        raise RuntimeError(obj.get("error", "查询失败"))
    return obj


def query(sql, conn="", database=None, max_rows=None):
    """跑一段**只读** SQL,返回 pandas.DataFrame。conn 传连接名(左侧那个名字)。

    只接受 SELECT / WITH / SHOW / EXPLAIN / DESCRIBE,而且一次只能一条语句。
    要改数据请去 SQL 编辑器 —— 那里的写操作会先让你确认,这儿不会。
    """
    obj = _call("/query", {"sql": sql, "conn": conn or "",
                           "database": database, "maxRows": max_rows})
    import pandas as pd
    return pd.DataFrame(obj.get("rows", []), columns=obj.get("columns", []))


def connections():
    """当前打开的连接名列表。"""
    return _call("/connections", {}).get("connections", [])


def show(fig=None, dpi=120):
    """把当前(或指定的)matplotlib 图片显示到输出台。"""
    import uuid as _uuid
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as _plt
    f = fig if fig is not None else _plt.gcf()
    d = _os.path.join(_os.environ.get("SONDE_WORKSPACE", "."), ".sonde_plots")
    _os.makedirs(d, exist_ok=True)
    p = _os.path.join(d, _uuid.uuid4().hex + ".png")
    f.savefig(p, dpi=dpi, bbox_inches="tight")
    _plt.close(f)
    print("⟦SONDE_IMG⟧" + p + "⟦/IMG⟧", flush=True)
"#;

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}
fn runtime_root() -> PathBuf {
    home().join(".db-sonde/runtime")
}
fn python_dir() -> PathBuf {
    runtime_root().join("python")
}
fn python_bin() -> PathBuf {
    python_dir().join("bin/python3")
}
#[cfg(test)]
thread_local! { static TEST_WORKSPACE: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) }; }
fn workspace_dir() -> PathBuf {
    #[cfg(test)]
    { TEST_WORKSPACE.with(|p| p.borrow().clone().expect("workspace tests must install an isolated fixture")) }
    #[cfg(not(test))]
    { home().join(".db-sonde/workspace") }
}
fn bundled_tar(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?;
    let p = dir.join("binaries/python-runtime.tar.gz");
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// The installed runtime matches the version this build expects.
fn runtime_ready() -> bool {
    if !python_bin().exists() {
        return false;
    }
    match std::fs::read_to_string(python_dir().join("RUNTIME_VERSION")) {
        Ok(v) => v.trim() == RUNTIME_VERSION,
        Err(_) => false,
    }
}

#[derive(Serialize)]
pub struct PyStatus {
    installed: bool,
    extracting: bool,
    bundled: bool,
    version: String,
    python: Option<String>,
    workspace: String,
    error: Option<String>,
}

fn make_status(app: &tauri::AppHandle, rt: &PyRuntime) -> PyStatus {
    PyStatus {
        installed: runtime_ready(),
        extracting: *rt.extracting.lock().unwrap(),
        bundled: bundled_tar(app).is_some(),
        version: RUNTIME_VERSION.to_string(),
        python: runtime_ready().then(|| python_bin().to_string_lossy().into_owned()),
        workspace: workspace_dir().to_string_lossy().into_owned(),
        error: rt.error.lock().unwrap().clone(),
    }
}

#[tauri::command]
pub fn python_status(app: tauri::AppHandle, rt: tauri::State<'_, PyRuntime>) -> PyStatus {
    make_status(&app, &rt)
}

/// Extract the bundled runtime if it isn't installed yet. Returns immediately;
/// extraction runs on a thread. Poll `python_status` for `installed`.
#[tauri::command]
pub fn python_ensure(app: tauri::AppHandle, rt: tauri::State<'_, PyRuntime>) -> PyStatus {
    if runtime_ready() || *rt.extracting.lock().unwrap() {
        return make_status(&app, &rt);
    }
    let tar = match bundled_tar(&app) {
        Some(t) => t,
        None => {
            *rt.error.lock().unwrap() = Some("这个安装包没有内置 Python 运行时(需重新构建)".into());
            return make_status(&app, &rt);
        }
    };

    *rt.extracting.lock().unwrap() = true;
    *rt.error.lock().unwrap() = None;
    let extracting = rt.extracting.clone();
    let error = rt.error.clone();
    let app2 = app.clone();

    std::thread::spawn(move || {
        let result = extract_runtime(&tar);
        if let Err(e) = &result {
            *error.lock().unwrap() = Some(e.clone());
        }
        *extracting.lock().unwrap() = false;
        // nudge the UI to re-read status
        let _ = app2.emit("python://ready", runtime_ready());
    });

    make_status(&app, &rt)
}

fn extract_runtime(tar: &Path) -> Result<(), String> {
    let root = runtime_root();
    // fresh extract: drop any stale/partial runtime first
    let _ = std::fs::remove_dir_all(python_dir());
    std::fs::create_dir_all(&root).map_err(|e| format!("建目录失败:{e}"))?;
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(tar)
        .arg("-C")
        .arg(&root)
        .status()
        .map_err(|e| format!("解压失败:{e}"))?;
    if !status.success() {
        return Err("解压 Python 运行时失败".into());
    }
    if !python_bin().exists() {
        return Err("解压后未找到 python 可执行文件".into());
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct RunReq {
    #[serde(rename = "runId")]
    run_id: String,
    /// Absolute path of the .py file to run (already saved by the frontend).
    path: String,
}

#[derive(Serialize, Clone)]
struct PyEvent {
    #[serde(rename = "runId")]
    run_id: String,
    kind: String, // "out" | "err" | "exit"
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i32>,
}

// ---- the `sonde` bridge: scripts query the user's live connections ----

fn pylib_dir() -> PathBuf {
    runtime_root().join("pylib")
}

/// Point matplotlib at macOS system CJK fonts so Chinese labels aren't tofu.
/// matplotlib reads `matplotlibrc` from MPLCONFIGDIR at import, so this applies
/// to every plot from the start (setting rcParams after plotting is too late).
fn write_mplconfig() -> PathBuf {
    let dir = runtime_root().join("mplconfig");
    let _ = std::fs::create_dir_all(&dir);
    let rc = "font.sans-serif: PingFang SC, Hiragino Sans GB, Heiti SC, STHeiti, Arial Unicode MS, DejaVu Sans\n\
              axes.unicode_minus: False\n";
    let _ = std::fs::write(dir.join("matplotlibrc"), rc);
    dir
}

/// Write `sonde.py` into the pylib dir (idempotent). Kept out of the bundled
/// site-packages so we can update it by changing Rust, no re-bundle needed.
fn write_pylib() -> PathBuf {
    let dir = pylib_dir();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join("sonde.py"), SONDE_PY);
    let _ = std::fs::write(dir.join("jedi_server.py"), JEDI_SERVER);
    let _ = std::fs::write(dir.join("sqllineage.py"), SQLLINEAGE_PY);
    dir
}

/// Table-level lineage for one SQL statement via sqlglot. Reads SQL from stdin,
/// dialect from argv[1]; prints JSON {ok, target, sources[]}.
const SQLLINEAGE_PY: &str = include_str!("../resources/sql_lineage.py");

/// A persistent jedi completion server: one JSON request per line on stdin,
/// one JSON response per line on stdout. Keeps jedi warm between keystrokes.
const JEDI_SERVER: &str = r#"import sys, json
def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            import jedi
            script = jedi.Script(code=req["source"], path=None)
            comps = script.complete(int(req["line"]), int(req["col"]))
            items = [{"name": c.name, "type": c.type, "complete": c.complete} for c in comps[:60]]
            sys.stdout.write(json.dumps({"ok": True, "items": items}) + "\n")
        except Exception as e:
            sys.stdout.write(json.dumps({"ok": False, "error": str(e)}) + "\n")
        sys.stdout.flush()
main()
"#;

/// Minimal base64 (std-only) for embedding a plot PNG as a data: URL.
fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// Start the localhost bridge server once; return (port, token).
fn ensure_bridge(app: &tauri::AppHandle, rt: &PyRuntime) -> Result<(u16, String), String> {
    let mut g = rt.bridge.lock().unwrap();
    if let Some((p, t)) = g.as_ref() {
        return Ok((*p, t.clone()));
    }
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| format!("桥启动失败:{e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or("无法获取桥端口")?;
    let token = uuid::Uuid::new_v4().to_string();
    let app2 = app.clone();
    let token2 = token.clone();
    std::thread::spawn(move || bridge_serve(app2, server, token2));
    *g = Some((port, token.clone()));
    Ok((port, token))
}

#[derive(Deserialize)]
struct BridgeReq {
    sql: Option<String>,
    conn: Option<String>,
    database: Option<String>,
    #[serde(rename = "maxRows")]
    max_rows: Option<usize>,
}

fn err_json(msg: &str) -> String {
    serde_json::json!({ "ok": false, "error": msg }).to_string()
}

fn bridge_serve(app: tauri::AppHandle, server: tiny_http::Server, token: String) {
    for mut req in server.incoming_requests() {
        let authed = req
            .headers()
            .iter()
            .any(|h| h.field.equiv("X-Sonde-Token") && h.value.as_str() == token);
        if !authed {
            let _ = req.respond(tiny_http::Response::from_string(err_json("unauthorized")).with_status_code(403));
            continue;
        }
        let url = req.url().to_string();
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let out = handle_bridge(&app, &url, &body);
        let header =
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap();
        let _ = req.respond(tiny_http::Response::from_string(out).with_header(header));
    }
}

fn handle_bridge(app: &tauri::AppHandle, url: &str, body: &str) -> String {
    use crate::commands::{self, AppState};
    let state = app.state::<AppState>();
    if url.starts_with("/connections") {
        let names = tauri::async_runtime::block_on(commands::bridge_conn_names(&state));
        return serde_json::json!({ "ok": true, "connections": names }).to_string();
    }
    if url.starts_with("/query") {
        let req: BridgeReq = match serde_json::from_str(body) {
            Ok(r) => r,
            Err(e) => return err_json(&format!("请求解析失败:{e}")),
        };
        let sql = req.sql.unwrap_or_default();
        if sql.trim().is_empty() {
            return err_json("sql 不能为空");
        }
        let conn = req.conn.unwrap_or_default();
        let res = tauri::async_runtime::block_on(commands::bridge_query(
            &state,
            &conn,
            req.database.as_deref(),
            &sql,
            req.max_rows,
        ));
        return match res {
            Ok(qr) => {
                let cols: Vec<&str> = qr.columns.iter().map(|c| c.name.as_str()).collect();
                serde_json::json!({
                    "ok": true,
                    "columns": cols,
                    "rows": qr.rows,
                    "truncated": qr.truncated,
                    "rowsAffected": qr.rows_affected,
                })
                .to_string()
            }
            Err(e) => err_json(&e.to_string()),
        };
    }
    err_json("未知接口")
}

/// Run a saved script, streaming stdout/stderr to `python://event`.
#[tauri::command]
pub fn python_run(app: tauri::AppHandle, rt: tauri::State<'_, PyRuntime>, req: RunReq) -> Result<(), String> {
    if !runtime_ready() {
        return Err("Python 运行时还没就绪".into());
    }
    let script = PathBuf::from(&req.path);
    if !script.exists() {
        return Err("脚本文件不存在".into());
    }
    /* 读、写、删、改名都过 in_workspace,唯独"运行"没过 —— 这条命令能跑机器上
       任何一个 .py。目前只有前端在调,传的都是工作区里的路径,但把守卫留一个
       缺口本身就是问题:下一个调用方(AI 工具、自动化、别的面板)不会知道
       这条路没人看门。 */
    if !in_workspace(&script) {
        return Err("脚本不在工作区内".into());
    }
    let workdir = script.parent().map(PathBuf::from).unwrap_or_else(workspace_dir);

    // Start the bridge + drop the `sonde` module in, so scripts can query the
    // user's live connections. Failure here is non-fatal (plain Python still runs).
    let (bridge_port, bridge_token) = ensure_bridge(&app, &rt).unwrap_or((0, String::new()));
    let pylib = write_pylib();

    let child = Command::new(python_bin())
        .arg("-X")
        .arg("utf8")
        .arg(&script)
        .current_dir(&workdir)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        // pylib holds our `sonde` module; site-packages still resolves normally
        .env("PYTHONPATH", &pylib)
        .env("SONDE_BRIDGE_URL", format!("http://127.0.0.1:{bridge_port}"))
        .env("SONDE_BRIDGE_TOKEN", &bridge_token)
        .env("SONDE_WORKSPACE", workspace_dir())
        .env("MPLBACKEND", "Agg") // headless matplotlib; use sonde.show() to render
        .env("MPLCONFIGDIR", write_mplconfig()) // CJK fonts + font cache
        .env_remove("PYTHONHOME")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 Python 失败:{e}"))?;

    stream_child(&app, req.run_id.clone(), child);
    Ok(())
}

/// Register a child under `run_id`, stream its stdout/stderr as `python://event`
/// (kind out/err), and emit an `exit` event when it finishes.
fn stream_child(app: &tauri::AppHandle, run_id: String, mut child: std::process::Child) {
    if let Some(state) = app.try_state::<PyRuntime>() {
        state.procs.lock().unwrap().insert(run_id.clone(), child.id());
    }
    if let Some(out) = child.stdout.take() {
        let app = app.clone();
        let rid = run_id.clone();
        std::thread::spawn(move || pump(app, rid, out, "out"));
    }
    if let Some(err) = child.stderr.take() {
        let app = app.clone();
        let rid = run_id.clone();
        std::thread::spawn(move || pump(app, rid, err, "err"));
    }
    let app_exit = app.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        if let Some(state) = app_exit.try_state::<PyRuntime>() {
            state.procs.lock().unwrap().remove(&run_id);
        }
        let _ = app_exit.emit(
            "python://event",
            PyEvent { run_id, kind: "exit".into(), text: None, code },
        );
    });
}

fn pump<R: std::io::Read>(app: tauri::AppHandle, run_id: String, reader: R, kind: &'static str) {
    let mut buf = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        match buf.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let _ = app.emit(
                    "python://event",
                    PyEvent {
                        run_id: run_id.clone(),
                        kind: kind.to_string(),
                        text: Some(line.clone()),
                        code: None,
                    },
                );
            }
            Err(_) => break,
        }
    }
}

#[tauri::command]
pub fn python_stop(rt: tauri::State<'_, PyRuntime>, run_id: String) -> Result<(), String> {
    let pid = match rt.procs.lock().unwrap().get(&run_id).copied() {
        Some(pid) => pid,
        // 已经跑完了(退出线程把它摘掉了)。不是错误,界面很快会收到 exit 事件。
        None => return Ok(()),
    };
    /* 原来是 `let _ = ...status()` —— 信号没发出去也照样返回 Ok,界面就以为停了。
       实际它还在跑,输出还在往外冒,用户只会觉得"这个停止按钮是坏的"。 */
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status()
        .map_err(|e| format!("发送停止信号失败:{e}"))?;
    if !status.success() {
        return Err(format!(
            "没能停掉这个脚本(进程 {pid})。它可能正卡在系统调用里,可以在活动监视器里结束它。"
        ));
    }
    Ok(())
}

// ---- workspace file CRUD (scoped to ~/.db-sonde/workspace) ----

#[derive(Serialize, Debug)]
pub struct PyFile {
    name: String,
    path: String,
    size: u64,
}

fn ensure_workspace() -> PathBuf {
    let dir = workspace_dir();
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Resolve both the parent and final component; never fall back to a lexical
/// prefix if filesystem resolution fails. A missing leaf is valid for creation.
fn workspace_path(path: &Path) -> Result<PathBuf, String> {
    let denied = || "路径不在工作区内".to_string();
    let root = std::fs::canonicalize(workspace_dir()).map_err(|_| denied())?;
    let parent = path.parent().ok_or_else(denied)?;
    let parent = std::fs::canonicalize(parent).map_err(|_| denied())?;
    let name = path.file_name().ok_or_else(denied)?;
    let resolved = parent.join(name);
    if !resolved.starts_with(&root) || resolved == root { return Err(denied()); }
    match std::fs::symlink_metadata(&resolved) {
        Ok(meta) if meta.file_type().is_symlink() => return Err(denied()),
        Ok(_) => {},
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
        Err(_) => return Err(denied()),
    }
    Ok(resolved)
}
fn in_workspace(path: &Path) -> bool { workspace_path(path).is_ok() }
fn workspace_file(path: &Path, write: bool) -> Result<std::fs::File, String> {
    let path = workspace_path(path)?;
    let mut options = std::fs::OpenOptions::new();
    options.read(!write).write(write).create(write).truncate(write);
    #[cfg(unix)]
    { use std::os::unix::fs::OpenOptionsExt; options.custom_flags(libc::O_NOFOLLOW); }
    options.open(path).map_err(|e| format!("打开文件失败:{e}"))
}
fn script_name(name: &str) -> Result<&str, String> {
    let name = name.trim().trim_end_matches(".py");
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', ':', '\0']) {
        return Err("名字不合法".into());
    }
    Ok(name)
}

#[tauri::command]
pub fn py_workspace_dir() -> String {
    ensure_workspace().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn py_list_files() -> Vec<PyFile> {
    let dir = ensure_workspace();
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let path = e.path();
            if path.extension().and_then(|x| x.to_str()) == Some("py") {
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                out.push(PyFile {
                    name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                    path: path.to_string_lossy().into_owned(),
                    size,
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// 按扩展名列工作区里的文件(不含子目录)。Python 脚本之外的东西也放这儿,
/// 比如「导出网页」产出的看板 .html —— 文件面板据此分组展示。
#[tauri::command]
pub fn workspace_list_files(ext: String) -> Vec<PyFile> {
    let dir = ensure_workspace();
    let want = ext.trim_start_matches('.').to_lowercase();
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let path = e.path();
            let matches = path
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.to_lowercase() == want)
                .unwrap_or(false);
            if matches {
                out.push(PyFile {
                    name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                    path: path.to_string_lossy().into_owned(),
                    size: e.metadata().map(|m| m.len()).unwrap_or(0),
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[tauri::command]
pub fn py_read_file(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut content = String::new();
    workspace_file(Path::new(&path), false)?.read_to_string(&mut content).map_err(|e| format!("读取失败:{e}"))?;
    Ok(content)
}

#[tauri::command]
pub fn py_write_file(path: String, content: String) -> Result<(), String> {
    use std::io::Write;
    workspace_file(Path::new(&path), true)?.write_all(content.as_bytes()).map_err(|e| format!("写入失败:{e}"))
}

/// Create a new .py file (auto-suffixed if the name is taken). Returns its path.
#[tauri::command]
pub fn py_new_file(name: Option<String>) -> Result<PyFile, String> {
    let dir = ensure_workspace();
    let base = name.unwrap_or_else(|| "未命名".into());
    let base = script_name(&base)?;
    let mut candidate = dir.join(format!("{base}.py"));
    let mut n = 1;
    let template = "# Sonde · Python 工作台(⌘⏎ 运行)\n\
# 内置 pandas / numpy / polars…,还能直接查你左边连好的库:\n\
#\n\
#   from sonde import query, connections\n\
#   print(connections())                        # 当前打开的连接名\n\
#   df = query(\"SELECT 1 AS n\", conn=\"连接名\")   # -> pandas.DataFrame\n\
\n\
import pandas as pd\n\
\n\
print(\"hello from Sonde 🐍\")\n\
print(pd.DataFrame({\"n\": [1, 2, 3], \"n2\": [1, 4, 9]}))\n";
    use std::io::Write;
    loop {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(mut file) => { file.write_all(template.as_bytes()).map_err(|e| format!("创建失败:{e}"))?; break; },
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                n += 1; candidate = dir.join(format!("{base}{n}.py"));
            },
            Err(e) => return Err(format!("创建失败:{e}")),
        }
    }
    Ok(PyFile {
        name: candidate.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        path: candidate.to_string_lossy().into_owned(),
        size: template.len() as u64,
    })
}

#[tauri::command]
pub fn py_delete_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !in_workspace(&p) {
        return Err("路径不在工作区内".into());
    }
    std::fs::remove_file(&p).map_err(|e| format!("删除失败:{e}"))
}

#[tauri::command]
pub fn py_rename_file(path: String, new_name: String) -> Result<PyFile, String> {
    let p = PathBuf::from(&path);
    if !in_workspace(&p) {
        return Err("路径不在工作区内".into());
    }
    let clean = script_name(&new_name)?;
    let target = ensure_workspace().join(format!("{clean}.py"));
    if target.exists() && target != p {
        return Err("同名文件已存在".into());
    }
    std::fs::rename(&p, &target).map_err(|e| format!("重命名失败:{e}"))?;
    let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
    Ok(PyFile {
        name: target.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        path: target.to_string_lossy().into_owned(),
        size,
    })
}

// ---- Phase 3: package install / plots / lint / completion ----

/// pip-install packages from the Tsinghua mirror, streaming to `python://event`.
#[tauri::command]
pub fn py_pip_install(app: tauri::AppHandle, run_id: String, packages: Vec<String>) -> Result<(), String> {
    if !runtime_ready() {
        return Err("Python 运行时未就绪".into());
    }
    if packages.is_empty() {
        return Err("没有要安装的包".into());
    }
    let mut cmd = Command::new(python_bin());
    cmd.arg("-m")
        .arg("pip")
        .arg("install")
        .arg("--disable-pip-version-check")
        .arg("-i")
        .arg("https://pypi.tuna.tsinghua.edu.cn/simple");
    for p in &packages {
        cmd.arg(p);
    }
    let child = cmd
        .env("PYTHONUNBUFFERED", "1")
        .env_remove("PYTHONHOME")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 pip 失败:{e}"))?;
    stream_child(&app, run_id, child);
    Ok(())
}

/// Download Playwright's Chromium browser (via a China mirror), streaming logs.
#[tauri::command]
pub fn py_playwright_install(app: tauri::AppHandle, run_id: String) -> Result<(), String> {
    if !runtime_ready() {
        return Err("Python 运行时未就绪".into());
    }
    let child = Command::new(python_bin())
        .arg("-m")
        .arg("playwright")
        .arg("install")
        .arg("chromium")
        .env("PYTHONUNBUFFERED", "1")
        .env("PLAYWRIGHT_DOWNLOAD_HOST", "https://cdn.npmmirror.com/binaries/playwright")
        .env_remove("PYTHONHOME")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 playwright 失败:{e}(先装 playwright 包)"))?;
    stream_child(&app, run_id, child);
    Ok(())
}

/// Read a plot PNG (written by `sonde.show()`) as a data: URL for inline view.
#[tauri::command]
pub fn py_read_image(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    workspace_file(Path::new(&path), false)?.read_to_end(&mut bytes).map_err(|e| format!("读图失败:{e}"))?;
    Ok(format!("data:image/png;base64,{}", b64(&bytes)))
}

#[derive(Serialize)]
pub struct LintIssue {
    line: u32,
    col: u32,
    code: String,
    message: String,
}

/// Lint a saved script with the bundled ruff. Empty when ruff isn't present.
#[tauri::command]
pub fn py_lint(path: String) -> Result<Vec<LintIssue>, String> {
    let ruff = python_dir().join("bin/ruff");
    if !ruff.exists() {
        return Ok(vec![]);
    }
    let out = Command::new(&ruff)
        .arg("check")
        .arg("--output-format")
        .arg("json")
        .arg("--quiet")
        .arg("--no-cache")
        .arg(&path)
        .output()
        .map_err(|e| format!("ruff 运行失败:{e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let arr: Vec<serde_json::Value> = serde_json::from_str(&stdout).unwrap_or_default();
    Ok(arr
        .iter()
        .map(|v| LintIssue {
            line: v["location"]["row"].as_u64().unwrap_or(1) as u32,
            col: v["location"]["column"].as_u64().unwrap_or(1) as u32,
            code: v["code"].as_str().unwrap_or("").to_string(),
            message: v["message"].as_str().unwrap_or("").to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct Completion {
    label: String,
    kind: String,
    apply: String,
}

/// Start (or reuse) the persistent jedi server.
fn ensure_jedi(rt: &PyRuntime) -> Result<(), String> {
    let mut g = rt.jedi.lock().unwrap();
    if let Some(jp) = g.as_mut() {
        if matches!(jp.child.try_wait(), Ok(None)) {
            return Ok(());
        }
    }
    let pylib = write_pylib();
    let mut child = Command::new(python_bin())
        .arg("-X")
        .arg("utf8")
        .arg(pylib.join("jedi_server.py"))
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONPATH", &pylib)
        .env_remove("PYTHONHOME")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动补全失败:{e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    *g = Some(JediProc { child, stdin, reader: BufReader::new(stdout) });
    Ok(())
}

/// Code completion via jedi. `line` is 1-based, `col` 0-based (jedi's convention).
/// Returns empty on any failure so the editor never breaks.
#[tauri::command]
pub fn py_complete(
    rt: tauri::State<'_, PyRuntime>,
    source: String,
    line: u32,
    col: u32,
) -> Result<Vec<Completion>, String> {
    if !runtime_ready() || ensure_jedi(&rt).is_err() {
        return Ok(vec![]);
    }
    let mut g = rt.jedi.lock().unwrap();
    let jp = match g.as_mut() {
        Some(x) => x,
        None => return Ok(vec![]),
    };
    let req = serde_json::json!({ "source": source, "line": line, "col": col }).to_string();
    if writeln!(jp.stdin, "{req}").and_then(|_| jp.stdin.flush()).is_err() {
        *g = None;
        return Ok(vec![]);
    }
    let mut buf = String::new();
    if jp.reader.read_line(&mut buf).is_err() {
        *g = None;
        return Ok(vec![]);
    }
    let resp: serde_json::Value = serde_json::from_str(buf.trim()).unwrap_or_default();
    if !resp["ok"].as_bool().unwrap_or(false) {
        return Ok(vec![]);
    }
    let items = resp["items"].as_array().cloned().unwrap_or_default();
    Ok(items
        .iter()
        .map(|it| Completion {
            label: it["name"].as_str().unwrap_or("").to_string(),
            kind: it["type"].as_str().unwrap_or("").to_string(),
            apply: it["complete"].as_str().unwrap_or("").to_string(),
        })
        .collect())
}

#[derive(Serialize, Default)]
pub struct LineageResult {
    flows: Vec<serde_json::Value>,
    ok: bool,
    target: Option<String>,
    sources: Vec<String>,
    error: Option<String>,
}

/// Table-level lineage of one SQL statement, via sqlglot. `dialect` is a sqlglot
/// dialect name (mysql/postgres/oracle/sqlite/tsql/clickhouse…), or empty.
#[tauri::command]
pub fn py_sql_lineage(sql: String, dialect: Option<String>) -> Result<LineageResult, String> {
    if !runtime_ready() {
        return Err("Python 运行时未就绪".into());
    }
    let pylib = write_pylib();
    let mut child = Command::new(python_bin())
        .arg("-X")
        .arg("utf8")
        .arg(pylib.join("sqllineage.py"))
        .arg(dialect.unwrap_or_default())
        .env("PYTHONPATH", &pylib)
        .env("PYTHONIOENCODING", "utf-8")
        .env_remove("PYTHONHOME")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动解析失败:{e}"))?;
    if let Some(mut si) = child.stdin.take() {
        let _ = si.write_all(sql.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| format!("解析失败:{e}"))?;
    let s = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(s.trim()).unwrap_or_default();
    Ok(LineageResult {
        flows: v["flows"].as_array().cloned().unwrap_or_default(),
        ok: v["ok"].as_bool().unwrap_or(false),
        target: v["target"].as_str().map(|x| x.to_string()),
        sources: v["sources"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        error: v["error"].as_str().map(|x| x.to_string()),
    })
}

#[cfg(test)]
mod workspace_tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("sonde-workspace-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            TEST_WORKSPACE.with(|p| *p.borrow_mut() = Some(root.clone()));
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            TEST_WORKSPACE.with(|p| *p.borrow_mut() = None);
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 工作区边界:路径规范化之后必须落在工作区里。
    /// `..` 和符号链接都要解开 —— 只做字符串前缀比较的话
    /// `<工作区>/../../etc/passwd` 会直接通过。
    #[test]
    fn traversal_does_not_escape_the_workspace() {
        let _fixture = Fixture::new();
        let ws = ensure_workspace();
        assert!(in_workspace(&ws.join("a.py")), "工作区里的文件当然可以");
        assert!(
            !in_workspace(&ws.join("..").join("escaped.py")),
            "上跳一层就出了工作区"
        );
        assert!(
            !in_workspace(&ws.join("..").join("..").join("etc").join("passwd")),
            "多跳几层也一样"
        );
        assert!(!in_workspace(Path::new("/etc/passwd")), "绝对路径直接拒绝");
        // 子目录是工作区的一部分,不该误伤
        let sub = ws.join("sub");
        let _ = std::fs::create_dir_all(&sub);
        assert!(in_workspace(&sub.join("b.py")), "工作区的子目录算在内");
        let _ = std::fs::remove_dir(&sub);
    }

    /// 改名只收纯文件名。原来只挡 '/',反斜杠(Windows 的分隔符)和 `..` 都能过。
    ///
    /// 源文件必须真在工作区里 —— 否则 in_workspace 先把它拦下,
    /// 名字校验那段根本走不到,测了等于没测(第一版就是这样)。
    #[test]
    fn rename_rejects_anything_that_is_not_a_plain_name() {
        let _fixture = Fixture::new();
        let ws = ensure_workspace();
        let source = ws.join("rename-guard-fixture.py");
        std::fs::write(&source, "# fixture\n").expect("工作区应当可写");
        let path = source.to_string_lossy().into_owned();
        for bad in ["", "   ", "../evil", "a/b", "..\\evil", ".", ".."] {
            let result = py_rename_file(path.clone(), bad.into());
            assert!(result.is_err(), "「{bad}」不该被当成合法文件名");
            assert_eq!(
                result.unwrap_err(),
                "名字不合法",
                "「{bad}」该在名字校验那一步被拦下,不是别的原因"
            );
        }
        // 正常名字要能改成功(别把守卫收得连正经改名都不让)
        let ok = py_rename_file(path, "renamed-fixture".into()).expect("正常名字应当可以");
        assert_eq!(ok.name, "renamed-fixture.py");
        let _ = std::fs::remove_file(ws.join("renamed-fixture.py"));
    }
    #[test]
    fn new_file_rejects_paths_and_does_not_overwrite() {
        let _fixture = Fixture::new();
        for bad in ["../escape", "/tmp/escape", "a/b", "..\\escape", "", ".", "..", "C:\\escape"] {
            assert!(py_new_file(Some(bad.into())).is_err(), "{bad}");
        }
        let first = py_new_file(Some("safe.py".into())).unwrap();
        py_write_file(first.path.clone(), "keep".into()).unwrap();
        let second = py_new_file(Some("safe.py".into())).unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(py_read_file(first.path).unwrap(), "keep");
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_read_or_overwrite_outside_files() {
        let fixture = Fixture::new();
        let outside = fixture.0.with_extension("outside");
        std::fs::write(&outside, "keep").unwrap();
        let link = fixture.0.join("link.py");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let path = link.to_string_lossy().into_owned();
        assert!(py_read_file(path.clone()).is_err());
        assert!(py_read_image(path.clone()).is_err());
        assert!(py_write_file(path, "overwritten".into()).is_err());
        assert_eq!(std::fs::read_to_string(&outside).unwrap(), "keep");
        std::fs::remove_file(outside).unwrap();
    }

}
