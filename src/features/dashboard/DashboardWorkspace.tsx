import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import WidgetDataPanel from "./components/WidgetDataPanel";
import { resolveSemanticDocument } from "./semantic";
import { widgetTitle } from "./widgetFactory";
import * as service from "./dashboardService";
import * as transfer from "./transfer";
import { clearQueryCache } from "./query";
import { downloadOfflineHtml } from "./export/offlineHtml";
import DashboardControlStrip from "./components/DashboardControlStrip";
import { refineAnalysisDashboard } from "./refineAnalysisDashboard";
import AiProvenanceBanner from "./components/AiProvenanceBanner";
import { defaultMetricScope } from "../metrics/queryPlan";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { DashboardTab } from "../../store/appStore";
import { useApp } from "../../store/appStore";
import { useDatasets } from "../datasets/datasetsStore";
import { resolveWidgetDatasets, reuseUnchanged } from "./resolveDatasets";
import {
  createDashboard,
  type DashboardDataset,
  type DashboardDocument,
  type DashboardDrillFilter,
  type DashboardFilter,
  type DashboardWidget,
  type DashboardWidgetType,
} from "./domain";
import { useMetrics } from "../metrics/metricsStore";
import { dashboardRepository } from "./repository";
import { api } from "../../lib/api";
import { useDatasetRuntime, useFilteredRuntime, useDashboardVersions, useComparisonRuntime, useDrillRuntime, useComponentRuntime, mergeCanvasRuntime, nextDrillPath, type ComponentFilterValue, type ComponentFilterValueMap, type DrillPathMap } from "./useDashboardRuntime";
import DashboardCanvas from "./components/DashboardCanvas";
import DashboardToolbar from "./components/DashboardToolbar";
import PageStructureRail from "./components/PageStructureRail";
import WidgetInspector from "./components/WidgetInspector";
import { useI18n } from "../../hooks/useI18n";
import { activeDashboardFilters, type DashboardFilterValues } from "./filtering";
import { useDashboardHistory } from "./useDashboardHistory";

export default function DashboardWorkspace({ tab, active = true }: { tab: DashboardTab; active?: boolean }) {
  const { t } = useI18n();
  const centralMetrics = useMetrics(s => s.metrics);
  const [documents, setDocuments] = useState<DashboardDocument[]>([]);
  const [storedDocument, setDocument] = useState<DashboardDocument>();
  const document = useMemo(() => storedDocument ? resolveSemanticDocument(storedDocument, centralMetrics) : undefined, [storedDocument, centralMetrics]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>();
  const [selectedWidgetId, setSelectedWidgetId] = useState<string>();
  const [filterValues, setFilterValues] = useState<DashboardFilterValues>({});
  const [componentFilterValues, setComponentFilterValues] = useState<ComponentFilterValueMap>({});
  const [drill, setDrill] = useState<DashboardDrillFilter>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportingHtml, setExportingHtml] = useState(false);
  const [, setSelectedRevision] = useState<number>();
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(tab.id, dirty);
  const [preview, setPreview] = useState(false);
  const [pageRailOpen, setPageRailOpen] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);
  const {
    canUndo,
    clearHistory,
    rememberCurrent,
    undo: undoHistory,
    updateDocument,
  } = useDashboardHistory(document, setDocument, markDirty);

  // 取数与版本历史:交给专用 hook,组件只保留状态编排。
  /* 取数管线只认「一段 SQL + 一个连接」。组件存的是数据集 id 和它选的维度/度量,
     这里编译成管线要的形状 —— 每个组件一份,因为同一个数据集选不同维度就是不同的
     查询。数据集是全局的,所以它一改,这里跟着重算,所有引用它的看板一起更新。 */
  const globalDatasets = useDatasets((s) => s.datasets);
  // 组件取数要靠这份列表编译 SQL,看板先于数据集面板打开时它还是空的。
  useEffect(() => { useDatasets.getState().ensureLoaded(); }, []);
  const connections = useApp((s) => s.connections);
  /* 上一次的编译结果。没变的那几份要沿用同一个对象,下游的 memo 才拦得住重算。 */
  const compiledRef = useRef<DashboardDataset[]>([]);
  const runtimeDocument = useMemo(() => {
    if (!document) return document;
    const kindOf = (connectionId: string) => connections.find((c) => c.id === connectionId)?.kind;
    const compiled = reuseUnchanged(
      compiledRef.current,
      resolveWidgetDatasets(document.widgets, globalDatasets, kindOf, document.metricScope, document.datasets),
    );
    compiledRef.current = compiled;
    return { ...document, datasets: compiled };
  }, [document, globalDatasets, connections]);

  const [runtime, setRuntime] = useDatasetRuntime(runtimeDocument, centralMetrics, runtimeRevision, t);
  const [filteredRuntime, setFilteredRuntime] = useFilteredRuntime(runtimeDocument, filterValues, drill, runtimeRevision, t);
  const [, setVersions] = useDashboardVersions(document?.id);
  // 多级下钻路径(按 widgetId)。UI 态,不持久化。
  const [drillPaths, setDrillPaths] = useState<DrillPathMap>({});
  const drillRuntime = useDrillRuntime(runtimeDocument, filterValues, drillPaths, runtimeRevision, t);
  const componentRuntime = useComponentRuntime(runtimeDocument, filterValues, componentFilterValues, drillPaths, runtimeRevision, t);
  const comparisonRuntime = useComparisonRuntime(runtimeDocument, filterValues, componentFilterValues, runtimeRevision, t);
  const drillDown = (widgetId: string, value: string) => {
    const widget = document?.widgets.find((w) => w.id === widgetId);
    const dims = widget?.options.chart?.drillDimensions ?? [];
    // 点中的值属于「这个组件现在按什么分组」,不是下钻链里的某一层。
    const bound = widget?.bindings.dimensions?.[0] ?? widget?.bindings.dimension ?? "";
    const next = nextDrillPath(dims, drillPaths[widgetId] ?? [], value, bound);
    if (next) setDrillPaths((current) => ({ ...current, [widgetId]: next }));
  };
  const drillTo = (widgetId: string, level: number) =>
    setDrillPaths((current) => ({ ...current, [widgetId]: (current[widgetId] ?? []).slice(0, level) }));

  useEffect(() => {
    let cancelled = false;
    dashboardRepository.list()
      .then((items) => {
        if (cancelled) return;
        setDocuments(items);
        /* 指名了某个看板却没找到,就别静默显示另一个 —— 那会让人以为"AI 建的看板
           是空的",实际是打开了别的板子。 */
        const requested = tab.documentId ? items.find((item) => item.id === tab.documentId) : undefined;
        if (tab.documentId && !requested) {
          useApp.getState().showToast({ kind: "error", text: `没找到看板 ${tab.documentId},它可能已被删除` });
        }
        /* 没指名看板就给白板。这里原本兜底取 items[0],于是从工具栏每开一次
           「看板设计」都是已存列表里的第一张(通常是 AI 生成的那张),想从头做
           只能一个个删掉它的组件。已存的看板从工具栏的页面列表里挑。 */
        const selected = requested ?? createDashboard(t("dashboard.untitled"));
        setDocument(selected);
        setSelectedDatasetId(selected.datasets[0]?.id);
        setFilterValues(Object.fromEntries(selected.filters.map((filter) => [filter.id, filter.defaultValue ?? ""])));
        /* 白板还没落库,把它的 id 挂到标签页上,切走再回来就会被当成「看板已被删除」
           而报错。等 save() 写进去 —— 那时它才真的存在。 */
        useApp.getState().updateDashboardTab(tab.id, requested
          ? { documentId: selected.id, title: selected.title }
          : { title: selected.title });
      })
      .catch((error) => useApp.getState().showToast({ kind: "error", text: String(error) }))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    /* 只认 tab.id。tab.documentId 是这个 effect 自己在末尾写上去的(新建的白板
       落到标签页上),列进依赖就会立刻再跑一遍、把刚建的板子覆盖掉。
       t 是 i18n 取词函数,只用来给白板起个默认名,不该触发重新加载。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  // 自动刷新:每 refreshInterval 秒触发一次全量重取(bump runtimeRevision)。
  useEffect(() => {
    const seconds = document?.refreshInterval ?? 0;
    if (!seconds || !active) return;
    const id = window.setInterval(() => { clearQueryCache(); setRuntimeRevision((value) => value + 1); }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [document?.refreshInterval, active]);

  const selectedWidget = document?.widgets.find((item) => item.id === selectedWidgetId);

  const undo = () => {
    if (!undoHistory()) return;
    setSelectedWidgetId(undefined);
    useApp.getState().showToast({ kind: "success", text: t("dashboard.undone") });
  };

  const addFilter = () => {
    let failed = false;
    updateDocument((current) => {
      try {
        /* 字段候选来自编译产物(组件当前真在查的那些列);存下来的 document.datasets
           在数据集模型下是空的,拿它去加筛选器只会说「看板还没有数据集」。 */
        const { filters } = service.addFilter({ ...current, datasets: runtimeDocument?.datasets ?? [] }, { datasetId: selectedDatasetId }).doc;
        return { ...current, filters };
      } catch {
        failed = true;
        return current;
      }
    });
    if (failed) useApp.getState().showToast({ kind: "info", text: t("dashboard.filterNeedsDimension") });
  };

  const updateFilter = (filter: DashboardFilter) => {
    setFilterValues((current) => ({ ...current, [filter.id]: "" }));
    updateDocument((current) => service.updateFilter(current, filter));
  };

  const updateWidget = (widget: DashboardWidget, record = true) =>
    updateDocument((current) => service.updateWidget(current, widget), record);

  // 新建组件默认绑定的指标:优先当前选中,否则第一个启用的中心指标。

  /* 下面这些动作的文档改写逻辑都搬进了 dashboardService(纯函数,可单测、
     可被 AI Agent 的 Tool 调用)。组件这里只留 UI 编排:翻译标题、选中新对象、
     出错时弹 toast。 */
  /* edit 只能调一次 —— 它内部生成 nanoid,调两次会得到两个不同的 id,
     选中的就不是刚建出来的那个了。updateDocument 是同步的(见 useDashboardHistory),
     所以在 reducer 里算完顺手把 id 捞出来。 */
  const runEdit = <T,>(edit: (doc: DashboardDocument) => service.Created<T>, onDone?: (id: T) => void) => {
    let created: T | undefined;
    let failed: string | undefined;
    updateDocument((current) => {
      try {
        const result = edit(current);
        created = result.id;
        return result.doc;
      } catch (error) {
        failed = String(error).replace(/^Error:\s*/, "");
        return current;
      }
    });
    if (failed) useApp.getState().showToast({ kind: "error", text: failed });
    else if (created !== undefined) onDone?.(created);
  };

  const addWidget = (type: DashboardWidgetType) =>
    runEdit(
      (doc) => service.addWidget(doc, { type, title: widgetTitle(type, t) }),
      setSelectedWidgetId,
    );

  const addChildWidget = (parentId: string, tabId: string, type: DashboardWidgetType) => {
    if (type === "container") return;
    runEdit(
      (doc) => service.addWidget(doc, { type, title: widgetTitle(type, t), parentId, tabId }),
      setSelectedWidgetId,
    );
  };

  const duplicateWidget = (id: string) => {
    const source = document?.widgets.find((item) => item.id === id);
    if (!source) return;
    runEdit(
      (doc) => service.duplicateWidget(doc, id, t("dashboard.copyName", { name: source.title })),
      setSelectedWidgetId,
    );
  };

  const toggleWidget = (id: string) => updateDocument((current) => service.toggleWidget(current, id));

  const deleteWidget = (id: string) => updateDocument((current) => service.deleteWidget(current, id));

  const save = async () => {
    if (!document || saving) return;
    setSaving(true);
    try {
      const next = { ...document, revision: dirty ? document.revision + 1 : document.revision, updatedAt: new Date().toISOString() };
      const saved = await dashboardRepository.save(next);
      setDocument(saved);
      setDocuments((items) => items.some((item) => item.id === saved.id)
        ? items.map((item) => item.id === saved.id ? saved : item)
        : [...items, saved]);
      setDirty(false);
      clearHistory();
      useApp.getState().updateDashboardTab(tab.id, { documentId: saved.id, title: saved.title });
      useApp.getState().showToast({ kind: "success", text: t("dashboard.saved") });
    } catch (error) {
      useApp.getState().showToast({ kind: "error", text: String(error) });
    } finally {
      setSaving(false);
    }
  };

  // 注:「发布 / 版本回滚」UI 已按用户要求移除(觉得没用)。仓库层与 Rust 端的
  // publish / list_dashboard_versions 仍保留,想恢复只需把 VersionControls 接回来。

  /**
   * 把编辑器整个切到另一份文档上。
   *
   * 「选一页」「新建」「导入」原来各写了一遍同样的十几行清空 —— 一旦加了新的
   * UI 态(下钻路径、组件级筛选就是后加的),只要漏改一处就会带着上一份看板的
   * 残留进新文档,而且看起来一切正常。合成一个入口。
   */
  const openDocument = (next: DashboardDocument, opts: { dirty: boolean }) => {
    setDocument(next);
    setSelectedDatasetId(next.datasets[0]?.id);
    setSelectedWidgetId(undefined);
    setRuntime({});
    setFilteredRuntime({});
    setVersions([]);
    setSelectedRevision(undefined);
    setFilterValues(Object.fromEntries((next.filters ?? []).map((filter) => [filter.id, filter.defaultValue ?? ""])));
    setDrill(undefined);
    setDrillPaths({});
    setComponentFilterValues({});
    clearHistory();
    setDirty(opts.dirty);
    useApp.getState().updateDashboardTab(tab.id, { documentId: next.id, title: next.title });
  };

  const selectDocument = (id: string) => {
    if (dirty && !window.confirm(t("dashboard.confirmSwitch"))) return;
    const next = documents.find((item) => item.id === id);
    if (next) openDocument(next, { dirty: false });
  };

  const newDocument = () => {
    if (dirty && !window.confirm(t("dashboard.confirmNew"))) return;
    openDocument(createDashboard(t("dashboard.untitled")), { dirty: true });
  };

  const renameDocument = (id: string) => {
    const target = document?.id === id ? document : documents.find((item) => item.id === id);
    if (!target) return;
    const title = window.prompt("重命名页面", target.title)?.trim();
    if (!title) return;
    if (document?.id === id) {
      updateDocument((current) => ({ ...current, title }));
      useApp.getState().updateDashboardTab(tab.id, { title });
    } else {
      void dashboardRepository.save({ ...target, title, updatedAt: new Date().toISOString() })
        .then((saved) => setDocuments((items) => items.map((item) => (item.id === id ? saved : item))))
        .catch((error) => useApp.getState().showToast({ kind: "error", text: String(error) }));
    }
  };

  const [storagePath, setStoragePath] = useState("");
  useEffect(() => { void api.dashboardStoragePath().then(setStoragePath).catch(() => setStoragePath("")); }, []);

  /* 最后一张也能删 —— 删完开一张空白的。原来这里直接 return,按钮点了没反应,
     人只会以为「这软件不让删」。 */
  const deleteDocument = (id: string) => {
    const target = documents.find((item) => item.id === id) ?? (document?.id === id ? document : undefined);
    if (!target || !window.confirm(`删除“${target.title || "未命名看板"}”?其草稿、发布版本与历史都会移除,不可恢复。`)) return;
    void dashboardRepository.delete(id)
      .then(() => {
        const rest = documents.filter((item) => item.id !== id);
        setDocuments(rest);
        useApp.getState().showToast({ kind: "success", text: "页面已删除" });
        if (document?.id === id) {
          const next = rest[0];
          if (next) selectDocument(next.id);
          else newDocument();
        }
      })
      .catch((error) => useApp.getState().showToast({ kind: "error", text: String(error) }));
  };

  const exportJson = () => { if (document) transfer.downloadJson(document); };

  const exportHtml = async () => {
    if (!document || exportingHtml) return;
    if (document.widgets.length === 0) {
      useApp.getState().showToast({ kind: "info", text: t("dashboard.publishNeedsWidget") });
      return;
    }
    setExportingHtml(true);
    useApp.getState().showToast({ kind: "info", text: "正在烘焙数据并生成离线网页…" });
    try {
      /* 导出要的是取数用的那份 —— 组件选的数据集和维度已经编译成 SQL,原始文档里
         没有这些,传它导出的会是一张空板。 */
      const { mb, savedToFiles, warnings } = await downloadOfflineHtml(runtimeDocument ?? document, centralMetrics, t);
      useApp.getState().showToast({ kind: "success", text: `离线网页已导出(约 ${mb} MB)${savedToFiles ? " · 已存入「文件」,可随时导回编辑" : ""}` });
      warnings.slice(0, 4).forEach((w) => useApp.getState().showToast({ kind: "info", text: w }));
    } catch (error) {
      useApp.getState().showToast({ kind: "error", text: `导出失败:${String(error)}` });
    } finally {
      setExportingHtml(false);
    }
  };

  const importJson = () => {
    void transfer.pickDashboardFile()
      .then((picked) => {
        if (!picked) return;
        openDocument(picked.doc, { dirty: true });
        useApp.getState().showToast({ kind: "success", text: picked.from === "html"
          ? "已从导出的网页还原看板,可继续编辑"
          : "看板已导入,请检查后保存" });
      })
      .catch((error) => useApp.getState().showToast({ kind: "error", text: `导入失败:${String(error)}` }));
  };

  const canvasRuntime = useMemo(() => {
    if (!runtimeDocument) return runtime;
    /* 这里必须用编译后的文档:运行时结果是按编译出的数据集(每个组件一份)存的,而原始
       文档里 datasets 是空的 —— 拿它来合,合出来就是一张空表,每个组件都取不到数据,
       画布上永远停在「运行数据集并绑定字段后显示」。 */
    return mergeCanvasRuntime(
      runtimeDocument,
      { runtime, filteredRuntime, drillRuntime, componentRuntime, comparisonRuntime },
      (dataset) => activeDashboardFilters(dataset, runtimeDocument.filters, filterValues, drill),
    );
  }, [runtimeDocument, runtime, filteredRuntime, comparisonRuntime, drillRuntime, componentRuntime, filterValues, drill]);
  if (loading || !document) return <div className="object-state"><Loader2 size={18} className="spin" />{t("dashboard.loading")}</div>;

  return (
    <div className={`dashboard-workspace ${preview ? "preview" : ""}`}>
      <DashboardToolbar
        document={document}
        documents={documents}
        dirty={dirty}
        saving={saving}
        preview={preview}
        canUndo={canUndo}
        onTitle={(title) => updateDocument((current) => ({ ...current, title }))}
        onSelectDocument={selectDocument}
        onNewDocument={newDocument}
        onAddWidget={addWidget}
        onPreview={() => { setSelectedWidgetId(undefined); setPreview((value) => !value); }}
        onUndo={undo}
        onSave={() => void save()}
        onDeleteDashboard={() => { if (document) deleteDocument(document.id); }}
        storagePath={storagePath}
      />
      <DashboardControlStrip
        document={document}
        preview={preview}
        pageRailOpen={pageRailOpen}
        exportingHtml={exportingHtml}
        runtime={runtime}
        filterValues={filterValues}
        drill={drill}
        onTogglePageRail={() => setPageRailOpen((v) => !v)}
        onImport={importJson}
        onExportJson={exportJson}
        onExportHtml={() => void exportHtml()}
        onRefresh={() => setRuntimeRevision((v) => v + 1)}
        onPatch={(patch) => updateDocument((current) => ({ ...current, ...patch }))}
        onAddFilter={addFilter}
        onChangeFilter={updateFilter}
        onRemoveFilter={(id) => {
          setFilterValues((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
          updateDocument((current) => ({ ...current, filters: current.filters.filter((item) => item.id !== id) }));
        }}
        onFilterValue={(id, value) => setFilterValues((current) => ({ ...current, [id]: value }))}
        onClearDrill={() => setDrill(undefined)}
      />
      <div className={`dashboard-layout${!preview && pageRailOpen ? " with-rail" : ""}`}>
        {!preview && pageRailOpen && (
          <PageStructureRail
            documents={documents}
            activeId={document.id}
            dirty={dirty}
            onSelect={selectDocument}
            onNew={newDocument}
            onRename={renameDocument}
            onDelete={deleteDocument}
            onClose={() => setPageRailOpen(false)}
          />
        )}
        {!preview && (
          <WidgetDataPanel widget={selectedWidget} scope={document.metricScope ?? defaultMetricScope()} onChange={updateWidget} />
        )}
        <main className="dash-canvas-shell">
          {document.aiProvenance && <AiProvenanceBanner provenance={document.aiProvenance}
            onOptimize={!preview && !document.widgets.some((w) => w.type === "container" || w.parentId) ? () => {
              updateDocument((current) => refineAnalysisDashboard(current, centralMetrics));
              useApp.getState().showToast({ kind: "success", text: "版式已优化，可撤销。保存后保留这些修改。" });
            } : undefined} />}
          <DashboardCanvas
          widgetReasons={document.aiProvenance?.widgetReasons}
            widgets={document.widgets}
            datasets={runtimeDocument?.datasets ?? []}
            metrics={document.metrics}
            runtime={canvasRuntime}
            scope={document.metricScope ?? defaultMetricScope()}
            componentFilterValues={componentFilterValues}
            onComponentFiltersChange={(widgetId: string, value: ComponentFilterValue) => setComponentFilterValues((current) => ({ ...current, [widgetId]: value }))}
            selectedId={selectedWidgetId}
            preview={preview}
            onSelect={(id) => setSelectedWidgetId(id || undefined)}
            onChange={(widget) => updateWidget(widget, false)}
            onInteractionStart={rememberCurrent}
            onDelete={deleteWidget}
            onDuplicate={duplicateWidget}
            onToggle={toggleWidget}
            onAddChild={addChildWidget}
            onDrill={setDrill}
            drillPaths={drillPaths}
            onDrillDown={drillDown}
            onDrillTo={drillTo}
          />
        </main>
        {!preview && <WidgetInspector widget={selectedWidget} datasets={runtimeDocument?.datasets ?? []} metrics={document.metrics} onChange={updateWidget} />}
      </div>

    </div>
  );
}
