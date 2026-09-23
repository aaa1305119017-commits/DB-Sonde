import { normalizeDesignUnits } from "../designUnits";
import { S } from "../jsonSchema";
import { STYLE_PROPERTIES } from "../styleSchema";
import { BANDS, WIDTHS, type LayoutPlan } from "../layout";
import { designCapabilityGuide, validateDesignBindings } from "../designContracts";
import { refineAnalysisLayout } from "../presentation";
import type { AgentState } from "../state";
import type { NodeFn } from "../graph";
import type { PlanReader } from "../planReader";
import type { StructuredCaller } from "./ports";

/** presets.css 的可用预设；分析默认使用简洁主题。 */
export const VISUAL_PRESETS = [
  "editorial", "aurora", "ocean", "violet", "sunset", "glass", "gold", "jade", "rose",
  "ember", "cyber", "slate", "mint", "amber", "plum", "coral", "indigo",
] as const;

export const LAYOUT_SCHEMA = S.obj(
  {
    title: S.str("看板标题"),
    description: S.str("一句话说明这个看板回答什么问题"),
    theme: S.str("这一版的设计思路 —— 为什么这么排、为什么用这套色。用户会看到"),
    preset: S.enumOf(VISUAL_PRESETS, "视觉基调，分析默认简洁中性色；用图表颜色区分业务系列"),
    palette: S.arr(S.str("#RRGGBB"), "整板默认配色,单个组件可覆盖", 8),
    items: {
      type: "array", minItems: 2, maxItems: 14,
      items: S.obj(
        {
          band: S.enumOf(BANDS, "这块内容扮演什么角色:kpi 核心数 / trend 趋势 / structure 结构占比 / ranking 排名 / detail 明细。**不决定位置**,位置你自己给"),
          type: S.enumOf(["kpi", "line", "bar", "pie", "table", "text", "container"], "组件类型;text 是纯文字块,用来写小标题、口径注释、结论"),
          title: S.str("组件标题,说人话"),
          subtitle: S.str("标题下的口径小字,可选"),
          footnote: S.str("卡片底部小字:数据截至、注意事项,可选"),
          content: S.str("type=text 时的正文,支持换行"),
          metricIds: S.arr(S.str("必须来自已验证的指标 id"), "绑定的指标;text 块给空数组"),
          dimensions: S.arr(S.str(), "分析维度。KPI 和 text 一定给空数组"),
          x: S.int("左上角横坐标,0-11 栏", 0, 11),
          y: S.int("左上角纵坐标,行号从 0 开始", 0, 60),
          w: S.int("占几栏,1-12", 1, 12),
          h: S.int("占几行", 1, 20),
          width: S.enumOf(WIDTHS, "宽度档(给了 w 就可以不填)"),
          reason: S.str("为什么放它、为什么用这种图 —— 用户会看到"),
          scale: S.enumOf(["none", "wan", "yi", "auto"], "大额金额换算；同一张卡上量级差很远就用 auto"),
          ...STYLE_PROPERTIES,
          secondaryMetricIds: S.arr(S.str(), "副指标，必须已验证"), seriesDimension: S.str("图例维度"),
          visible: S.bool("默认可见"), filtersEnabled: S.bool("单卡筛选器"), filterFields: S.arr(S.str(), "组件筛选字段:数据集里的维度字段名。'date' 是保留名,渲染成日期区间"),
        },
        ["band", "type", "title", "metricIds", "dimensions", "reason"],
      ),
    },
  },
  ["title", "theme", "preset", "items"],
);

// Only one level of containers; a finite schema and a finite render budget.
const childSchema = structuredClone(LAYOUT_SCHEMA.properties!.items.items!);
childSchema.properties!.type = S.enumOf(["kpi", "line", "bar", "pie", "table", "text"]);
LAYOUT_SCHEMA.properties!.items.items!.properties!.tabs = S.arr(S.obj({ title: S.str("分页标题"), items: S.arr(childSchema, "这一页的组件", 12) }, ["title", "items"]), "容器分页，最多六页", 6);

export function createLayoutDesigner({ callStructured, getPlan }: { callStructured: StructuredCaller; getPlan: PlanReader; }) {
  /**
   * 给设计节点看的数据形状。
   *
   * **默认只给形状,不给内容。** 设置里那个「把样本行发给模型」默认是关的,
   * 可这条路上从来没人读过它 —— `grep includeSampleRows src/features/agent/` 零命中。
   * 于是每次分析都会把每个维度的 8 个真实取值(网点名、**主管姓名**)和 3 行真实数据
   * 发给云端模型,而用户以为自己关掉了。
   *
   * 版面设计需要的是「这个维度有多少个取值、有没有时间列、多少行」——
   * 这些形状信息足够决定用什么图、排几栏。真实取值是**额外的**,
   * 只在用户明确打开开关时才给。
   */
  function designDataViews(state: AgentState, includeSamples: boolean) {
    return [...(state.plans ?? []), ...(state.supportingPlans ?? [])].flatMap((ref) => {
      const plan = getPlan(ref.planId);
      if (!plan?.result) return [];
      return [{
        planId: ref.planId, metricIds: plan.metricIds,
        dimensions: plan.shape.dimensions.map((id) => {
          const index = plan.result!.columns.findIndex((c) => c.name === id);
          const values = index < 0 ? [] : [...new Set(plan.result!.rows.map((row) => String(row[index] ?? "")))];
          return { id, count: values.length, ...(includeSamples ? { sample: values.slice(0, 8) } : {}) };
        }), rowCount: plan.result.rows.length, columns: plan.result.columns.map((c) => c.name),
        ...(includeSamples ? { sampleRows: plan.result.rows.slice(0, 3) } : {})
      }];
    });
  }

  const layoutDesigner: NodeFn = async (state, context) => {
    context?.signal?.throwIfAborted();
    const metrics = state.validatedMetrics ?? [];
    const dims = [...new Set([...(state.plans ?? []), ...(state.supportingPlans ?? [])].flatMap((p) => getPlan(p.planId)?.shape.dimensions ?? []))];
    const facts = (state.insights ?? []).map((i) => `- ${i.headline}`).join("\n");

    const result = await callStructured<LayoutPlan>({
      signal: context?.signal,
      role: "design",
      node: "LayoutDesigner",
      name: "layout",
      schema: LAYOUT_SCHEMA,
      system: `你是 BI 看板设计师。数据已经查好、验过了,现在由你决定这块看板长什么样。

${designCapabilityGuide()}

**排版、配色、注释、用什么组件,都是你的事。** 12 栏网格,你直接给每块的 x/y/w/h。
程序只会帮你修三种硬错:超出网格、两块压在一起、行与行之间留了大洞。
你的构图本身不会被重排 —— 想把大 KPI 放右边、想让明细表顶在最上面,那是你的判断。

可用指标(只能用这些 id,一个都不能编):
${metrics.map((m) => `  ${m.metricId} = ${m.name}(${m.unit})；业务方向=${m.direction ?? "neutral"}${m.caliber ? ` —— ${m.caliber}` : ""}`).join("\n")}

数据里有的维度:${dims.join("、") || "(无,只有总计)"}
数据范围:${state.scope?.label}
已验证的数据视角（planId、指标、维度、实际点数和样例）：
${JSON.stringify(designDataViews(state, context?.modelConfig?.includeSampleRows === true))}
分析报告：${state.report ?? state.analysisSummary ?? ""}
证据缺口：${JSON.stringify(state.evidenceGaps ?? [])}

已经算出来的结论(重点结论要有对应的图,也可以直接写进 text 块):
${facts || "(无)"}

**只有这几条是硬规矩** —— 违反会让人读错数,不是审美问题:
- 时间维度绝不能用饼图(饼图表达同一时刻的构成,没有先后)
- 构成问题可用饼图/环形图，排名或比率比较可用条形图。用户没有要求截取时 topN=0 展开全部；不要固定前5名。只有确实需要聚焦头部时才按问题选择 N，并说明理由，余项要计入占比分母。
- 无维度、同单位且互斥的可加指标（如线下金额与线上金额）可以组成一张饼/环形图；不要把销售额与其中一部分重复相加。
- 各组自身的比率、平均分不能相加成整体，不能用饼图；可用比较图或表格，差评数占比不等于差评率。
- 折线的斜率意味着"随时间变化",维度不是时间时别用折线
- KPI 卡和 text 块的 dimensions 必须是空数组
- 可以展示完整排名，不必截取头部；类别多时用滚动或明细。

**阅读顺序与表达**:
- 根据本次问题和数据决定组件、阅读顺序、宽高与位置，直接给 x/y/w/h。程序只修复重叠、越界和留洞，不替你安排固定模板。
- 需要强调结论时用 text 块，让读者直接看到发现。
  看板不是图表堆,是一篇有观点的东西 —— 没有这句话,读者得自己从八张图里拼。
  text 块常配 appearance.hideTitle=true。分区小标题也用 text。
- 自主设计视觉层次：可用分区标题、与整板同色系的重点卡底色、强调色边框、字号对比、适度阴影和图形面积填充。深色预设的正文/KPI/表头应使用对应浅色前景；不要将浅色主题的白底表头、深色正文混入深色预设。若刻意设计浅色卡片，明确选择 none 预设并成套设置前景与背景。
- 文字卡高度按实际行数设计；一两句结论不要占据一整张趋势图的空间。KPI 的字号、内边距与高度配套，数值和比较信息必须同时可见，不应出现卡内滚动条。
- preset 是可选基调，单卡 appearance 和 text 可以覆盖。不要把强烈的饱和渐变铺满整页；装饰服务阅读，异常颜色必须有依据。
- 同一业务系列保持一致颜色；用较少的强调色引导阅读，正文保证与背景的对比度。
- 保持清楚的层次、留白和可读文字。不要每个问题都生成同样的一行数字加两张图；围绕问题决定什么值得突出。
- 不要再用无维度柱图重复 KPI 已展示的两平台合计。每张图回答一个不同的问题。
- footnote 写口径和数据截至,比塞在标题里干净。
- KPI 的数量、是否分卡、明细表的数量都由内容决定，没有四个 KPI 或一张表的配额。不同业务口径可分表，没必要的表可以不放。
- 图形按阅读任务选择：跨期或期内走势考虑折线/面积，完整构成考虑饼/环形，类别间精确比较考虑柱/条形，逐项核对用表。不要把所有问题都表达成排名，也不要为了凑图种画不存在的趋势或占比。
- 必须根据下面的真实数据视角判断图形：只有一个时间点不能伪造趋势。同一组指标不必逐个重复做条形图；可以组合、换成表格或聚焦关键差异。
- 组件数量在可执行预算内按内容需要决定。宁可少而有观点，不要填满额度。

在构思时比较几种适合本题的表达路径，选择最有解释力的一种完整设计；不需要向用户交付多个候选。不要沿用惯常卡片顺序，也不要为了与上次不同随机换图。

theme 字段写一句话:这版为什么这么设计。用户会看到。

只输出 JSON。`,
      user: state.designFeedback ? `${state.userRequest}\n上一版设计：${JSON.stringify(state.layout)}\n成品验收意见：${state.designFeedback}\n根据这些具体问题改进，保留正确的数据绑定，返回完整新版。` : state.userRequest,
    }, context?.modelConfig);
    context?.signal?.throwIfAborted();
    if (!result.ok) throw new Error(`设计版面失败:${result.errors?.join(";")}`);
    const layout = normalizeDesignUnits(result.data!, metrics);
    const usage = [...state.usage, { node: "LayoutDesigner", ms: result.ms, promptTokens: result.promptTokens, completionTokens: result.completionTokens }];
    const bindingErrors = validateDesignBindings(layout, state);
    if (bindingErrors.length) return { layout, usage, designBindingErrors: bindingErrors, designFeedback: `修正这些字段或数据边界错误：${bindingErrors.join("；")}` };
    return {
      layout: refineAnalysisLayout(layout, metrics), designBindingErrors: [],
      usage,
    };
  };


  return { layoutDesigner, designDataViews };
}
