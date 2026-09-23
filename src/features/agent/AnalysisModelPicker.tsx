import { useId } from "react";
import { useAi } from "../ai/aiStore";
import { useModelDiscovery } from "../ai/useModelDiscovery";
import { bindingFor } from "./model/modelRouting";
import { analysisRoles, PROVIDER_LABELS, analysisModelConfig, type AnalysisModelChoice } from "./model/analysisModels";

export default function AnalysisModelPicker({ choice, wantsDashboard, onChange }: {
  choice?: AnalysisModelChoice;
  wantsDashboard: boolean;
  onChange: (choice?: AnalysisModelChoice) => void;
}) {
  const config = useAi((s) => s.config);
  const listId = useId();
  const selected = analysisModelConfig(config, choice);
  const discovery = useModelDiscovery(choice ? {
    provider: choice.provider, baseUrl: config[choice.provider].baseUrl,
    apiKey: choice.provider === "cloud" ? config.cloud.apiKey : undefined,
  } : null);
  const error = discovery.error ?? (discovery.loaded && !discovery.models.length ? "服务没有返回模型清单，可以直接填写模型名称。" : null);
  return <div className="an-model-picker">
    <select className="input" aria-label="分析模型来源" value={choice?.provider ?? "auto"}
      onChange={(event) => {
        const provider = event.target.value;
        if (provider === "auto") onChange(undefined);
        else if (provider === "cloud" || provider === "local" || provider === "builtin") onChange({ provider, model: /^deepseek-/i.test(config[provider].model) ? "deepseek-flash" : config[provider].model });
      }}>
      <option value="auto">自动选择（DeepSeek 默认 Flash）</option>
      <option value="cloud">云端模型</option><option value="local">本地服务模型</option><option value="builtin">内置模型</option>
    </select>
    {choice && <div className="an-model-entry">
      <input className="input" aria-label="分析模型名称" list={listId} value={choice.model} placeholder="选择或填写模型名称"
        onChange={(event) => onChange({ ...choice, model: event.target.value })}/>
      <datalist id={listId}>{discovery.models.map((model) => <option key={model} value={model}/>)}</datalist>
      <button className="an-text-button" disabled={discovery.loading} onClick={() => void discovery.load()}>{discovery.loading ? "读取中…" : "读取模型列表"}</button>
    </div>}
    {error && <p className="an-dim" role="status">{error}</p>}
    <div className="an-model-routing">{analysisRoles(wantsDashboard).map(({ role, label }) => {
      const binding = bindingFor(role, selected);
      return <div key={role}><span>{label}</span><b>{PROVIDER_LABELS[binding.provider]} · {binding.model || "未选择"}</b></div>;
    })}</div>
    {wantsDashboard && <div className="an-model-routing"><div><span>成品截图观察</span><b>{selected.designVision?.enabled ? selected.designVision.model : "未配置图片模型"}</b></div><small>观察模型只描述截图；评分与修改由看板设计模型负责。</small></div>}
    <button className="an-text-button" onClick={() => { useAi.getState().openPanel(); useAi.getState().openSettings(); }}>AI 连接设置</button>
  </div>;
}
