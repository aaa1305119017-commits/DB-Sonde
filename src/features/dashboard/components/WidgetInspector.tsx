import { pieRadii } from "../pieGeometry";
import { useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import { nanoid } from "nanoid";
import { useI18n } from "../../../hooks/useI18n";
import { DEFAULT_DASHBOARD_PALETTE, type DashboardAppearanceOptions, type DashboardChartOptions, type DashboardContainerOptions, type DashboardDataset, type DashboardKpiOptions, type DashboardMetricDefinition, type DashboardTableOptions, type DashboardTextOptions, type DashboardWidget } from "../domain";
import { datasetOf } from "../resolveDatasets";

const VISUAL_PRESETS = ["editorial", "aurora", "ocean", "violet", "sunset", "glass", "gold", "jade", "rose", "ember", "cyber", "slate", "mint", "amber", "plum", "coral", "indigo"];
type InspectorTab = "content" | "interaction" | "style";

interface Props {
  widget?: DashboardWidget;
  datasets: DashboardDataset[];
  metrics: DashboardMetricDefinition[];
  onChange: (widget: DashboardWidget) => void;
}

export default function WidgetInspector({ widget, datasets, metrics, onChange }: Props) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<InspectorTab>("content");
  /* 运行时数据集按组件 id 存 —— 按 widget.datasetId(全局数据集 id)是找不着的,
     下面的下钻维度、维度中文名都会空掉。 */
  const dataset = widget ? datasetOf(widget, datasets) : undefined;
  if (!widget) {
    return <aside className="dash-inspector"><div className="dash-panel-title"><SlidersHorizontal size={14} />{t("dashboard.widgetSettings")}</div><div className="dash-inspector-empty">{t("dashboard.selectWidget")}</div></aside>;
  }
  const dimensions = dataset?.fields.filter((field) => field.role === "dimension") ?? [];
  /** 维度的中文显示名(指标中心配置);缺省回落到字段名。 */
  const dimLabel = (name: string) => dataset?.dimensionLabels?.[name] || name;
  const patch = (change: Partial<DashboardWidget>) => onChange({ ...widget, ...change });
  const to = widget.options.table ?? {};
  const patchTable = (change: Partial<DashboardTableOptions>) => patch({ options: { ...widget.options, table: { ...to, ...change } } });
  // 明细表维度布局:只针对已绑定的分析维度(对齐 v1 的 draft.dimensions)。
  const boundDims = widget.bindings.dimensions?.length
    ? widget.bindings.dimensions
    : (widget.bindings.dimension ? [widget.bindings.dimension] : []);
  const co = widget.options.chart ?? {};
  const patchChart = (change: Partial<DashboardChartOptions>) => patch({ options: { ...widget.options, chart: { ...co, ...change } } });
  const palette = co.palette ?? [...DEFAULT_DASHBOARD_PALETTE];
  const isChart = widget.type === "line" || widget.type === "bar" || widget.type === "pie";
  const ko = widget.options.kpi ?? {};
  const patchKpi = (change: Partial<DashboardKpiOptions>) => patch({ options: { ...widget.options, kpi: { ...ko, ...change } } });
  // 指标组编辑(displayMode=group_switch):从当前绑定的指标里挑选归组。
  const groups = ko.metricGroups ?? [];
  /* 指标组的成员 id 要和渲染层解析出来的 key 对上:绑定指标中心指标时是指标 id,
     绑数据集度量时是 "field:<字段名>"(见 metrics.ts)。以前这里只列前者,数据集
     组件打开分组切换就是一片空白。 */
  const boundMetrics = widget.bindings.metricIds.length
    ? metrics.filter((m) => widget.bindings.metricIds.includes(m.id) && m.datasetId === widget.datasetId).map((m) => ({ id: m.id, name: m.name }))
    : (widget.bindings.measures ?? []).map((field) => ({ id: `field:${field}`, name: dataset?.dimensionLabels?.[field] || field }));
  // 图表版指标组(写入 chart 选项),与 KPI 版并行。
  const cGroups = co.metricGroups ?? [];
  const tx = widget.options.text ?? {};
  const patchText = (change: Partial<DashboardTextOptions>) => patch({ options: { ...widget.options, text: { ...tx, ...change } } });
  const cont = widget.options.container ?? {};
  const patchContainer = (change: Partial<DashboardContainerOptions>) => patch({ options: { ...widget.options, container: { ...cont, ...change } } });
  const ap = widget.options.appearance ?? {};
  const patchAp = (change: Partial<DashboardAppearanceOptions>) => patch({ options: { ...widget.options, appearance: { ...ap, ...change } } });
  const dataWidget = widget.type !== "text" && widget.type !== "container";
  const nf = widget.options.numberFormat ?? {};
  const patchNf = (change: Partial<typeof nf>) => patch({ options: { ...widget.options, numberFormat: { ...nf, ...change } } });
  const axis = co.axis ?? {};
  const patchAxis = (change: Partial<typeof axis>) => patchChart({ axis: { ...axis, ...change } });
  const patchMarkLine = (index: number, change: Partial<{ value: number; label: string }>) =>
    patchChart({ markLine: (co.markLine ?? []).map((line, i) => (i === index ? { ...line, ...change } : line)) });
  const mode = widget.type === "kpi" ? (ko.displayMode ?? "all") : (co.displayMode ?? "all");
  const modeGroups = widget.type === "kpi" ? groups : cGroups;
  const patchMode = (change: { displayMode?: DashboardKpiOptions["displayMode"]; metricGroups?: typeof groups }) => {
    if (widget.type === "kpi") patchKpi(change);
    else patchChart(change);
  };
  const addModeGroup = () => patchMode({ metricGroups: [...modeGroups, { id: `grp-${nanoid(6)}`, label: `分组 ${modeGroups.length + 1}`, metricIds: [] }] });
  const updateModeGroup = (id: string, change: Partial<{ label: string; metricIds: string[] }>) => patchMode({ metricGroups: modeGroups.map((group) => group.id === id ? { ...group, ...change } : group) });
  return (
    <aside className="dash-inspector">
      <div className="dash-panel-title"><SlidersHorizontal size={14} />{widget.title}</div>
      <div className="dash-inspector-tabs" role="tablist" aria-label="组件设置分类">
        <button role="tab" aria-selected={activeTab === "content"} className={activeTab === "content" ? "on" : ""} onClick={() => setActiveTab("content")}>基础</button>
        <button role="tab" aria-selected={activeTab === "interaction"} className={activeTab === "interaction" ? "on" : ""} onClick={() => setActiveTab("interaction")}>筛选与交互</button>
        <button role="tab" aria-selected={activeTab === "style"} className={activeTab === "style" ? "on" : ""} onClick={() => setActiveTab("style")}>样式</button>
      </div>
      <div className="dash-inspector-body">
        {activeTab === "content" && <section><strong>{t("dashboard.basic")}</strong>
          <label>{t("dashboard.widgetName")}<input value={widget.title} onChange={(event) => patch({ title: event.target.value })} /></label>
          {/* 这里曾经有个「历史查询」下拉,让人在文档内的数据集之间切。数据集改成全局
              之后,它列的是编译产物(每个组件一份、id 就是组件 id),选一下等于把 datasetId
              指到一个不存在的数据集上,组件当场取不到数。挑数据集是下面绑定区的事。 */}
          <label>副标题<input value={widget.subtitle ?? ""} placeholder="标题下的一行小字,写清口径/范围" onChange={(event) => patch({ subtitle: event.target.value })} /></label>
          <label>脚注<input value={widget.footnote ?? ""} placeholder="卡片底部,如「数据截至昨日」" onChange={(event) => patch({ footnote: event.target.value })} /></label>
          <label className="dash-check"><input type="checkbox" checked={widget.visible} onChange={(event) => patch({ visible: event.target.checked })} />{t("dashboard.visible")}</label>
        </section>}
        {activeTab === "style" && dataWidget && <section><strong>数字显示</strong>
          <label>单位换算
            <select value={nf.scale ?? "none"} onChange={(e) => patchNf({ scale: e.target.value as "none" | "wan" | "yi" })}>
              <option value="none">原样</option><option value="wan">万</option><option value="yi">亿</option>
            </select>
          </label>
          <div className="dash-color-row">
            <label>前缀<input value={nf.prefix ?? ""} placeholder="如 ¥" onChange={(e) => patchNf({ prefix: e.target.value })} /></label>
            <label>后缀<input value={nf.suffix ?? ""} placeholder="留空=换算词+指标单位" onChange={(e) => patchNf({ suffix: e.target.value })} /></label>
          </div>
        </section>}
        {activeTab === "style" && (widget.type === "line" || widget.type === "bar") && <section><strong>坐标轴与提示</strong>
          <div className="dash-color-row">
            <label>Y 轴最小<input type="number" value={axis.yMin ?? ""} placeholder="自适应" onChange={(e) => patchAxis({ yMin: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
            <label>Y 轴最大<input type="number" value={axis.yMax ?? ""} placeholder="自适应" onChange={(e) => patchAxis({ yMax: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
          </div>
          <div className="dash-color-row">
            <label>Y 轴标题<input value={axis.yTitle ?? ""} placeholder="默认取指标单位" onChange={(e) => patchAxis({ yTitle: e.target.value })} /></label>
            <label>X 轴标题<input value={axis.xTitle ?? ""} onChange={(e) => patchAxis({ xTitle: e.target.value })} /></label>
          </div>
          <label className="dash-check"><input type="checkbox" checked={axis.splitLine === true} onChange={(e) => patchAxis({ splitLine: e.target.checked })} />显示横向网格线</label>
          <label>悬停提示
            <select value={co.tooltip?.mode ?? "axis"} onChange={(e) => patchChart({ tooltip: { mode: e.target.value as "item" | "axis" } })}>
              <option value="axis">同一位置的所有系列</option><option value="item">只看当前这根</option>
            </select>
          </label>
          <strong style={{ marginTop: 6 }}>参考线</strong>
          {(co.markLine ?? []).map((line, i) => (
            <div className="dash-color-row" key={i}>
              <label>值<input type="number" value={line.value} onChange={(e) => patchMarkLine(i, { value: Number(e.target.value) })} /></label>
              <label>说明<input value={line.label ?? ""} placeholder="如 目标" onChange={(e) => patchMarkLine(i, { label: e.target.value })} /></label>
              <button className="btn sm danger" onClick={() => patchChart({ markLine: (co.markLine ?? []).filter((_, j) => j !== i) })}>删</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => patchChart({ markLine: [...(co.markLine ?? []), { value: 0, label: "" }] })}>+ 加一条参考线</button>
        </section>}
        {activeTab === "style" && <section><strong>外观</strong>
          <div className="dash-color-row">
            <label>背景<input type="color" value={ap.background ?? "#141a24"} onChange={(e) => patchAp({ background: e.target.value })} /></label>
            <label>正文色<input type="color" value={ap.textColor ?? "#e8edf6"} onChange={(e) => patchAp({ textColor: e.target.value })} /></label>
          </div>
          <div className="dash-color-row">
            <label>标题色<input type="color" value={ap.titleColor ?? "#e8edf6"} onChange={(e) => patchAp({ titleColor: e.target.value })} /></label>
            <label>边框色<input type="color" value={ap.borderColor ?? "#212b3c"} onChange={(e) => patchAp({ borderColor: e.target.value })} /></label>
          </div>
          <div className="dash-color-row">
            <label>圆角<input type="number" min={0} max={40} value={ap.radius ?? 12} onChange={(e) => patchAp({ radius: Number(e.target.value) })} /></label>
            <label>边框宽<input type="number" min={0} max={6} value={ap.borderWidth ?? 1} onChange={(e) => patchAp({ borderWidth: Number(e.target.value) })} /></label>
          </div>
          <div className="dash-color-row">
            <label>内边距<input type="number" min={0} max={40} value={ap.padding ?? 12} onChange={(e) => patchAp({ padding: Number(e.target.value) })} /></label>
            <label>标题字号<input type="number" min={10} max={48} value={ap.titleSize ?? 14} onChange={(e) => patchAp({ titleSize: Number(e.target.value) })} /></label>
          </div>
          <label>标题对齐
            <select value={ap.titleAlign ?? "left"} onChange={(e) => patchAp({ titleAlign: e.target.value as DashboardAppearanceOptions["titleAlign"] })}>
              <option value="left">靠左</option>
              <option value="center">居中</option>
              <option value="right">靠右</option>
            </select>
          </label>
          <label className="dash-check"><input type="checkbox" checked={ap.shadow ?? false} onChange={(e) => patchAp({ shadow: e.target.checked })} />投影</label>
          <label className="dash-check"><input type="checkbox" checked={ap.hideTitle ?? false} onChange={(e) => patchAp({ hideTitle: e.target.checked })} />查看模式隐藏标题栏</label>
          <div className="dash-preset-field">视觉预设
            <div className="dash-preset-grid">
              <button className={`dash-preset-swatch none ${!ap.visualPreset || ap.visualPreset === "none" ? "on" : ""}`} data-visual-preset="none" title="无" onClick={() => patchAp({ visualPreset: undefined })}>无</button>
              {VISUAL_PRESETS.map((p) => (
                <button key={p} className={`dash-preset-swatch ${ap.visualPreset === p ? "on" : ""}`} data-visual-preset={p} title={p === "editorial" ? "简洁分析" : p} onClick={() => patchAp({ visualPreset: p })} />
              ))}
            </div>
          </div>
          <button className="btn sm" onClick={() => patch({ options: { ...widget.options, appearance: {} } })}>重置外观</button>
        </section>}
        {activeTab === "content" && widget.type === "container" && (
          <section><strong>{t("dashboard.tabs")}</strong>
            <div className="dash-tab-editor">
              {widget.tabs.map((tab, index) => <label key={tab.id}>{t("dashboard.tabNumber", { number: index + 1 })}<input value={tab.label} onChange={(event) => patch({ tabs: widget.tabs.map((item) => item.id === tab.id ? { ...item, label: event.target.value } : item) })} /></label>)}
              <button className="btn sm" onClick={() => patch({ tabs: [...widget.tabs, { id: `tab-${nanoid(8)}`, label: t("dashboard.tabNumber", { number: widget.tabs.length + 1 }) }] })}><Plus size={13} />{t("dashboard.addTab")}</button>
            </div>
            <label>Tab 栏位置
              <select value={cont.tabPosition ?? "top"} onChange={(e) => patchContainer({ tabPosition: e.target.value as DashboardContainerOptions["tabPosition"] })}>
                <option value="top">顶部</option>
                <option value="left">左侧</option>
              </select>
            </label>
            <label className="dash-check"><input type="checkbox" checked={cont.showTabBar !== false} onChange={(e) => patchContainer({ showTabBar: e.target.checked })} />查看模式显示 Tab 栏</label>
          </section>
        )}
        {activeTab === "content" && widget.type === "text" && (
          <section><strong>{t("dashboard.textContent")}</strong>
            <label>{t("dashboard.content")}<textarea value={widget.options.content ?? ""} onChange={(event) => patch({ options: { ...widget.options, content: event.target.value } })} /></label>
          </section>
        )}
        {activeTab === "content" && dataWidget && (
          <section><strong>取数</strong>
            <span className="dash-hint">数据集、维度、度量、筛选与锁定范围都在左侧「数据」面板里设置。</span>
          </section>
        )}
        {/* 行还是列在左边「数据」面板里摆(那是取数结构);这里只剩每一层怎么排序。 */}
        {activeTab === "style" && widget.type === "table" && boundDims.length > 0 && (
          <section><strong>维度排序</strong>
            <span className="dash-hint">行列怎么摆在左侧「数据」面板里设 —— 把维度放进「列维度」就是交叉表。</span>
            <div className="dash-pivot-layout">
              {boundDims.map((dim) => (
                <div className="dash-pivot-row" key={dim}>
                  <strong title={dim}>{dimLabel(dim)}</strong>
                  <select aria-label={`${dim} 排序`} value={to.dimensionSorts?.[dim] ?? "asc"} onChange={(event) => patchTable({ dimensionSorts: { ...(to.dimensionSorts ?? {}), [dim]: event.target.value as "asc" | "desc" | "custom" } })}>
                    <option value="asc">升序</option>
                    <option value="desc">降序</option>
                    <option value="custom">自定义顺序</option>
                  </select>
                </div>
              ))}
            </div>
          </section>
        )}
        {activeTab === "style" && widget.type === "text" && (
          <section><strong>文字样式</strong>
            <div className="dash-text-presets">
              <button className="btn sm" onClick={() => patchText({ fontSize: 24, fontWeight: 700 })}>标题</button>
              <button className="btn sm" onClick={() => patchText({ fontSize: 15, fontWeight: 400, lineHeight: 160 })}>正文</button>
              <button className="btn sm" onClick={() => patchText({ fontSize: 18, fontWeight: 600 })}>结论</button>
            </div>
            <label>字体
              <select value={tx.fontFamily ?? "sans"} onChange={(e) => patchText({ fontFamily: e.target.value as DashboardTextOptions["fontFamily"] })}>
                <option value="sans">无衬线</option>
                <option value="serif">衬线</option>
                <option value="mono">等宽</option>
              </select>
            </label>
            <div className="dash-color-row">
              <label>字号<input type="number" min={10} max={64} value={tx.fontSize ?? 20} onChange={(e) => patchText({ fontSize: Number(e.target.value) })} /></label>
              <label>字重
                <select value={tx.fontWeight ?? 500} onChange={(e) => patchText({ fontWeight: Number(e.target.value) })}>
                  <option value={400}>常规</option>
                  <option value={500}>中等</option>
                  <option value={600}>半粗</option>
                  <option value={700}>粗</option>
                </select>
              </label>
            </div>
            <div className="dash-color-row">
              <label>水平对齐
                <select value={tx.align ?? "left"} onChange={(e) => patchText({ align: e.target.value as DashboardTextOptions["align"] })}>
                  <option value="left">左</option>
                  <option value="center">中</option>
                  <option value="right">右</option>
                </select>
              </label>
              <label>垂直对齐
                <select value={tx.verticalAlign ?? "center"} onChange={(e) => patchText({ verticalAlign: e.target.value as DashboardTextOptions["verticalAlign"] })}>
                  <option value="top">上</option>
                  <option value="center">中</option>
                  <option value="bottom">下</option>
                </select>
              </label>
            </div>
            <div className="dash-color-row">
              <label>行高%<input type="number" min={100} max={300} step={10} value={tx.lineHeight ?? 150} onChange={(e) => patchText({ lineHeight: Number(e.target.value) })} /></label>
              <label>文字颜色<input type="color" value={tx.color ?? "#e8edf6"} onChange={(e) => patchText({ color: e.target.value })} /></label>
            </div>
          </section>
        )}
        {activeTab === "interaction" && dataWidget && (
          <>
            <section className="dash-v1-section-card">
              <div><strong>指标展示模式</strong><span className="dash-hint">同时展示、单指标切换或按自定义指标组切换。</span></div>
              <select value={mode} onChange={(event) => patchMode({ displayMode: event.target.value as DashboardKpiOptions["displayMode"] })}>
                <option value="all">同时展示全部指标</option>
                <option value="switch">使用者切换单个指标</option>
                <option value="group_switch">使用者切换指标组</option>
              </select>
            </section>
            {mode === "group_switch" && (
              <section className="dash-v1-repeat-list">
                {modeGroups.map((group) => (
                  <div className="dash-metric-group" key={group.id}>
                    <div className="dash-metric-group-head"><input value={group.label} maxLength={40} placeholder="指标组名称" onChange={(event) => updateModeGroup(group.id, { label: event.target.value })} /><button className="btn sm danger" onClick={() => patchMode({ metricGroups: modeGroups.filter((item) => item.id !== group.id) })}>删除</button></div>
                    <div className="dash-metric-group-metrics">
                      {boundMetrics.map((metric) => <label className="dash-check" key={metric.id}><input type="checkbox" checked={group.metricIds.includes(metric.id)} onChange={(event) => updateModeGroup(group.id, { metricIds: event.target.checked ? [...group.metricIds, metric.id] : group.metricIds.filter((id) => id !== metric.id) })} />{metric.name}</label>)}
                    </div>
                  </div>
                ))}
                <button className="btn sm" onClick={addModeGroup}><Plus size={13} />添加指标组</button>
              </section>
            )}

            {isChart && (
              <section className="dash-v1-section-card vertical">
                <div><strong>下钻层级</strong><span className="dash-hint">从当前维度再往下钻到哪几层,按顺序。点图形进入下一层,组件上会出现返回。</span></div>
                <div className="dash-drill-chain">
                  {(co.drillDimensions ?? []).map((dimension, index) => <span className="dash-chip" key={dimension}>{index + 1}. {dimLabel(dimension)}<button title="移除" onClick={() => patchChart({ drillDimensions: (co.drillDimensions ?? []).filter((item) => item !== dimension) })}>×</button></span>)}
                </div>
                {/* 层数不设上限。大区 → 主管 → 网点 → 渠道 → 时段 → 产品,六层也是正常需求,
                    原来卡在 4 层没有任何道理。候选就是这个数据集的全部维度。 */}
                <select value="" onChange={(event) => { if (event.target.value) patchChart({ drillDimensions: [...(co.drillDimensions ?? []), event.target.value] }); }}>
                  <option value="">添加下钻维度…</option>
                  {dimensions.filter((field) => !(co.drillDimensions ?? []).includes(field.name)).map((field) => <option key={field.name} value={field.name}>{dimLabel(field.name)}</option>)}
                </select>
              </section>
            )}

            {isChart && (
              <section className="dash-v1-section-card">
                <div><strong>点击联动整个看板</strong><span className="dash-hint">开了之后点一格,所有用同一数据集的组件都按这个值筛。默认只作用于本组件。</span></div>
                <label className="dash-v1-switch"><input type="checkbox" checked={co.linkage === true} onChange={(event) => patchChart({ linkage: event.target.checked })} /><i /></label>
              </section>
            )}

            <section className="dash-v1-section-card">
              <div><strong>同比 / 环比</strong><span className="dash-hint">查询同长度上一周期与去年同期，随组件一起刷新。</span></div>
              <label className="dash-v1-switch"><input type="checkbox" checked={widget.type === "kpi" ? !!ko.showComparison : !!co.showComparison} onChange={(event) => widget.type === "kpi" ? patchKpi({ showComparison: event.target.checked }) : patchChart({ showComparison: event.target.checked })} /><i /></label>
            </section>

          </>
        )}
        {activeTab === "interaction" && widget.type === "container" && (
          <section><strong>Tab 交互</strong>
            <label>Tab 栏位置
              <select value={cont.tabPosition ?? "top"} onChange={(e) => patchContainer({ tabPosition: e.target.value as DashboardContainerOptions["tabPosition"] })}>
                <option value="top">顶部</option>
                <option value="left">左侧</option>
              </select>
            </label>
            <label className="dash-check"><input type="checkbox" checked={cont.showTabBar !== false} onChange={(e) => patchContainer({ showTabBar: e.target.checked })} />查看模式显示 Tab 栏</label>
          </section>
        )}
        {activeTab === "interaction" && widget.type === "text" && <div className="dash-inspector-empty">文本组件暂无筛选与交互设置</div>}
        {activeTab === "style" && widget.type === "kpi" && (
          <section><strong>指标卡样式</strong>
            <div className="dash-color-row">
              <label>数值颜色<input type="color" value={ko.valueColor ?? "#e8edf6"} onChange={(event) => patchKpi({ valueColor: event.target.value })} /></label>
              <label>数值字号<input type="number" min={16} max={72} value={ko.valueSize ?? 34} onChange={(event) => patchKpi({ valueSize: Number(event.target.value) })} /></label>
            </div>
            <label>标签位置<select value={ko.labelPosition ?? "below"} onChange={(event) => patchKpi({ labelPosition: event.target.value as DashboardKpiOptions["labelPosition"] })}><option value="below">数值下方</option><option value="above">数值上方</option></select></label>
            <label>内容对齐<select value={ko.contentAlign ?? "left"} onChange={(event) => patchKpi({ contentAlign: event.target.value as DashboardKpiOptions["contentAlign"] })}><option value="left">左</option><option value="center">中</option><option value="right">右</option></select></label>
            <label>标签字号<input type="number" min={9} max={20} value={ko.labelSize ?? 12} onChange={(event) => patchKpi({ labelSize: Number(event.target.value) })} /></label>
            <label className="dash-check"><input type="checkbox" checked={ko.showSecondary ?? false} onChange={(event) => patchKpi({ showSecondary: event.target.checked })} />显示副指标</label>
            {ko.showSecondary && <label>副指标字号<input type="number" min={9} max={28} value={ko.secondarySize ?? 13} onChange={(event) => patchKpi({ secondarySize: Number(event.target.value) })} /></label>}
            {ko.showComparison && <div className="dash-color-row"><label>同环比排列<select value={ko.comparisonLayout ?? "inline"} onChange={(event) => patchKpi({ comparisonLayout: event.target.value as DashboardKpiOptions["comparisonLayout"] })}><option value="inline">并排</option><option value="column">上下</option></select></label><label>同环比字号<input type="number" min={9} max={32} value={ko.comparisonFontSize ?? 11} onChange={(event) => patchKpi({ comparisonFontSize: Number(event.target.value) })} /></label></div>}
          </section>
        )}
        {activeTab === "style" && isChart && (
          <section><strong>图表样式</strong>
            <label className="dash-check"><input type="checkbox" checked={widget.options.showLegend} onChange={(event) => patch({ options: { ...widget.options, showLegend: event.target.checked } })} />{t("dashboard.showLegend")}</label>
            <label className="dash-check"><input type="checkbox" checked={co.showLabels ?? false} onChange={(e) => patchChart({ showLabels: e.target.checked })} />显示数据标签</label>
            <label className="dash-check"><input type="checkbox" checked={co.grouping ?? false} onChange={(e) => patchChart({ grouping: e.target.checked })} />数字千位分隔符</label>
            {(widget.type === "bar" || widget.type === "line") && (
              <label className="dash-check"><input type="checkbox" checked={co.stack ?? false} onChange={(e) => patchChart({ stack: e.target.checked })} />堆叠(多序列叠加)</label>
            )}
            {widget.type === "line" && <>
              <label>线宽<input type="number" min={1} max={6} step={0.5} value={co.lineWidth ?? 2.4} onChange={(e) => patchChart({ lineWidth: Number(e.target.value) })} /></label>
              <label className="dash-check"><input type="checkbox" checked={co.linePoints !== false} onChange={(e) => patchChart({ linePoints: e.target.checked })} />显示数据点</label>
              <label className="dash-check"><input type="checkbox" checked={co.lineArea !== false} onChange={(e) => patchChart({ lineArea: e.target.checked })} />面积填充(渐变)</label>
                {/* 「时间顺序」挪到数据面板的维度排序里了 —— 那儿对所有图表都有,
                    而且跟表格用同一套说法(升序/降序)。这儿留着就是同一件事两个入口,
                    设了哪个生效还得猜。老看板存的 lineTimeOrder 仍然读得到(见 labelOrder)。 */}
            </>}
            {widget.type === "bar" && <>
              <label>方向
                <select value={co.barOrientation ?? "vertical"} onChange={(e) => patchChart({ barOrientation: e.target.value as DashboardChartOptions["barOrientation"] })}>
                  <option value="vertical">竖向</option>
                  <option value="horizontal">横向</option>
                </select>
              </label>
              <div className="dash-color-row">
                <label>柱主色<input type="color" value={co.barColor ?? palette[0]} onChange={(e) => patchChart({ barColor: e.target.value })} /></label>
                <label>渐变终点<input type="color" value={co.barEndColor ?? palette[1]} onChange={(e) => patchChart({ barEndColor: e.target.value })} /></label>
              </div>
              <label className="dash-check"><input type="checkbox" checked={co.barShowValues ?? false} onChange={(e) => patchChart({ barShowValues: e.target.checked })} />柱顶显示数值</label>
            </>}
            {widget.type === "pie" && <>
              <label>内半径 {pieRadii(co.pieHole, co.pieOuterRadius)[0]}%<input aria-label="环形内半径" type="range" min={0} max={(co.pieOuterRadius ?? 75) - 1} value={pieRadii(co.pieHole, co.pieOuterRadius)[0]} onChange={(e) => patchChart({ pieHole: Number(e.target.value) })} /></label>
              <label>外半径 {co.pieOuterRadius ?? 75}%<input aria-label="环形外半径" type="range" min={20} max={95} value={co.pieOuterRadius ?? 75} onChange={(e) => { const outer = Number(e.target.value); patchChart({ pieOuterRadius: outer, pieHole: pieRadii(co.pieHole, outer)[0] }); }} /></label>
              <span className="dash-hint">内半径越小，环越厚；设为 0 显示实心饼图。</span>
              <label className="dash-check"><input type="checkbox" checked={co.pieShowLabels ?? false} onChange={(e) => patchChart({ pieShowLabels: e.target.checked })} />显示扇区标签</label>
              <label>图例位置
                <select value={co.pieLegendPosition ?? "bottom"} onChange={(e) => patchChart({ pieLegendPosition: e.target.value as DashboardChartOptions["pieLegendPosition"] })}>
                  <option value="bottom">下方</option>
                  <option value="left">左侧</option>
                  <option value="right">右侧</option>
                </select>
              </label>
              <label>占比小数位<input type="number" min={0} max={4} value={widget.options.percentDecimals ?? 1} onChange={(e) => patch({ options: { ...widget.options, percentDecimals: Number(e.target.value) } })} /></label>
            </>}
            <div className="dash-palette-field">调色板
              <div className="dash-palette">
                {palette.map((c, i) => (
                  <span className="dash-swatch" key={i}>
                    <input type="color" value={c} onChange={(e) => { const p = [...palette]; p[i] = e.target.value; patchChart({ palette: p }); }} />
                    <button title="删除" onClick={() => patchChart({ palette: palette.filter((_, j) => j !== i) })}>×</button>
                  </span>
                ))}
                <button className="dash-swatch-add" title="添加颜色" onClick={() => patchChart({ palette: [...palette, DEFAULT_DASHBOARD_PALETTE[palette.length % DEFAULT_DASHBOARD_PALETTE.length]] })}>＋</button>
              </div>
            </div>
          </section>
        )}
        {activeTab === "style" && widget.type === "table" && (
          <section><strong>表格</strong>
            <label className="dash-check"><input type="checkbox" checked={to.mergeDimensions ?? false} onChange={(e) => patchTable({ mergeDimensions: e.target.checked })} />合并相同维度单元格</label>
            <label className="dash-check"><input type="checkbox" checked={to.freezeDimensions !== false} onChange={(e) => patchTable({ freezeDimensions: e.target.checked })} />冻结维度列</label>
            <label className="dash-check"><input type="checkbox" checked={to.rowTotal ?? false} onChange={(e) => patchTable({ rowTotal: e.target.checked })} />行总计列</label>
            <label className="dash-check"><input type="checkbox" checked={to.columnTotal ?? false} onChange={(e) => patchTable({ columnTotal: e.target.checked })} />列总计行</label>
            <label className="dash-check"><input type="checkbox" checked={to.stripe !== false} onChange={(e) => patchTable({ stripe: e.target.checked })} />斑马纹</label>
            <label className="dash-check"><input type="checkbox" checked={to.grouping ?? false} onChange={(e) => patchTable({ grouping: e.target.checked })} />数字千位分隔符</label>
            <label>按维度小计
              <select value={to.subtotalDimension ?? ""} onChange={(e) => patchTable({ subtotalDimension: e.target.value || undefined })}>
                <option value="">不小计</option>
                {dimensions.map((f) => <option key={f.name} value={f.name}>{dimLabel(f.name)}</option>)}
              </select>
            </label>
            <label>密度
              <select value={to.density ?? "normal"} onChange={(e) => patchTable({ density: e.target.value as DashboardTableOptions["density"] })}>
                <option value="compact">紧凑</option>
                <option value="normal">标准</option>
                <option value="relaxed">宽松</option>
              </select>
            </label>
            <label>每页行数
              <select value={to.pageSize ?? 20} onChange={(e) => patchTable({ pageSize: Number(e.target.value) })}>
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label>时间/默认排序
              <select value={to.timeOrder ?? "asc"} onChange={(e) => patchTable({ timeOrder: e.target.value as "asc" | "desc" })}>
                <option value="asc">升序</option>
                <option value="desc">降序</option>
              </select>
            </label>
            <label>表头对齐
              <select value={to.headerAlign ?? "left"} onChange={(e) => patchTable({ headerAlign: e.target.value as DashboardTableOptions["headerAlign"] })}>
                <option value="left">左</option>
                <option value="center">中</option>
                <option value="right">右</option>
              </select>
            </label>
            <div className="dash-color-row">
              <label>表头字号<input type="number" min={9} max={20} value={to.headerFontSize ?? 12} onChange={(e) => patchTable({ headerFontSize: Number(e.target.value) })} /></label>
              <label>表头字重<input type="number" min={400} max={800} step={100} value={to.headerFontWeight ?? 600} onChange={(e) => patchTable({ headerFontWeight: Number(e.target.value) })} /></label>
            </div>
            <div className="dash-color-row">
              <label>表头行高<input type="number" min={24} max={80} value={to.headerHeight ?? 38} onChange={(e) => patchTable({ headerHeight: Number(e.target.value) })} /></label>
              <label>数据行高<input type="number" min={24} max={80} value={to.rowHeight ?? 34} onChange={(e) => patchTable({ rowHeight: Number(e.target.value) })} /></label>
            </div>
          </section>
        )}
        {activeTab === "style" && <section><strong>{t("dashboard.layout")}</strong><div className="dash-layout-fields"><label>X<input type="number" min={0} max={11} value={widget.x} onChange={(event) => patch({ x: Number(event.target.value) })} /></label><label>Y<input type="number" min={0} value={widget.y} onChange={(event) => patch({ y: Number(event.target.value) })} /></label><label>{t("dashboard.width")}<input type="number" min={2} max={12} value={widget.w} onChange={(event) => patch({ w: Number(event.target.value) })} /></label><label>{t("dashboard.height")}<input type="number" min={2} max={10} value={widget.h} onChange={(event) => patch({ h: Number(event.target.value) })} /></label></div></section>}
      </div>
    </aside>
  );
}
