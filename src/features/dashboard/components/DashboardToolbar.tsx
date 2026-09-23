import {
  BarChart3,
  Eye,
  EyeOff,
  Gauge,
  LineChart,
  Loader2,
  PieChart,
  PanelTop,
  Plus,
  Save,
  Table2,
  Type,
  Trash2,
  Undo2,
} from "lucide-react";
import { useI18n } from "../../../hooks/useI18n";
import type { DashboardDocument, DashboardWidgetType } from "../domain";

interface Props {
  document: DashboardDocument;
  documents: DashboardDocument[];
  dirty: boolean;
  saving: boolean;
  preview: boolean;
  canUndo: boolean;
  onTitle: (title: string) => void;
  onSelectDocument: (id: string) => void;
  onNewDocument: () => void;
  onAddWidget: (type: DashboardWidgetType) => void;
  onPreview: () => void;
  onUndo: () => void;
  onSave: () => void;
  onDeleteDashboard: () => void;
  /** 存在哪个文件 —— 挂在保存按钮的 tooltip 上,不然「保存的东西在哪」没处问。 */
  storagePath?: string;
}

const widgetButtons: Array<{ type: DashboardWidgetType; icon: typeof Gauge }> = [
  { type: "kpi", icon: Gauge },
  { type: "line", icon: LineChart },
  { type: "bar", icon: BarChart3 },
  { type: "pie", icon: PieChart },
  { type: "table", icon: Table2 },
  { type: "text", icon: Type },
  { type: "container", icon: PanelTop },
];

export default function DashboardToolbar({
  document,
  documents,
  dirty,
  saving,
  preview,
  canUndo,
  onTitle,
  onSelectDocument,
  onNewDocument,
  onAddWidget,
  onPreview,
  onUndo,
  onSave,
  onDeleteDashboard,
  storagePath,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="dash-toolbar">
      <select className="dash-page-select" value={document.id} onChange={(event) => onSelectDocument(event.target.value)}>
        {[document, ...documents.filter((item) => item.id !== document.id)].map((item) => (
          <option value={item.id} key={item.id}>{item.title}</option>
        ))}
      </select>
      <button className="icon-btn" onClick={onNewDocument} title={t("dashboard.new")}><Plus size={14} /></button>
      <input className="dash-title-input" value={document.title} onChange={(event) => onTitle(event.target.value)} aria-label={t("dashboard.name")} />
      <span className={`dash-save-state ${dirty ? "dirty" : ""}`}>
        {dirty
          ? t("dashboard.unsaved")
          : t(document.status === "published" ? "dashboard.publishedRevision" : "dashboard.draftRevision", { revision: document.revision })}
      </span>
      {!preview && <button className="icon-btn" onClick={onUndo} disabled={!canUndo} title={t("dashboard.undo")}><Undo2 size={14} /></button>}
      {!preview && <div className="dash-widget-palette">{widgetButtons.map((item) => { const Icon = item.icon; return <button key={item.type} onClick={() => onAddWidget(item.type)}><Icon size={13} />{t(`dashboard.widget.${item.type}`)}</button>; })}</div>}
      <span className="toolbar-spacer" />
      <button className="btn sm" onClick={onPreview}>{preview ? <EyeOff size={13} /> : <Eye size={13} />}{preview ? t("dashboard.backToEdit") : t("dashboard.preview")}</button>
      {!preview && (
        <button className="btn sm danger" title="删除这个看板" onClick={onDeleteDashboard}>
          <Trash2 size={13} />删除
        </button>
      )}
      {!preview && (
        <button className="btn primary sm" onClick={onSave} disabled={saving}
          title={storagePath ? `保存到 ${storagePath}` : "保存草稿"}>
          {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}{t("dashboard.saveDraft")}
        </button>
      )}
    </div>
  );
}
