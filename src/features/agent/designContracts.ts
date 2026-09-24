import { STYLE_PROPERTIES } from './styleSchema';
import type { JsonSchema } from './jsonSchema';
import type { LayoutItem, LayoutPlan } from './layout';
import type { AgentState } from './state';


/**
 * 场景 → 能力。**这是「什么时候用」,不是「有什么」** —— 后者由下面的字段清单
 * 自动生成,已经有 138 行了。
 *
 * 为什么要这层:字段清单是一本字典。`chart.drillDimensions` 和 `chart.grouping`
 * (千位分隔符)在里面长得一模一样,都是一行描述。模型看得见下钻,但没有任何理由
 * 去够它 —— 于是产品加了功能,生成的看板还是老几样。
 *
 * 每条的 fields 必须是真实存在的字段路径,有守卫盯着(见 test-ai-boundaries),
 * 改了字段名而忘了改这里会直接报错。
 */
export const CAPABILITY_TRIGGERS: { when: string; fields: string[] }[] = [
  { when: "维度之间有层级(大区→门店、品类→商品),想让人点进去看下一层", fields: ["chart.drillDimensions"] },
  { when: "希望点一张图能筛掉整块看板,而不只是本卡下钻", fields: ["chart.linkage"] },
  { when: "同一批数据有几种读法(按渠道 / 按地区 / 按时间),塞一页太挤", fields: ["tabs"] },
  { when: "两个指标量纲差很远(金额和比率),但要放一起看趋势", fields: ["secondaryMetricIds", "chart.secondarySeriesType"] },
  { when: "一张卡上的指标量级差 1 万倍以上(2000 万 vs 48 家)", fields: ["scale"] },
  { when: "要按两个维度交叉核对(地区 × 渠道)", fields: ["table.layout"] },
  { when: "表很宽,左边的维度列要一直看得见", fields: ["table.freezeDimensions"] },
  { when: "读者需要自己换个范围看,而不是你替他定死", fields: ["filtersEnabled", "filterFields"] },
  { when: "同一张图里既要看绝对值又要看占比", fields: ["displayMode"] },
  { when: "几个指标是一组、想让读者切换而不是并排铺开", fields: ["metricGroups", "metricSwitchDefault"] },
  { when: "结论本身就是内容,不该让读者从图里自己拼", fields: ["content", "appearance.hideTitle"] },
];

/** Descriptions and accepted fields share the tool contract; no second hand-written whitelist. */
export function designCapabilityGuide() {
  const walk = (schema: JsonSchema, path: string): string[] => {
    const line = `${path}: ${schema.description ?? schema.type}${schema.enum ? ` [${schema.enum.join(' / ')}]` : ''}${schema.minimum != null ? ` 最小 ${schema.minimum}` : ''}${schema.maximum != null ? ` 最大 ${schema.maximum}` : ''}`;
    return [line, ...Object.entries(schema.properties ?? {}).flatMap(([key, child]) => walk(child, `${path}.${key}`)), ...(schema.items ? walk(schema.items, `${path}[]`) : [])];
  };
  const triggers = CAPABILITY_TRIGGERS.map((t) => `- ${t.when} → ${t.fields.join(" / ")}`).join("\n");
  return `以下是产品现有能力，不是要求每张看板都用。按表达目的选择；不认识的字段会指出具体错误。

**遇到这些情况时，下面这些能力是为它准备的**（不是清单，是提示；没遇到就别硬用）：
${triggers}

布局：12栏，x/y/w/h控制位置和大小；文本可做大标题、分区、注释；container.tabs可做不同阅读层次的分页，不能套娃。
内容：metricIds为主指标，secondaryMetricIds为右轴/副指标，seriesDimension为分类系列。所有引用来自已验证目录。
交互：filtersEnabled/filterFields控制单卡筛选器，chart.drillDimensions控制下钻；visible决定可见性。不能因此改变既定业务范围。
数字：metrics 的键必须是当前卡片绑定的完整指标 id；metrics.unit 省略即可继承目录真实单位。显示万元、亿元、万单用 numberFormat.scale=wan/yi，unit 保持元、单等真实单位；同一卡片的缩放对所有指标生效，不能混用万元和亿元。decimals和numberFormat只改变显示。不同单位放双轴或分卡，不能通过改后缀伪装口径。
表格：table控制普通/透视、行列维度、合计、小计、排序、冻结列、列宽、密度和表头；非可加指标的合计须由数据层正确计算。
指标卡：kpi控制数字、标签、对比与切换；图表：chart控制线/柱/饼细节；appearance/text控制视觉层次。
兼容字段明确写了“兼容”的不代表新增视觉能力。配置未设置时使用产品默认值，不需要把所有字段填一遍。
${Object.entries(STYLE_PROPERTIES).flatMap(([key, schema]) => walk(schema, key)).join('\n')}`;
}

export function allLayoutItems(layout: LayoutPlan): LayoutItem[] {
  return layout.items.flatMap((item) => [item, ...(item.tabs ?? []).flatMap((tab) => tab.items)]);
}

/** Presentation freedom never permits changing metric semantics or broadening data scope. */
export function validateDesignBindings(layout: LayoutPlan, state: AgentState): string[] {
  const known = new Map((state.validatedMetrics ?? []).map((m) => [m.metricId, m]));
  const errors: string[] = [];
  const items = allLayoutItems(layout);
  if (items.length > 30) errors.push('整板含分页最多30个组件，请精简重复表达');
  for (const item of items) {
    if (item.type === 'pie' && (item.chart?.pieHole ?? 42) >= (item.chart?.pieOuterRadius ?? 75)) errors.push(`「${item.title}」环形内半径必须小于外半径`);
    const ids = [...item.metricIds, ...(item.secondaryMetricIds ?? [])];
    const label = `「${item.title}」`;
    for (const id of ids) if (!known.has(id)) errors.push(`${label}引用未验证指标 ${id}`);
    const dimensions = new Set(ids.flatMap((id) => known.get(id)?.supportedDimensions ?? []));
    for (const dim of [...item.dimensions, ...(item.seriesDimension ? [item.seriesDimension] : []), ...(item.chart?.drillDimensions ?? []), ...(item.filterFields ?? []).filter((d) => d !== 'date')]) {
      if (!dimensions.has(dim) || ids.some((id) => !known.get(id)?.supportedDimensions.includes(dim))) errors.push(`${label}指标不共同支持维度 ${dim}`);
    }
    for (const options of [item.chart, item.kpi]) {
      for (const group of options?.metricGroups ?? []) if (group.metricIds.some((id) => !ids.includes(id))) errors.push(`${label}切换组包含未绑定指标`);
    }
    for (const [id, value] of Object.entries(item.metrics ?? {})) {
      if (!ids.includes(id)) errors.push(`${label}展示配置 metrics["${id}"] 未绑定；只为 metricIds / secondaryMetricIds 中的指标设置展示配置`);
      else if (value.unit && value.unit !== known.get(id)?.unit) errors.push(`${label}指标 ${id} 的真实单位是“${known.get(id)?.unit ?? ""}”，收到“${value.unit}”；删除 metrics["${id}"].unit 即可继承真实单位。万/亿显示用 numberFormat.scale=wan/yi，同一卡片使用统一缩放，不要改写单位或混用缩放`);
      // Business direction belongs to the metric center; it is not an aesthetic choice.
      if (value.direction && value.direction !== (known.get(id)?.direction ?? 'neutral')) errors.push(`${label}请沿用指标中心的好坏方向，不在设计中改写`);
    }
    const suffix = item.numberFormat?.suffix?.trim();
    if (suffix && ids.some((id) => { const unit = known.get(id)?.unit ?? ''; const scale = (item.numberFormat?.scale ?? item.scale) === 'wan' ? '万' : (item.numberFormat?.scale ?? item.scale) === 'yi' ? '亿' : ''; return suffix !== scale + unit; })) errors.push(`${label}数字后缀与真实指标单位不一致`);
    const lock = item.lockedScope;
    if (lock && state.scope) {
      if (lock.start && lock.start < state.scope.dateRange.start || lock.end && lock.end > state.scope.dateRange.end || lock.start && lock.end && lock.start > lock.end) errors.push(`${label}单卡日期超出已核对范围`);
      for (const [field, values] of Object.entries(lock.filters ?? {})) {
        const allowed = state.scope.filters.find((f) => f.field === field)?.values;
        if (!allowed || values.some((v) => !allowed.includes(v))) errors.push(`${label}锁定筛选必须是已核对取值的子集：${field}`);
      }
    }
    if (item.chart?.drillDimensions?.includes(item.dimensions[0])) errors.push(`${label}下钻链是「再往下钻到哪几层」,不该再写一遍当前的分组维度`);
    const tableDims = [...Object.keys(item.table?.dimensionPlacements ?? {}), ...Object.keys(item.table?.dimensionSorts ?? {}), ...Object.keys(item.table?.dimensionCustomOrders ?? {}), ...(item.table?.subtotalDimension ? [item.table.subtotalDimension] : [])];
    if (tableDims.some((dim) => !item.dimensions.includes(dim))) errors.push(`${label}表格设置引用了未绑定维度`);
    if (item.type !== 'container' && item.tabs?.length) errors.push(`${label}只有容器可以分页`);
    if (item.tabs?.some((tab) => tab.items.some((child) => child.type === 'container' || child.tabs?.length))) errors.push(`${label}容器不能嵌套`);
  }
  return errors;
}
