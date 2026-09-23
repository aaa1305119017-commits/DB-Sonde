import { Files, Pencil, Plus, Trash2, X } from "lucide-react";
import type { DashboardDocument } from "../domain";

interface Props {
  documents: DashboardDocument[];
  activeId?: string;
  dirty: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** 页面结构:列出全部分析页面(文档),支持切换 / 新建 / 重命名 / 删除。对齐 v1 PageStructureRail。 */
export default function PageStructureRail({ documents, activeId, dirty, onSelect, onNew, onRename, onDelete, onClose }: Props) {
  return (
    <aside className="dash-page-rail" aria-label="页面结构">
      <header className="dash-page-rail-head">
        <span className="dash-page-rail-icon"><Files size={15} /></span>
        <div className="dash-page-rail-title">
          <strong>页面结构</strong>
          <small>{documents.length} 个分析页面</small>
        </div>
        <button className="icon-btn" title="关闭" onClick={onClose}><X size={14} /></button>
      </header>
      <div className="dash-page-rail-tools">
        <span>页面</span>
        <button onClick={onNew}><Plus size={12} />新建</button>
      </div>
      <nav className="dash-page-rail-list">
        {documents.map((doc) => (
          <article key={doc.id} className={`dash-page-row ${doc.id === activeId ? "active" : ""}`}>
            <button className="dash-page-select" onClick={() => onSelect(doc.id)}>
              <span className="dash-page-glyph">{doc.title.slice(0, 1) || "看"}</span>
              <span className="dash-page-copy">
                <strong>{doc.title || "未命名看板"}</strong>
                <small>{doc.widgets.length} 个组件 · R{doc.revision}{doc.status === "published" ? " · 已发布" : ""}</small>
              </span>
              {dirty && doc.id === activeId && <i className="dash-page-dirty" title="有未保存修改" />}
            </button>
            <span className="dash-page-row-actions">
              <button className="icon-btn" title="重命名" onClick={() => onRename(doc.id)}><Pencil size={12} /></button>
              <button className="icon-btn" title="删除页面" disabled={documents.length <= 1} onClick={() => onDelete(doc.id)}><Trash2 size={12} /></button>
            </span>
          </article>
        ))}
      </nav>
      <button className="dash-page-new" onClick={onNew}><Plus size={13} />新建分析页面</button>
      <footer className="dash-page-rail-foot">
        <strong>独立页面</strong>
        <p>每个页面拥有自己的组件、草稿、发布版本与历史记录。</p>
      </footer>
    </aside>
  );
}
