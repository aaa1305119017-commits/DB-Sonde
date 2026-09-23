import { Sparkles } from "lucide-react";
import type { DashboardProvenance } from "../domain";

/**
 * 「这个看板是 AI 建的」横幅。
 *
 * 存在的理由:过两周没人记得这板子是怎么冒出来的、那几个图为什么这么选。
 * 人工建的看板没有 aiProvenance 这个字段,横幅不出现。
 *
 * 自动修了什么、还剩什么没修,都摆在明面上 —— 这是 Reviewer 那套「如实报告」
 * 在界面上的落点:自动修过的地方用户有权知道,没修成的更不能藏。
 */
export default function AiProvenanceBanner({ provenance, onOptimize }: { provenance: DashboardProvenance; onOptimize?: () => void }) {
  return (
    <div className="dash-ai-banner">
      <Sparkles size={13} />
      <div className="dash-ai-banner-body">
        <div className="dash-ai-banner-heading"><b>AI 分析看板</b>
          <span className="dim">{provenance.openIssues?.length ? `${provenance.openIssues.length} 项验收提醒` : "查看分析来源与验收记录"}</span>
          {onOptimize && <button className="btn sm" onClick={onOptimize}>优化版式</button>}
        </div>
        <details><summary>分析来源与验收详情</summary>
        <span>出自你的这句话:「{provenance.userRequest}」</span>
        {provenance.autoFixed?.length ? <span>验收时自动修正:{provenance.autoFixed.join(";")}</span> : null}
        {provenance.openIssues?.length ? (
          <span className="warn">还有没处理的:{provenance.openIssues.join(";")}</span>
        ) : null}
        <span className="dim">
          {provenance.createdAt.slice(0, 19).replace("T", " ")}
          {provenance.model ? ` · ${provenance.model}` : ""}
          {" · 组件标题旁的 ✨ 悬停可看它为什么这么建"}
        </span>
        </details>
      </div>
    </div>
  );
}
