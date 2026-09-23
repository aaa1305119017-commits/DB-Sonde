import {
  Loader2,
  TableProperties
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useI18n } from "../hooks/useI18n";
import { useApp } from "../store/appStore";
import DatabaseBrowser from "./DatabaseBrowser";
import PanelErrorBoundary from "./PanelErrorBoundary";
import PythonPanel from "./PythonPanel";
import SqlWorkspace from "./SqlWorkspace";
import TableInspector from "./TableInspector";
import WorkspaceTabBar from "./WorkspaceTabBar";

const RoutineWorkspace = lazy(() => import("./RoutineWorkspace"));
const DashboardWorkspace = lazy(() => import("../features/dashboard/DashboardWorkspace"));
const AnalysisWorkspace = lazy(() => import("../features/agent/AnalysisWorkspace"));


export default function QueryPanel() {
  const tabs = useApp(s => s.tabs);
  const activeTabId = useApp(s => s.activeTabId);
  const [visited, setVisited] = useState<Set<string>>(() => new Set(activeTabId ? [activeTabId] : []));
  useEffect(() => {
    if (activeTabId) setVisited(previous => new Set([...previous, activeTabId]));
    // Restoring or switching tabs is not consent to connect to a database.
  }, [activeTabId]);
  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      const current = useApp.getState();
      const tab = current.tabs.find(t => t.id === current.activeTabId);
      if (tab?.kind !== "query") return;
      event.preventDefault(); current.saveTab(tab.id);
    };
    window.addEventListener("keydown", save);
    return () => window.removeEventListener("keydown", save);
  }, []);
  return <div className="main"><WorkspaceTabBar />
    {tabs.length === 0 && <div className="empty-main">打开一个数据库、表或 SQL 脚本开始工作</div>}
    {tabs.filter(tab => tab.id === activeTabId || visited.has(tab.id)).map(tab =>
      <div className="workspace-pane" key={tab.id} style={{ display: tab.id === activeTabId ? "flex" : "none" }}>
        <PanelErrorBoundary name={tab.title}><WorkspaceContent tabId={tab.id} active={tab.id === activeTabId} /></PanelErrorBoundary>
      </div>)}
  </div>;
}

function WorkspaceContent({ tabId, active }: { tabId: string; active: boolean; }) {
  const { t } = useI18n();
  const tab = useApp(s => s.tabs.find(t => t.id === tabId));
  const connected = useApp(s => tab ? !!s.meta[tab.connId] : false);
  if (!tab) {
    return (
      <div className="main">
        <div className="empty-main">
          <div>
            <TableProperties size={34} style={{ color: "var(--text-3)" }} />
            <p style={{ marginTop: 12 }}>
              {t("query.empty")}
              <br />
              {t("query.runShortcut")} <span className="kbd">⌘ ⏎</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if ((tab.kind === "database" || tab.kind === "table" || tab.kind === "routine") && !connected) {
    return <div className="main"><div className="result-placeholder"><p>{tab.connName} · {tab.database}</p><button className="btn primary" onClick={() => void useApp.getState().connect(tab.connId).catch(() => { })}>连接并打开页面</button></div></div>;
  }
  if (tab.kind === "routine") return <Suspense fallback={<div className="object-state">正在加载…</div>}><RoutineWorkspace tab={tab} /></Suspense>;
  if (tab.kind === "database") {
    return <div className="main"><DatabaseBrowser tab={tab} active={active} /></div>;
  }

  if (tab.kind === "table") {
    return <div className="main"><TableInspector tab={tab} /></div>;
  }

  if (tab.kind === "python") {
    return <div className="main"><PythonPanel tab={tab} /></div>;
  }

  if (tab.kind === "analysis") {
    return (
      <div className="main">
        <Suspense fallback={<div className="object-state"><Loader2 size={18} className="spin" />载入中…</div>}>
          <AnalysisWorkspace tab={tab} />
        </Suspense>
      </div>
    );
  }

  if (tab.kind === "dashboard") {
    return (
      <div className="main">
        <Suspense fallback={<div className="object-state"><Loader2 size={18} className="spin" />{t("dashboard.loading")}</div>}>
          <DashboardWorkspace tab={tab} active={active} />
        </Suspense>
      </div>
    );
  }

  return <SqlWorkspace tab={tab} />;
}
