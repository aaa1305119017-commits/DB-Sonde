import { TriangleAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import { getStorageProblems, subscribeStorageProblems } from "../lib/jsonStorage";

const labels: Record<string, string> = {
  "ai.config": "AI 设置",
  "scheduler.conns.v1": "调度连接设置",
  "sonde.analysis.v1": "分析配置",
  "sonde.analysis.flash-default.v1": "分析模型迁移记录",
  theme: "界面主题", language: "界面语言", sidebarWidth: "侧栏宽度", resultHeight: "结果区高度",
  "sonde.workspace.v1": "工作区",
  "sonde.savedQueries.v1": "已保存脚本",
  "sonde.connOrder.v1": "连接顺序",
  "sonde.nodeOrder.v1": "目录顺序",
  "sonde.hiddenNodes.v1": "隐藏项目",
  "sonde.metrics.v1": "指标目录",
  "sonde.etlSources.v1": "ETL 来源",
};

/** Failures remain discoverable until the affected storage operation succeeds. */
export default function StorageNotice() {
  const problems = useSyncExternalStore(subscribeStorageProblems, getStorageProblems);
  if (!problems.length) return null;
  return <details className="storage-notice">
    <summary><TriangleAlert size={14} aria-hidden="true" /><span role="status">本地保存需要处理 · {problems.length} 项</span><span>查看详情</span></summary>
    <div className="storage-notice-body">
      {problems.map(issue => <div key={issue.key}>
        <strong>{labels[issue.key] ?? issue.key}</strong>
        <p>{issue.kind === "read"
          ? "无法读取原有配置，已保留原始内容并暂停覆盖。请恢复有效配置后重新打开软件。"
          : "本次修改尚未保存。请检查可用空间和访问权限，然后重新执行刚才的保存操作。"}</p>
        <details><summary>存储位置</summary><code>{issue.key}</code></details>
      </div>)}
    </div>
  </details>;
}
