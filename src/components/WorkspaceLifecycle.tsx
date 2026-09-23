import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { inTauri } from "../lib/mockBackend";
import { hasRunningTask, isUnsavedTab } from "../lib/workspaceSession";
import { useApp } from "../store/appStore";
import { persistWorkspace } from "../store/workspacePersistence";

export default function WorkspaceLifecycle() {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const leaving = useRef(false);
  const state = useApp();
  const unsaved = state.tabs.filter(tab => isUnsavedTab(tab, state));
  const running = state.tabs.filter(tab => hasRunningTask(tab));
  const finish = async (skipSave = false) => {
    if (leaving.current) return;
    leaving.current = true; setBusy(true); setError("");
    try {
      if (!skipSave) persistWorkspace(useApp.getState());
      if (inTauri) await invoke("finish_workspace_exit");
      else { leaving.current = false; setBusy(false); setConfirming(false); }
    } catch (reason) {
      leaving.current = false; setBusy(false); setError(reason instanceof Error ? reason.message : String(reason)); setConfirming(true);
    }
  };
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const persist = () => {
      try { persistWorkspace(useApp.getState()); return true; }
      catch { return false; /* Persistent storage notice remains visible; exit is guarded too. */ }
    };
    const unsubscribe = useApp.subscribe((next, previous) => {
      if (next.tabs === previous.tabs && next.activeTabId === previous.activeTabId && next.savedQueries === previous.savedQueries && next.dirtyTabs === previous.dirtyTabs) return;
      clearTimeout(timer); timer = setTimeout(persist, 150);
    });
    const requestExit = () => {
      const current = useApp.getState();
      if (current.tabs.some(tab => isUnsavedTab(tab, current) || hasRunningTask(tab))) setConfirming(true);
      else void finish();
    };
    if (inTauri) void listen("workspace-exit-requested", requestExit).then(async off => {
      if (disposed) { off(); return; }
      unlisten = off;
      await invoke("enable_workspace_exit_guard");
    }).catch(reason => useApp.getState().showToast({ kind: "error", text: `退出保护启动失败：${String(reason)}` }));
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      const saved = persist();
      const current = useApp.getState();
      if (!saved || current.tabs.some(tab => isUnsavedTab(tab, current) || hasRunningTask(tab))) { event.preventDefault(); event.returnValue = ""; }
    };
    // Desktop close/Cmd+Q is handled by Rust so the window remains available.
    if (!inTauri) window.addEventListener("beforeunload", beforeUnload);
    return () => { disposed = true; clearTimeout(timer); unsubscribe(); unlisten?.(); window.removeEventListener("beforeunload", beforeUnload); };
  }, []);
  if (!confirming) return null;
  return <div className="modal-backdrop">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="workspace-exit-title" style={{ width: 480 }}>
      <div className="modal-head"><h3 id="workspace-exit-title">退出 Sonde？</h3></div>
      <div className="modal-body">
        {unsaved.length > 0 && <><p>以下页面有未保存内容：</p><ul style={{ maxHeight: 220, overflowY: "auto" }}>{unsaved.map(tab => <li key={tab.id}>{tab.title}</li>)}</ul><p>继续退出会丢弃这些修改并关闭对应页面；已保存的脚本、文件和看板保留。</p></>}
        {running.length > 0 && <p>还有 {running.length} 个 SQL 任务正在执行。退出会断开连接，已执行的数据修改不会因此撤销。</p>}
        {error && <p role="alert" style={{ color: "var(--red)" }}>{error} 选择不保存时会保留上次的工作区记录，本次页面变化不记录。</p>}
      </div>
      <div className="modal-foot"><button className="btn" autoFocus disabled={busy} onClick={() => setConfirming(false)}>返回继续编辑</button>{error && <button className="btn danger" disabled={busy} onClick={() => void finish(true)}>不保存工作区并退出</button>}<button className="btn danger" disabled={busy} onClick={() => void finish()}>{error ? "重试保存并退出" : "继续退出"}</button></div>
    </div>
  </div>;
}
