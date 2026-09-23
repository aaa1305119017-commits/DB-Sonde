import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import { useApp, type TreeNode } from "../store/appStore";

export default function DeleteObjectDialog({ node, onClose }: { node: TreeNode; onClose: () => void }) {
  const [sql, setSql] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const objectKind = node.kind === "database" ? "database" : "table";
  const label = objectKind === "database" ? "数据库" : "表";
  const name = objectKind === "database" ? node.database ?? node.label : node.table ?? node.label;
  const request = { connId: node.connId, objectKind, database: node.database ?? "", schema: node.schema, table: node.table ?? node.label } as const;
  const connection = useApp(s => s.connections.find(c => c.id === node.connId));
  useEffect(() => {
    let cancelled = false;
    api.previewDropObject(request).then(value => { if (!cancelled) setSql(value); }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
    /* request 是每次渲染现拼的对象字面量,列进依赖就是每次渲染重发一次预览请求。
       它的内容全部来自 node,而 node.key 就是 node 的身份。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.key]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && !inFlight.current) onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  const remove = async () => {
    if (!sql || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      await api.dropObject({ ...request, confirmation: name });
    } catch (e) {
      setError(`${String(e)}。若为连接中断，请先刷新目录核实结果，再决定是否重试。`);
      inFlight.current = false; setBusy(false); return;
    }
    await useApp.getState().afterObjectDrop(node);
    useApp.getState().showToast({ kind: "success", text: `已删除${label}「${name}」` });
    onClose();
  };
  return <div className="modal-backdrop" onMouseDown={() => { if (!busy) onClose(); }}>
    <div className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="drop-object-title" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><h3 id="drop-object-title"><AlertTriangle size={16}/> 删除{label}</h3></div>
      <div className="modal-body" style={{ display: "grid", gap: 12 }}>
        <p>连接：{connection?.name} · {connection?.host}</p>
        <p>{objectKind === "database" ? "将删除整个数据库及其中的所有表和数据。" : "将删除这张表及其中的全部数据。"}此操作无法撤销。</p>
        <pre className="confirm-text">{sql || "正在检查删除对象…"}</pre>
        <p>是否确认删除{label} <b>{name}</b>？</p>
        {error && <p role="alert" style={{ color: "var(--red)", whiteSpace: "pre-wrap" }}>{error}</p>}
      </div>
      <div className="modal-foot"><button className="btn" autoFocus disabled={busy} onClick={onClose}>取消</button><button className="btn danger" disabled={busy || !sql} onClick={() => void remove()}>{busy ? "正在删除…" : `确认删除${label}`}</button></div>
    </div>
  </div>;
}
