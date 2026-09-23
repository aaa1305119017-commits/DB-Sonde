import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { QueryTab } from "../store/appStore";

export default function SqlRunStatus({ tab }: { tab: QueryTab }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!tab.running) return;
    const timer = setInterval(() => tick(value => value + 1), 250);
    return () => clearInterval(timer);
  }, [tab.running]);
  const progress = tab.runProgress;
  if (!tab.running || !progress) return null;
  const completed = tab.executions.filter(item => !!item.result).length;
  const seconds = (Math.max(0, Date.now() - progress.startedAt) / 1000).toFixed(1);
  const current = tab.executions[progress.currentIndex]?.sql ?? "";
  return <div className="sql-run-overlay">
    <div className="sql-run-status" role="status" aria-live="polite" title={current}>
      <div className="sql-run-summary">
        <Loader2 size={18} className="spin"/>
        <strong>{progress.total > 1 ? `正在执行第 ${progress.currentIndex + 1} / ${progress.total} 条语句` : "正在执行 SQL"}</strong>
      </div>
      <div className="sql-run-detail"><span className="sql-run-timer">{seconds} 秒</span><span>已完成 {completed} / {progress.total} 条</span></div>
      <div className="sql-run-track"><span/></div>
    </div>
  </div>;
}
