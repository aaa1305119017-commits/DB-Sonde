# 分析与看板设计：当前实现

## 0.50.2 修复真实成品缺陷（2026-09-14）

保持 Flash 经济模型。针对区域经营看板持久化配置与截图：

- 观察输出原为1536 tokens并发生截断，导致本次没有进入评分；改用独立4096输出预算、简短观察条目、关闭自动内容修复重试，保留失败明示。程序增加文字对比度检查，低对比不能通过成品验收。
- 显式浅色背景创建对应的卡片文字颜色变量，避免继承深色预设的浅字；明确指定却不可读的纯色文字修正为可读颜色。对现有看板即时生效，不重写存档；复杂渐变仍由成品观察判断。
- 设置 secondarySeriesType 时真正绘制第二轴和副指标系列，副轴、数据标签、提示保留独立单位；旧的仅提示副指标不变。无维度比较图使用合计分类，不再误把第一个数值当轴标签。十字线随金额显示单位换算。
- 同单位可加指标在无维度时支持共同组成饼图，设计不再强制改为条形图。模型须核对互斥部分，不能把总计与子项相加。内外半径均可设置，默认42/75；面板、模型契约、绘图和网页导出统一，内半径必须小于外半径。
- 保存规划节点的业务覆盖清单。结束调查前，检查已承诺但未查的指标；模型须补查或具体解释为何与问题无关，未经查询不能标记不可用。预算内仍未完成时明确列为调查未完成，不能包装成全面分析。没有固定业务主题清单，也不强制每次查全部指标。

验证使用用户原看板配置及模拟取数，实际检查浅底文字、双轴两条线和渠道环形图。test:quality验证实际系列构造、单位、构成、内外半径与补查判断；既有工作区、设计循环及集成测试继续运行。本次没有调用付费模型，未声称真实业务分析质量已全面通过。


## 0.50.1 恢复经济模型（2026-09-14）

按用户要求，分析默认改为 `deepseek-flash`，取消 chat/reasoner/Flash 自动升级到 Pro。已保存的 Pro 分析选择只迁移一次；用户之后明确新选的模型仍受尊重。分析、设计、评分、截图观察均使用 Flash，显式关闭 Flash 思考，不继承 Pro 的高思考和 32768 输出上限。自动选择与模型来源切换都默认 Flash，界面显示实际生效的型号。截图观察继续使用相同经济型号；没有发出付费模型请求进行本次测试。

此次只调整模型与费用设置，未修改截图中报告的配色、双轴或分析覆盖问题。以下 0.50.0 的 Pro 默认描述是历史行为，已被本节替代。


## 0.50.0 成品验收循环（2026-09-14）

设计师通过与工具共用的字段契约获得图表、KPI、文本、表格、分页容器、外观、数字格式和范围设置的能力说明。测试自动核对界面选项与契约，防止新增设置只对人开放。版式与组件数量由问题和证据决定；没有四个 KPI、一张表或前五名的配额。取消 KPI 必须靠前的检查，不再把不同范围/透视设置的同指标组件误删为重复。

当前路径：理解问题 → 语义查询 → 数据检查 → 证据调查/补查 → 分析 → 证据复核 → 设计 → 结构检查 → 实际渲染 → 截图观察 → 五项评分 → 修改或保存一份最终草稿。分析浅显时返回调查/分析环节，不仅润色标题。

- DeepSeek 分析入口将旧 chat/reasoner/Flash 选择升级为 V4 Pro；规划、分析、设计与最终判断使用 Pro，并开启 high 思考。经用户许可，Flash Vision 只读取成品截图并描述视觉现象，Pro 根据观察和实际内容评分。观察失败不伪造分数，也不静默改用低能力模型决策。
- 成品使用真实 DashboardCanvas、ECharts 和指标语义查询渲染；每个视角重新检查数据。只截取应用自己创建的预览，不读取桌面或其他窗口。截图只在本次运行内存中保留，不进入检查点或持久化报告。
- 五项各 20 分：美观、布局合理、表达多样性、清晰度、分析深度。总分至少 80、每项至少 12 且没有阻断问题才通过。每项都必须给具体依据。图种少不自动扣分；复杂问题机械堆同类比较图、复述高低却不分析业务问题，应要求改进。
- 最多三版设计，择取与当前报告对应的最佳版本，只保存一份。预算用完仍未通过，明确标记待调整草稿并公开扣分原因；无法正确渲染则不保存空白成品。用户可以展开每轮评分及实际验收预览。
- 预览包含完整长页切片及分页容器各标签页，单次最多 12 幅、页面高度最多 12000 像素；超出覆盖范围不能宣称通过。指标切换、下钻和表格翻页等其他交互状态不作为全状态视觉验收。每次最多 60 个取数视角、每份最多 20000 行，限制是资源边界而非内容模板。
- 同样的问题会重新查询、规划和判断，不缓存成品回答；事实不变时不能为了新鲜感编造变化。模型可比较表达路径，但只交付一个适合本题的结果。

验证：`npm run test:design` 检验能力覆盖、数据边界、模型分工、评分否决、修改与单份保存；`test:workspace` 和 `test:integration` 检验既有路径。实际 React 渲染/截图验证使用模拟数据和模型响应，不能据此宣称真实 DeepSeek 分析深度或审美已达标。真实模型质量仍需实际业务问题验收。

官方模型能力依据：[模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[视觉输入](https://api-docs.deepseek.com/zh-cn/guides/vision/)。

---

# 当前实现说明 · 0.49.1（2026-09-14）

本节描述当前代码；下方 0.45.23 文档保留为历史设计，不作为现行行为约束。

默认入口为直接提问，手动表单可选。模型决定分析计划、是否补查、报告重点和看板构图；程序负责只读权限、指标与维度校验、准确日期计算、真实筛选取值、分组与总计核对。不能用固定 Top5 或固定模板替代分析判断。

0.49.1 修正了展示层残留的强制中性色、清除阴影/渐变、强制数据标签以及无 KPI 即提示缺陷的规则。保留明确的单卡背景、边框、图表配色和 KPI 字号/对齐；单卡样式可覆盖主题预设。组件数量没有 KPI 四张或明细表一张的配额。设计节点现在收到每份已验证数据的维度、点数与样例，避免只有指标名称时机械生成比较条形图。

规划时提供目录分类并记录模型的业务覆盖取舍；首批八个指标为单次查询预算，其余相关主题可分批补查，没有写死经营分析指标组合。显式的分组数量与真实取值核对，不符合时只追问名单，不默认扩大范围。这是保守校验，不是对所有自然语言范围含义的完备识别。

当前路径：理解问题 → 语义查询 → 数据检查 → 证据充分性判断 / 补查循环 → 形成结论 → 独立证据复核 / 退回改写 → 看板设计 → 版面检查 → 保存草稿。

- `questionPlanner.ts` 只接受当前连接的指标清单。筛选先核对真实值；歧义返回可继续的追问，绝不静默取消筛选。未指定日期默认最近三个完整自然月并公开假设。
- `evidenceLoop.ts` 允许模型选择新指标、换分组补查。补查继承已经核对的日期与筛选，限定同连接、同数据库，每份补充数据必须重新验证。每轮最多两个查询、最多三轮是资源预算，不是固定分析步骤；用尽后公开证据缺口。
- `analysis.ts` 为全部选中指标计算可复核事实，支持完整分组构成、分组变化和逐期趋势。非可加指标需要 SQL 在对应粒度精确计算，不能平均月度比率代替全期比率。
- 独立复核检查回答和事实的一致性，允许明确标记的假设与验证建议。最多两次改写，仍不通过则停止看板生成，不发布未经复核的结论。
- 展示完整分类或用户指定的 N；多分类饼图使用滚动图例。保留模型的组件、宽高、坐标和配色选择，修复重叠和越界，默认使用中性色卡片。
- 每次运行固定所选模型与连接配置，配置凭据不进入运行记录。新问题清除已完成查询缓存；重复事实不靠随机改写制造新发现。追问继承已核对的范围和前文。

运行时暂用现有 TypeScript Graph。本次未引入 LangGraph。LangGraph 的状态持久化、暂停恢复和编排工具适合未来跨会话恢复或长期任务；它本身不替代证据检查与质量评测。后续若迁移，保持语义工具和这些测试不变，只替换运行时。

验收分两层：`test:workspace` 用模拟模型及数据库响应检验执行边界、补查、追问和复核退回；界面用实际组件验证。它们不证明真实模型的业务报告质量。真实问题验收还需核对范围理解、数字与分母、解释深度、未回答部分、图表必要性及查询耗时。

---

# DB Studio · AI Data Agent 架构设计

> 第一阶段产物:**只出设计,不改代码**。
> 基于 2026-09-11 对 `dbstudio@0.45.23` 全量代码的通读(TS/TSX 28,797 行 + Rust 8,874 行)。

---

## 0. 先说三个结论

在展开 14 节之前,先把三个会影响所有后续决策的判断放在最前面,因为它们和你给的设定不完全一致。

### 结论一:不要用 LangGraph(Python),也建议暂时不要用 LangGraph.js

DB Studio 是一个 **Tauri 桌面应用**:Rust 后端 + React 前端,打成一个 ad-hoc 签名的 `.app`,没有任何常驻服务端。

如果引入 Python 版 LangGraph,调用链会变成:

```
React UI → Python LangGraph 进程 → HTTP 回打 Tauri → TS 语义层 → Rust 驱动 → DB
```

四跳,而且**语义层(指标编译)在 TS 这一侧**,Python 那边拿不到,只能把指标编译重写一遍 —— 这正好违反了你自己定的第 6 条原则(指标中心是唯一可信来源)。项目里确实有 Python sidecar(`src-tauri/src/python.rs`,890 行),但它是给用户写脚本用的工作区(pip / playwright / lint / sqlglot),不是服务运行时。你那句"不要写一个 py 脚本"我理解为的正是这个意思。

LangGraph.js 技术上可行,但它的核心价值(checkpoint、streaming、interrupt)在这个场景里:

| LangGraph 提供 | 本项目的现实 |
|---|---|
| Checkpointer(Postgres/SQLite) | 已有 `dashboard_store.rs` 的原子 JSON 持久化模式,照抄 60 行 |
| 跨进程 / 跨机器恢复 | 单机单进程,不需要 |
| Streaming 编排 | 已有 `streamChat`(`aiClient.ts:68`) |
| Human-in-the-loop interrupt | 就是 state machine 停在一个状态等 UI 回调 |
| 图定义 DSL | 约 400 行 TS 即可 |

**建议:自研一个 LangGraph 语义同构的 TS 状态机**(`src/features/agent/graph.ts`,约 400 行),节点签名保持 `(state) => Promise<Partial<State>>`,边保持 `addEdge / addConditionalEdge`,checkpoint 保持 `{nodeId, state, ts}`。这样将来如果真要换 LangGraph.js,是机械替换而不是重写。

> 反对意见值得记下来:自研意味着调度、并发、重试、超时全要自己写和自己测。我的判断是这部分逻辑总量 < 500 行且高度可测,比引入一个会拖着 `@langchain/core` 全家桶进 Vite 产物(当前 bundle 已经在报 chunk size 警告)更划算。如果后期节点数超过 30 个或需要真正的并行分支,再迁移。

### 结论二:最大的拦路虎不是 AI,是"看板的所有改写逻辑长在 React 组件里"

这是本次通读最重要的发现。

`DashboardWorkspace.tsx` 里,`addWidget`(:154)、`updateWidget`(:146)、`addChildWidget`(:164)、`duplicateWidget`(:177)、`toggleWidget`(:191)、`deleteWidget`(:196)、`addFilter`(:120)全是**组件内部的闭包**,闭在 `useState` 的 `document` 上。

Agent 的 Tool 没有办法调用一个 React 闭包。

同样的问题还有:维度取值枚举,它躺在 `ComponentFilterBar.tsx:33` 的 `load()` 里 —— 逻辑本身很好(复用 `executeDataset` + `groupBy:[field]`),但同样是组件内闭包。

所以 **Phase 0 必须是:把看板改写抽成一个 headless 的 `dashboardService` / store**。这件事和 AI 无关,它本身就是欠的技术债:现在 `DashboardWorkspace.tsx` 已经 530 行,撤销/重做、版本、自动刷新、运行时全挤在一个组件里。抽完之后 AI Tool 层才有东西可调,同时这个组件会瘦一大圈。

**不做这一步就做 Agent,唯一的出路是让 Agent 去操作 React state —— 那就是绕过 Service 层,违反你的第 5 条原则。**

### 结论三:好消息 —— 组件 Schema 的能力缺口比预期小得多

你在第五节列了一长串视觉能力清单,担心现有 Schema 不支持。实际通读 `domain.ts` 的结果是:**你列的绝大部分已经存在**。

`DashboardChartOptions` / `DashboardTableOptions` / `DashboardKpiOptions` / `DashboardAppearanceOptions` 四组配置合计约 90 个字段,已经覆盖 palette、dimensionColors、showLabels、legend、topN、dimensionSorts、drillDimensions、stack、displayMode、showComparison、visualPreset、lockedScope……

真正缺的只有 5 项(见第 10 节),都是小改动。这意味着 **DashboardDesigner 节点的输出可以直接是 `DashboardWidget[]`,不需要中间的抽象层**。这是整个方案里最省力的地方。

---

## 1. Current Architecture

### 1.1 进程与分层

```
┌─────────────────────────────────────────────────────────┐
│ React 19 + TS (Vite)                                    │
│  features/{dashboard,metrics,ai,lineage,etl,scheduler,  │
│            entity,assets}                               │
│  store/appStore.ts (zustand) · 各 feature 自带 store      │
└───────────────┬─────────────────────────────────────────┘
                │ src/lib/api.ts  —— 唯一的 invoke 边界
┌───────────────▼─────────────────────────────────────────┐
│ Rust (Tauri v2)                                         │
│  commands.rs · readonly.rs · dashboard_store.rs         │
│  ai.rs(llama.cpp sidecar) · python.rs(脚本工作区)      │
│  db/{mod,introspect,edit,oracle_driver,clickhouse_…}    │
└───────────────┬─────────────────────────────────────────┘
                │ sqlx / oracle-rs / clickhouse
┌───────────────▼─────────────────────────────────────────┐
│ MySQL · MariaDB · PostgreSQL · SQLite · Oracle · CH      │
└─────────────────────────────────────────────────────────┘
```

### 1.2 数据流(看板取数的完整链路)

```
DashboardWidget.bindings.metricIds
  → semanticDataset(widget, metrics, scope)        semantic.ts:11
  → compileSemanticDataset(ds, metrics, filters, dialect)
      └→ compileMetric(m, {groupBy, scope, filters}) metricSql.ts:42
           └→ QueryPlan 渲染(sql / ratio / union)    queryPlan.ts
  → validateDatasetSql(sql)                        query.ts(TS 侧只读护栏)
  → api.runReadOnlyQuery(...)                      lib/api.ts:91
  → run_read_only_query                            commands.rs:377
  → prepare_dashboard_query                        readonly.rs(Rust 侧只读护栏)
  → 驱动执行
```

### 1.3 持久化边界

| 数据 | 位置 | 载体 |
|---|---|---|
| 看板文档 + 历史版本 | `app_config_dir/dashboards.json` + `dashboard-versions.json` | Rust,`Mutex` 串行 + 原子写(`dashboard_store.rs`) |
| 指标中心(153 个) | localStorage `dbstudio.metrics.v1` | zustand |
| ETL 源(13 源 / 300+ 作业) | localStorage `dbstudio.etlSources.v1` | zustand |
| 血缘扫描结果 | localStorage `dbstudio.lineage.v1` | zustand |
| 连接配置 | Rust 侧 + 系统钥匙串(密码) | — |
| AI 配置 | localStorage `ai.config` | zustand |

> 注意这个不对称:**看板在 Rust 磁盘上、有版本、原子写;指标却在 localStorage 里、没有版本、没有并发保护。** Agent 会大量读指标,只读没问题;但如果将来允许 AI 提出指标草案,这个不对称要先补上。

### 1.4 AI 现状(`src/features/ai/`,2,375 行)

- `aiClient.ts` —— OpenAI 兼容的**流式** chat。三种 provider:`builtin`(打包进 app 的 llama.cpp + Qwen2.5-Coder-7B)、`local`(LM Studio,默认 `http://127.0.0.1:1234/v1`,默认 model id `qwen3-30b-a3b`)、`cloud`。
- `prompt.ts` —— 拼 system prompt:方言 + 表结构(`pickRelevantTables` 做了一个很粗的相关性筛选,上限 25 张表)+ 指标提示(`MetricHint`,含口径/别名/编译后 SQL)。
- `context.ts` —— **跨模块实体档案**:围绕一张表,把血缘上下游、ETL 作业、运行健康、指标口径聚成一份紧凑文本。
- `readonly.ts` —— AI 产出的 SQL 插入/执行前的只读校验。
- `AiPanel.tsx` —— 聊天 UI,`seedAsk` 允许从任意位置注入问题(360 全景的「问 AI」就是它)。

**不存在的东西**(grep 全仓确认):
- tool calling / function calling —— 零
- structured output / JSON schema 约束 —— 零
- 任何 state machine / workflow / agent 编排 —— 零
- 日志 / 审计 / tracing —— 零(Rust 侧连 `log::` 都没有)
- 单元测试框架 —— 只有 `scripts/test-integration.mjs`(esbuild 打包后跑断言)和 `cargo test`(15 个)

---

## 2. Existing Reusable Capabilities

**可以原样复用、不用动的:**

| 能力 | 位置 | 对应 Agent 节点 |
|---|---|---|
| `Metric` 模型(口径/别名/单位/维度/精度/方向/分类) | `metricsStore.ts:14` | MetricPlanner / MetricValidator |
| `compileMetric()` 指标 → SQL | `metricSql.ts:42` | QueryPlanner |
| `compileSemanticDataset()` 多指标合并(同源合并 GROUP BY / 异源 UNION ALL) | `semantic.ts` | QueryPlanner |
| `QueryPlan`(sql / ratio / union 三态) | `queryPlan.ts` | QueryPlanner |
| `availableDimensions(metrics)` —— 多指标可用维度**求交** | `semantic.ts:8` | **MetricValidator 的核心** |
| `metricRollup(m)` —— 比率禁止求和 | `semantic.ts` | DataValidator |
| `metricSourceTables(m, lookup)` | `metricSql.ts:92` | MetricValidator(依赖检查) |
| `buildMetricHierarchy()` 指标树(渠道/线下线上分层) | `metricHierarchy.ts` | MetricPlanner(收敛候选集) |
| `executeDataset()` | `query.ts:100` | DataExecutor |
| 只读护栏(TS + Rust 双层,同一份 FORBIDDEN 词表,tokenize 而非正则,有测试) | `query.ts` / `readonly.rs:25` | 安全边界,白送 |
| `shiftScope()` 同比/环比区间平移(整月/整年识别 + 闰日夹取) | `useDashboardRuntime.ts` | **ScopeResolver** |
| 看板文档持久化 + 版本 + 原子写 | `dashboard_store.rs:97+` | DashboardExecutor |
| `placeWidget()` / `placeWidgetNear()` 网格避让 | `domain.ts:362 / :375` | DashboardDesigner |
| `createBoundWidget()` | `widgetFactory.ts` | DashboardExecutor |
| 90+ 字段的组件视觉 Schema | `domain.ts` | VisualizationPlanner |
| 跨模块实体档案 | `ai/context.ts` | RequirementAnalyzer 的上下文 |
| 列级相关性(指标 ↔ 字段) | `lineage/sqlColumns.ts` `fieldsUsedOn()` | MetricValidator / 影响面分析 |
| 三 provider 的 OpenAI 兼容客户端 | `aiClient.ts` | Model Provider 地基 |

**结论:语义层、执行层、安全层、持久层四样最难的东西,全都已经有了。** 缺的是它们上面的编排层,和把它们暴露成可程序调用接口的 Service 层。

---

## 3. Missing Capabilities

按"挡路程度"排序:

| # | 缺什么 | 为什么挡路 | 量级 |
|---|---|---|---|
| M1 | **headless 看板服务**(增删改组件/筛选器/数据集) | 现在全是 React 闭包,Tool 无法调用 | 中(抽取 + 回归) |
| M2 | **Tool 层**(schema 定义 / 参数校验 / 执行 / 错误规范化 / 审计) | Agent 的手 | 中 |
| M3 | **结构化输出客户端**(非流式 + JSON Schema + 失败重试 + 修复提示) | 每个节点都要 | 小 |
| M4 | **Agent 运行时**(state / node / edge / checkpoint / interrupt / retry) | 骨架 | 中 |
| M5 | **审计日志**(workflow / node / tool / token / 耗时 / 错误) | 你的第 12 节要求,也是唯一能回答"AI 为什么建了这个图"的东西 | 小 |
| M6 | **维度取值枚举 API**(`get_dimension_values`) | ScopeResolver 要解析"华东大区" | 小(从 `ComponentFilterBar.tsx:33` 抽出来) |
| M7 | **数据质量校验器**(空/重复/日期缺口/除零/负值/极值/总分对齐) | DataValidator 节点 | 中 |
| M8 | **分析原语**(同环比、贡献度分解、TopN/BottomN、趋势、结构变化、异常点) | AnalysisAgent 不应该让 LLM 心算 | 中 |
| M9 | **模型路由**(按节点角色选 provider/model/温度/超时) | 你的第 8 节要求 | 小 |
| M10 | **Human-in-the-loop UI**(澄清卡片 + 等待态 + 恢复) | 你的第 9 节要求 | 小~中 |
| M11 | **指标中心的并发/版本保护** | 只读阶段不挡路,允许 AI 提案时挡路 | 小 |
| M12 | 单元测试框架(目前只有集成断言脚本) | 你的第 8/14 条实施原则要求"每个节点可测" | 小 |

---

## 4. Proposed AI BI Architecture

```
┌───────────────────────────────────────────────────────────────┐
│ UI 层                                                          │
│  AgentPanel(时间线 / 节点状态 / 澄清卡片 / 中止 / 重跑某节点)   │
│  已有的 AiPanel 保留,作为"问答"入口,不承载 Agent              │
└──────────────────────────┬────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────┐
│ Agent Runtime   src/features/agent/                           │
│  graph.ts     节点 / 边 / 条件边 / 重试 / 回退 / interrupt      │
│  state.ts     AgentState(单一真相,不靠对话历史传状态)          │
│  checkpoint.ts 每节点落盘(复用 dashboard_store 的原子写模式)   │
│  audit.ts     workflow/node/tool 三级事件                      │
│  nodes/*.ts   13 个节点,每个一个文件、一份 JSON Schema、一组测试 │
└──────────────────────────┬────────────────────────────────────┘
          ┌────────────────┴────────────────┐
          │                                 │
┌─────────▼──────────┐          ┌───────────▼────────────┐
│ Model Layer        │          │ Tool Layer             │
│  provider.ts       │          │  registry.ts           │
│  router.ts(角色→模型)│         │  metric.*  dimension.* │
│  structured.ts     │          │  data.*    dashboard.* │
│  (JSON Schema 约束) │          │  component.* chart.*   │
└─────────┬──────────┘          └───────────┬────────────┘
          │                                 │
┌─────────▼──────────┐          ┌───────────▼────────────┐
│ LM Studio / llama  │          │ Service 层(M1 新增)     │
│ .cpp / cloud       │          │  dashboardService       │
└────────────────────┘          │  metricService          │
                                │  dataService            │
                                └───────────┬────────────┘
                                            │
                        ┌───────────────────▼───────────────────┐
                        │ 现有能力(不动)                        │
                        │ compileSemanticDataset / executeDataset│
                        │ readonly 护栏 / dashboard_store        │
                        └───────────────────────────────────────┘
```

**两条硬边界:**

1. **Agent 永远不直接碰 SQL 字符串、不直接碰 `invoke`。** 它只能产出结构化的 `SemanticQueryPlan`,由 Tool 交给现有的 `compileSemanticDataset`。
2. **Agent 永远不直接改 `DashboardDocument`。** 它只能调 `dashboardService` 的方法,由 Service 负责 schema 校验、网格避让、版本号递增。

---

## 5. Workflow Design

### 5.1 为什么不是 LangGraph

见第 0 节结论一。补一句实现层面的理由:LangGraph 的 checkpointer 抽象是为"跨进程恢复"设计的,这里的 state 全程在一个 JS 堆里,落盘只是为了"应用崩了能接着跑" —— 直接 `JSON.stringify` 到 `app_config_dir/agent-runs/<workflow_id>.json` 就够了,而且和看板的存储方式一致,排查时两份文件放一起看。

### 5.2 节点图

我把你给的 13 个节点收敛成 **11 个**,合并了两处:

- `MetricPlanner` + `MetricValidator` → 保持分开(**不合并**,因为 Validator 必须是纯代码、零 LLM,这是防幻觉的关键闸门)
- `VisualizationPlanner` + `DashboardDesigner` → **合并为 `LayoutDesigner`**。理由:图表选型和布局是同一个设计决策("这个指标做成 KPI 放顶部"是一句话,拆成两个节点会让第二个节点反复推翻第一个)。
- `DashboardExecutor` **不用 LLM**,是纯粹的 plan → service 调用翻译器。

```
                    ┌──────────────┐
                    │ UserRequest  │
                    └──────┬───────┘
                           ▼
                 ┌──────────────────┐
                 │ RequirementAnalyzer│  LLM·强推理
                 └─────────┬─────────┘
                           ▼
                 ┌──────────────────┐        歧义
                 │  ScopeResolver   │──────────────┐
                 └─────────┬────────┘              │
                           ▼                       ▼
                 ┌──────────────────┐      ┌───────────────┐
                 │  MetricPlanner   │      │ AWAITING_USER │
                 └─────────┬────────┘      └───────┬───────┘
                           ▼                       │
                 ┌──────────────────┐  缺指标        │
                 │ MetricValidator  │───────────────┤
                 │  ★ 零 LLM         │              │
                 └─────────┬────────┘              │
                           ▼                       │
                 ┌──────────────────┐              │
                 │   QueryPlanner   │◄─────────────┘
                 └─────────┬────────┘   ▲
                           ▼            │ 回退①
                 ┌──────────────────┐   │
                 │   DataExecutor   │   │
                 │  ★ 零 LLM         │   │
                 └─────────┬────────┘   │
                           ▼            │
                 ┌──────────────────┐   │
                 │  DataValidator   │───┘ FAIL
                 │  ★ 零 LLM         │
                 └─────────┬────────┘
                           ▼ PASS
                 ┌──────────────────┐
                 │  AnalysisAgent   │  LLM·强推理(结论必须引证据)
                 └─────────┬────────┘
                           ▼
                 ┌──────────────────┐◄──────┐
                 │  LayoutDesigner  │       │ 回退②
                 │  LLM·设计         │       │
                 └─────────┬────────┘       │
                           ▼                │
                 ┌──────────────────┐       │
                 │DashboardExecutor │       │
                 │  ★ 零 LLM         │       │
                 └─────────┬────────┘       │
                           ▼                │
                 ┌──────────────────┐       │
                 │DashboardReviewer │───────┘ NEEDS_REVISION
                 │  半 LLM(见下)     │
                 └─────────┬────────┘
                           ▼ PASS
                 ┌──────────────────┐
                 │  FinalResponse   │
                 └──────────────────┘
```

★ 标记的 5 个节点**完全不调用 LLM**。这是有意的:它们是防幻觉的骨架。LLM 只负责"想",代码负责"验"。

### 5.3 条件边

```ts
// 每条回退边都带 maxRetry,超了就转 FAILED 并如实告诉用户卡在哪
addConditionalEdge("ScopeResolver", (s) =>
  s.scope.ambiguities.length ? "AwaitingUser" : "MetricPlanner");

addConditionalEdge("MetricValidator", (s) =>
  s.missingMetrics.length && !s.validatedMetrics.length ? "AwaitingUser"   // 全缺 → 问人
  : s.missingMetrics.length                            ? "QueryPlanner"   // 部分缺 → 降级继续,结尾如实说明
  :                                                      "QueryPlanner");

addConditionalEdge("DataValidator", (s) =>
  s.validation.status === "pass"                    ? "AnalysisAgent"
  : s.retry.queryPlanner < 2                        ? "QueryPlanner"      // 回退①
  :                                                   "Failed");

addConditionalEdge("DashboardReviewer", (s) =>
  s.review.verdict === "pass"                       ? "FinalResponse"
  : s.retry.layout < 2                              ? "LayoutDesigner"    // 回退②
  :                                                   "FinalResponse");   // 带瑕疵交付,但如实列出
```

**关于回退的一条原则:回退次数用尽时,不要假装成功。** 宁可交付一个标注了"以下 2 项未能自动修复"的看板,也不要让 Reviewer 降低标准放行。

### 5.4 Human in the Loop

`AWAITING_USER` 不是一个节点,是 workflow 的一个**状态**:

```ts
type WorkflowStatus =
  | "running" | "awaiting_user" | "done" | "failed" | "cancelled";

interface Clarification {
  nodeId: string;                 // 谁问的 —— 恢复时从这里继续
  question: string;               // "华北有 3 个组织口径,你指哪个?"
  options: { value: string; label: string; hint?: string }[];
  allowFreeText: boolean;
}
```

落盘 → UI 渲染成卡片 → 用户点选 → `resume(workflowId, answer)` → 从 `nodeId` 重入。

**必须触发澄清的场景**(写死在代码里,不靠 prompt):

1. 维度取值模糊匹配命中 > 1(`get_dimension_values` 返回多个近似)
2. 指标名模糊匹配命中 > 1 且分数接近(利润 → 毛利/营业利润/净利润/贡献利润)
3. 时间表述无法落到确定区间("最近"、"这段时间")
4. `MetricValidator` 判定全部候选指标不可用

---

## 6. State Design

```ts
// src/features/agent/state.ts
export interface AgentState {
  // ── 身份与控制 ─────────────────────────────────
  workflowId: string;
  createdAt: string;
  status: WorkflowStatus;
  currentNode: string;
  retry: Record<string, number>;          // nodeId → 已重试次数
  errors: AgentError[];
  clarification?: Clarification;          // status=awaiting_user 时有值

  // ── 输入 ───────────────────────────────────────
  userRequest: string;
  connId: string;                         // 锁定在一个连接上,不跨库
  locale: "zh-CN";

  // ── RequirementAnalyzer ───────────────────────
  requirement?: {
    goal: string;                         // 一句话:用户到底想知道什么
    subject: string;                      // 分析主体:营业 / 会员 / 供应链…
    audience?: "management" | "operation" | "analyst";
    comparisons: ("mom" | "yoy" | "none")[];
    candidateDimensions: string[];        // 只是候选,未验证
    candidateMetricTerms: string[];       // 自然语言词,不是 metric id
  };

  // ── ScopeResolver ─────────────────────────────
  scope?: {
    dateRange: { start: string; end: string };
    grain: "day" | "week" | "month" | "year";
    comparisonRanges: { kind: "mom" | "yoy"; start: string; end: string }[];
    filters: { field: string; values: string[]; resolvedFrom: string }[];
    ambiguities: Clarification[];
  };

  // ── Metric 规划与验证 ──────────────────────────
  plannedMetrics?: { term: string; role: "primary" | "secondary" | "context"; why: string }[];
  validatedMetrics?: ValidatedMetric[];   // 见下
  missingMetrics?: { term: string; reason: string; suggestion?: string }[];

  // ── Query ─────────────────────────────────────
  queryPlans?: SemanticQueryPlan[];       // 每个图一个
  datasets?: Record<string, DatasetResult>;  // planId → 结果 + 元信息

  // ── 校验与分析 ─────────────────────────────────
  validation?: { status: "pass" | "warn" | "fail"; issues: ValidationIssue[] };
  insights?: Insight[];                   // 每条必须带 evidence

  // ── 设计与产出 ─────────────────────────────────
  layout?: LayoutPlan;                    // 图表选型 + 网格布局 + 视觉配置
  dashboardId?: string;
  widgetIds?: string[];
  review?: { verdict: "pass" | "needs_revision"; findings: ReviewFinding[] };

  // ── 审计 ───────────────────────────────────────
  usage: { node: string; model: string; promptTokens: number;
           completionTokens: number; ms: number }[];
}

export interface ValidatedMetric {
  metricId: string;                       // 指标中心的真实 id
  name: string;
  unit: string;
  caliber: string;                        // 原样带上,AnalysisAgent 写结论要引用
  rollup: DashboardMetricAggregation;     // metricRollup() 的结果
  supportedDimensions: string[];          // availableDimensions() 求交后的
  dateScoped: boolean;
  derivedFrom?: { op: "divide"|"add"|"subtract"; operands: string[] };
}

export interface Insight {
  kind: "trend" | "yoy" | "mom" | "topn" | "bottomn" | "contribution"
      | "structure_shift" | "anomaly";
  headline: string;                       // 「华东大区销售额同比下降 8.2%」
  evidence: {                             // ★ 没有 evidence 的 insight 一律丢弃
    planId: string;
    rows: Array<Record<string, unknown>>; // 支撑这句话的原始行
    computedBy: string;                   // 哪个分析原语算的,便于复核
  };
  severity: "info" | "warn" | "critical";
}
```

**三条 State 设计纪律:**

1. **节点之间只传 State,不传自然语言。** 唯一的长文本是 `insights[].headline`,而它必须挂 `evidence`。
2. **State 可序列化、可 diff。** 这样"AI 为什么建了这个图"能通过 diff 两个 checkpoint 回答。
3. **不把 `datasets` 的全量行塞进 State 落盘。** 超过 500 行只留 `{columns, sampleRows, rowCount, checksum}`,全量结果放内存 + 单独文件。否则 checkpoint 文件会爆。

---

## 7. Tool Design

标记:🟢 已有可直接包 · 🟡 需从组件里抽出来 · 🔴 需新写

### Metric Tools

| Tool | 状态 | 来源 / 说明 |
|---|---|---|
| `list_metrics({category?, enabled?})` | 🟢 | `useMetrics.getState().metrics` |
| `search_metrics({terms[]})` | 🔴 | 按 `name`/`aliases`/`key` 模糊匹配 + 打分,返回 top-k 和分数。**必须返回多个候选而不是选一个** —— 选择权交给 MetricValidator/用户 |
| `get_metric_definition({metricId})` | 🟢 | 直接返回 `Metric`,含 caliber |
| `get_metric_hierarchy()` | 🟢 | `buildMetricHierarchy()` —— 让 LLM 知道"销售额→线下/线上→各渠道"的父子关系 |
| `validate_metric_combination({metricIds, dimensions, grain})` | 🟡 | 核心是已有的 `availableDimensions()` 求交 + `planDimensions()`;再加粒度/时间字段检查 |
| `resolve_derived_metric({op, operands})` | 🔴 | 只允许 `divide/add/subtract/multiply` 四则,且操作数必须都是已验证 metricId。**任何需要新写 SQL 表达式的,一律拒绝并返回 missing** |

### Dimension Tools

| Tool | 状态 | 说明 |
|---|---|---|
| `list_dimensions({metricIds})` | 🟢 | `availableDimensions()` |
| `get_dimension_values({metricId, field, limit})` | 🟡 | 从 `ComponentFilterBar.tsx:33` 抽出来,复用 `executeDataset({...ds, groupBy:[field]})` |
| `resolve_dimension_value({field, text})` | 🔴 | "华东" → 精确/前缀/包含三级匹配,命中 >1 时**返回候选列表让上层触发澄清**,绝不自己挑 |

### Data Tools

| Tool | 状态 | 说明 |
|---|---|---|
| `build_query_plan({metrics, dimensions, filters, dateRange, grain})` | 🟡 | 包 `semanticDataset()` + `compileSemanticDataset()`,返回 `{sql, connectionId, database}` 供审计,但 **SQL 不回传给 LLM**(防止它学着改) |
| `execute_query_plan({planId, maxRows})` | 🟢 | 包 `executeDataset()` —— 只读护栏自动生效 |
| `preview_dataset({planId, rows})` | 🔴 | 返回前 N 行 + 列类型,给 LLM 看结构而不是全量数据 |
| `validate_dataset({planId, expectations})` | 🔴 | 见第 12 节 |

### Dashboard Tools(全部依赖 M1)

| Tool | 状态 |
|---|---|
| `create_dashboard({title, description})` | 🟡 `dashboardRepository.save()` 已有,但构造 document 的逻辑在组件里 |
| `get_dashboard({id})` | 🟢 |
| `update_dashboard_meta({id, title?, description?, refreshInterval?, metricScope?})` | 🟡 |
| `delete_dashboard({id})` | 🟢 |
| `publish_dashboard({id})` | 🟢 |

### Component Tools(全部依赖 M1)

| Tool | 状态 | 说明 |
|---|---|---|
| `add_component({dashboardId, type, metricIds, dimensions, title})` | 🟡 | `createBoundWidget()` + `placeWidget()` 已有 |
| `update_component({componentId, patch})` | 🟡 | patch 走 JSON Schema 校验,**白名单字段**,不允许整体替换 |
| `delete_component` / `move_component` / `resize_component` | 🟡 | 已有 `placeWidget` 的避让逻辑 |
| `set_component_scope({componentId, lockedScope})` | 🟡 | `options.lockedScope` 已存在 —— 同比/环比卡片就靠它 |

### Chart Tools

**建议不要做成 12 个独立的 setter。** 现有 Schema 是一个嵌套对象,12 个 setter 意味着 12 次 LLM 往返、12 次审计、12 次可能失败。改成:

| Tool | 状态 | 说明 |
|---|---|---|
| `style_component({componentId, chart?, kpi?, table?, text?, appearance?})` | 🟡 | 一次调用,内部按 JSON Schema 校验,逐字段白名单合并。Schema 直接从 `domain.ts` 的类型生成 |

这样 LLM 一次给出完整视觉配置,校验器逐字段挑错并回报**具体哪个字段不合法**,比 12 个 setter 更省 token 也更好调试。

### 所有 Tool 的统一契约

```ts
interface ToolResult<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: "INVALID_ARGS" | "NOT_FOUND" | "UNSUPPORTED" | "BACKEND_ERROR"
        | "MISSING_METRIC" | "AMBIGUOUS";
    message: string;                 // 给 LLM 看的,必须说清怎么改
    details?: unknown;
  };
  audit: { tool: string; ms: number; inputHash: string };
}
```

**错误信息要写给 LLM 看。** `"维度 war_zone 不被指标 avg_order_value 支持,该指标可用维度:day, month, store, channel"` 远好于 `"invalid dimension"` —— 前者能让模型自己修,后者只能触发重试。

---

## 8. Metric Layer Integration

### 8.1 四条铁律(写进代码,不写进 prompt)

1. **Agent 只能引用 `metricId`,不能产生指标表达式。** `SemanticQueryPlan.metrics` 的类型是 `string[]`(metric id),不是任何 SQL 片段。类型系统层面就堵死。
2. **派生只允许在已验证指标之间做四则运算**,且结果必须能表达成 `resolve_derived_metric` 的入参。笔均金额 = GMV ÷ 订单量 ✅;"剔除节假日的 GMV" ❌(那是新口径)。
3. **`MetricValidator` 零 LLM。** 它是纯函数:输入 `{terms, dimensions, grain, dateRange}`,输出 `{validated, missing}`。可以单测,可以 mock,可以回归。
4. **缺指标 = 如实上报,不降级编造。** `missingMetrics[].reason` 要具体:`"未找到「毛利率」;最接近的是「毛利额」(v1:gross_profit),但它不是比率型,无法直接当毛利率用"`。

### 8.2 MetricValidator 的具体算法

```
输入:candidateMetricTerms(自然语言),dimensions,grain,dateRange

1. 每个 term 走 search_metrics:
   - 精确匹配 name / key → 分数 1.0
   - 命中 aliases → 0.9
   - 包含匹配 → 0.6
   - 同一 family(metricHierarchy)内的兄弟 → 0.4(作为候选提示,不直接采用)
   分数 < 0.6 → 进 missing

2. 命中多个且 top1 与 top2 分差 < 0.15 → 进 ambiguities(触发澄清)

3. 对选中的 metricIds:
   - availableDimensions(metrics) 求交 → supported
   - 请求的 dimensions ⊄ supported → 该维度进 missing,并给出 supported 列表
   - metric.timeField 为空且 type ∈ {measure, ratio} → 标记 dateScoped=false
     → 该指标不能做同比/环比(否则平移周期取到同值,得到误导性的 0%)
   - metricRollup(m) === "avg" → 标记"不可跨行求和",传给 DataValidator

4. 输出 ValidatedMetric[] + missing[]
```

第 3 步里 `dateScoped` 那条是从现有代码学来的 —— `DashboardMetricDefinition.dateScoped` 的注释已经踩过这个坑:"false 时同比/环比无意义,KPI 显示 `--` 而非误导的 0%"。Agent 必须继承这个判断。

### 8.3 允许 AI 提指标草案吗?

**建议:Phase 5 之前一律不允许。** 到那时也只能是:

- AI 产出 `MetricDraft`(name / caliber / 建议表达式 / 依据)
- 写进一个独立的"待审"区,`enabled: false`
- **必须人工在指标中心点确认才生效**
- 永远不能被同一次 workflow 自己拿来用

否则"AI 编指标 → AI 用自己编的指标 → AI 说数据没问题"这个闭环一旦形成,整个系统的可信度归零。

---

## 9. Dashboard Integration

### 9.1 Phase 0 抽取方案

```ts
// src/features/dashboard/dashboardService.ts —— 新增,纯函数 + 一个 store
export interface DashboardService {
  create(input: { title: string; description?: string }): DashboardDocument;
  addWidget(doc: DashboardDocument, input: AddWidgetInput): { doc: DashboardDocument; widgetId: string };
  updateWidget(doc: DashboardDocument, id: string, patch: WidgetPatch): DashboardDocument;
  deleteWidget(doc: DashboardDocument, id: string): DashboardDocument;
  moveWidget(doc: DashboardDocument, id: string, pos: {x,y,w,h}): DashboardDocument;
  addFilter(doc: DashboardDocument, input: AddFilterInput): DashboardDocument;
  setScope(doc: DashboardDocument, scope: QueryScope): DashboardDocument;
}
```

全部设计成 **`(doc, input) => doc` 的纯函数**。这样:

- `DashboardWorkspace.tsx` 改成 `updateDocument(d => service.addWidget(d, input).doc)` —— 撤销/重做逻辑完全不用改
- Agent Tool 直接调同一组函数
- 每个函数单测一行搞定

**回归风险点**(改这块时必须验的):撤销/重做、容器子组件的布局作用域(`sameLayoutScope`)、复制组件时的子组件连带、`resolveWidgetLayout` 的避让。

### 9.2 Agent 建看板的流程

```
LayoutDesigner 产出 LayoutPlan(纯数据)
   ↓
DashboardExecutor(零 LLM):
   1. service.create({title})
   2. for each item in plan.items:
        service.addWidget(doc, {type, metricIds, dimensions, title})
        service.updateWidget(doc, id, {options: item.style})   ← 白名单校验
        service.moveWidget(doc, id, item.grid)
   3. service.setScope(doc, state.scope)
   4. dashboardRepository.save(doc)           ← 落 Rust 磁盘,拿到 revision
   5. 记 audit:{workflowId → dashboardId}
```

**一次性建完再保存,不要边建边存。** 中途失败就整体丢弃,不留半截看板。

### 9.3 怎么让用户看见"AI 为什么这么建"

`DashboardDocument` 加一个可选字段:

```ts
aiProvenance?: {
  workflowId: string;
  userRequest: string;
  createdAt: string;
  widgetReasons: Record<string, string>;  // widgetId → "选柱图因为渠道是 8 个分类,饼图会挤"
};
```

UI 上在组件右上角给一个小 ✨,悬停显示理由。这个字段是可选的,老看板不受影响,导出 HTML 时剥掉。

---

## 10. Component Schema Gap

通读 `domain.ts` 的结果 —— 你第五节列的能力清单对照:

| 你要的 | 现状 |
|---|---|
| chart type | ✅ `DashboardWidgetType` |
| title | ✅ `widget.title` |
| **subtitle** | ❌ **缺** |
| metric / dimension | ✅ `bindings` |
| colors / palette | ✅ `chart.palette` + `chart.dimensionColors` + `appearance.visualPreset`(16 套预设) |
| legend | ✅ `options.showLegend` + `chart.pieLegendPosition` |
| data labels | ✅ `chart.showLabels` / `barShowValues` / `pieShowLabels` |
| **tooltip 配置** | ⚠️ 渲染层有(自由十字光标 `freeCrosshair.ts`),但**没有 schema 字段** |
| **axis 配置**(min/max/标题/刻度) | ❌ **缺** |
| number format | ⚠️ 有 `decimals` / `percentDecimals` / `grouping`(千位符),**缺** 单位换算(万/亿)和自定义前后缀 |
| unit | ✅ `metrics[].unit`(来自指标中心) |
| decimal places | ✅ |
| sort | ✅ `table.dimensionSorts` + `chart.lineTimeOrder` + `table.timeOrder` |
| Top N | ✅ `options.topN` |
| comparison display | ✅ `kpi.showComparison` / `comparisonLayout` / `chart.showComparison` |
| grid / padding | ✅ `appearance.padding` / `radius` / `borderWidth` |
| component size / position | ✅ `x,y,w,h`(12 栏网格) |
| drilldown | ✅ `chart.drillDimensions`(多级) |
| interaction / filter linkage | ✅ `filters[].scope: "global"`(按字段联动所有含该维度的图) |
| **图表说明文字 / 脚注** | ❌ **缺**(AI 想标注"数据截至 X 日"无处可放) |
| **参考线 / 目标值** | ❌ **缺**(管理层看板常要一条目标线) |

**结论:5 个缺口,全是小改动。**

1. `widget.subtitle?: string`
2. `chart.axis?: { yMin?, yMax?, yTitle?, xTitle?, splitLine? }`
3. `chart.tooltip?: { mode: "item"|"axis", showAll?: boolean }`
4. `options.numberFormat?: { scale?: "none"|"wan"|"yi", prefix?, suffix? }`
5. `widget.footnote?: string` + `chart.markLine?: { value: number; label: string }[]`

这 5 项加起来大概 1 天工作量(含渲染层),而且**对人工建看板也是净收益**,不算 AI 专属成本。

---

## 11. Model Strategy

### 11.1 现状与改造

`AiConfig`(`aiStore.ts:10`)已经有 `builtin | local | cloud` 三态,但是**单一全局配置** —— 整个应用共用一个模型。Agent 需要按节点角色路由。

```ts
// src/features/agent/model/router.ts
export type NodeRole =
  | "reasoning"     // RequirementAnalyzer / MetricPlanner / AnalysisAgent
  | "structured"    // ScopeResolver / QueryPlanner
  | "design"        // LayoutDesigner
  | "review"        // DashboardReviewer
  | "cheap";        // 简单结构转换、文本归一化

export interface ModelBinding {
  provider: AiProvider;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  jsonMode: "schema" | "json_object" | "prompt";  // 按端点能力降级
}

// 默认:全部指向 local(LM Studio),温度按角色分化
const DEFAULTS: Record<NodeRole, Partial<ModelBinding>> = {
  reasoning:  { temperature: 0.3, maxTokens: 2048 },
  structured: { temperature: 0.0, maxTokens: 1536 },
  design:     { temperature: 0.5, maxTokens: 2048 },
  review:     { temperature: 0.1, maxTokens: 1536 },
  cheap:      { temperature: 0.0, maxTokens: 512  },
};
```

UI 上在 AI 设置里加一页"Agent 模型路由",默认全部跟随全局,允许单独覆盖。

### 11.2 结构化输出

这是第一阶段最关键的技术风险,单独说。

```ts
// src/features/agent/model/structured.ts
export async function callStructured<T>(
  role: NodeRole,
  schema: JSONSchema,        // 从 TS 类型生成
  messages: ChatMessage[],
): Promise<T>;
```

三级降级策略(按端点能力探测):

1. **`response_format: {type:"json_schema", json_schema:{...}}`** —— LM Studio 新版和 OpenAI 支持,是最可靠的
2. **`response_format: {type:"json_object"}`** + schema 写进 prompt
3. **纯 prompt 约束** + 从回复里提取第一个 ``` 代码块

无论哪级,**返回后一律用同一个 validator 校验**;失败时把校验错误原文回灌给模型重试(最多 2 次):

```
你上一次的输出不符合 schema:
  - scope.dateRange.start: 期望 YYYY-MM-DD,得到 "上个月"
请只输出修正后的 JSON,不要解释。
```

> 关于 LM Studio + Qwen3 30B-A3B(你说的 35B-A3B):`buildChatRequest`(`aiClient.ts:36`)里已经有 `chat_template_kwargs.enable_thinking` 的处理。Agent 场景建议 **thinking 打开给 reasoning 角色、关闭给 structured 角色** —— 开着 thinking 时模型会在 JSON 前吐一段推理,需要额外剥离,对结构化输出是负担。

### 11.3 Provider 抽象

不要把 `streamChat` 改造成 Agent 用的东西,而是**在它旁边加一个 `complete()`**(非流式 + 结构化),共用 `resolveEndpoint()`。流式聊天和结构化调用是两种不同的东西,硬合会两边都难受。

---

## 12. Validation Strategy

### 12.1 数据层(DataValidator,零 LLM)

| 检查 | 判定 | 处理 |
|---|---|---|
| 结果为空 | `rowCount === 0` | FAIL → 回退 QueryPlanner(可能是筛选条件过严) |
| 维度取值重复 | 同一 `(dims...)` 组合出现多行 | FAIL → 说明 GROUP BY 有问题 |
| 日期缺口 | 按 grain 展开区间,缺失日期数 / 总数 > 20% | WARN → 结论里必须注明 |
| 除零 | 比率型指标的分母列存在 0 | WARN + 标记受影响行 |
| NULL | 指标列 NULL 占比 > 10% | WARN |
| 异常负值 | `higherIsBetter !== undefined` 且单位是「元/单/个」的指标出现负值 | WARN |
| 极端值 | 单点 > 中位数 × 20 | WARN → 交给 AnalysisAgent 当异常点分析,不是错误 |
| **同比周期正确性** | 用 `shiftScope()` 独立算一遍,和 plan 里的区间比对 | FAIL(不一致说明 plan 算错了) |
| **总分对齐** | 分组查询各行按 `metricRollup` 汇总 vs 单独查的总计,相对误差 > 0.5% | FAIL → 这是最能抓出口径错误的一条 |
| 比率型被求和 | `metricRollup(m) === "avg"` 却在做跨行求和 | FAIL(硬错) |

**"总分对齐"这条要多花一次查询,但它是整套方案里性价比最高的校验** —— 它能抓出 JOIN 放大、维度笛卡尔积、筛选未下推这几类最隐蔽的错误。

### 12.2 指标层

见 8.2。核心是:MetricValidator 通过 = 口径可信,因为口径来自指标中心而非 LLM。

### 12.3 看板层(DashboardReviewer,半 LLM)

**先跑纯代码规则,再让 LLM 看剩下的。**

代码规则(确定性,不需要 LLM):

```
R1  饼图分类数 > 8              → NEEDS_REVISION(改横向条形图)
R2  x 轴是时间维度但图表类型是饼图 → NEEDS_REVISION
R3  排名类图表未设置 sort        → NEEDS_REVISION
R4  两个组件 (metricIds, dimensions, type) 完全相同 → 重复表达
R5  KPI 不在最上面一行(y != 0)  → NEEDS_REVISION
R6  组件超出 12 栏 / 相互重叠     → NEEDS_REVISION(其实 placeWidget 已保证)
R7  看板总高度 > 40 行           → 太长,建议分 tab
R8  数据标签开启 且 单图数据点 > 30 → 标签会糊成一团
R9  比率型指标的 decimals > 2     → 无意义精度
R10 任何组件绑定的指标未出现在 validatedMetrics → 严重错误,直接 FAIL
```

LLM 规则(需要判断力):信息层级是否符合阅读顺序、标题是否说人话、有没有该放没放的明细支撑。

Reviewer 输出:

```ts
interface ReviewFinding {
  layer: "data" | "chart" | "dashboard";
  severity: "must_fix" | "should_fix" | "nit";
  target: { widgetId?: string; field?: string };
  reason: string;
  suggestedFix: { tool: string; args: unknown };  // 直接给可执行的修法
}
```

`suggestedFix` 让回退变成"应用这个 patch"而不是"重新设计一遍",快得多也稳得多。

---

## 13. Implementation Phases

### Phase 0 —— 地基(和 AI 无关,先做)

- **目标**:看板改写变成可程序调用的纯函数;抽出维度取值 API
- **模块**:`dashboardService.ts`(新)、`DashboardWorkspace.tsx`(改)、`ComponentFilterBar.tsx`(抽 `load`)
- **另外**:补 5 个 Schema 缺口(第 10 节)
- **风险**:撤销/重做、容器子组件布局的回归
- **验收**:
  - `DashboardWorkspace.tsx` 行数下降 ≥ 25%
  - 每个 service 函数有单测
  - 手工建看板的全流程(建/改/删/复制/容器/撤销/发布)无回归
- **不做**:任何 AI 相关的东西

### Phase 1 —— Tool 层 + 结构化输出

- **目标**:Agent 的"手"和"嘴"就位,但还没有"脑"
- **模块**:`agent/tools/*`、`agent/model/structured.ts`、`agent/audit.ts`
- **风险**:LM Studio 的 json_schema 支持程度未知 —— **这是第一个要验的事**
- **验收**:
  - 一个 `/agent-debug` 面板,可以手工调任意 Tool 并看到结构化输入输出
  - `callStructured` 对着本地模型跑 20 次,schema 合规率 ≥ 95%(含重试)
  - 每个 Tool 有独立测试,可在无模型、无数据库的情况下跑

### Phase 2 —— 只读分析闭环(不建看板)

- **目标**:走通 `RequirementAnalyzer → ScopeResolver → MetricPlanner → MetricValidator → QueryPlanner → DataExecutor → DataValidator → AnalysisAgent`,输出**文字分析报告**
- **模块**:`agent/graph.ts`、`agent/state.ts`、前 8 个节点
- **风险**:本地 30B 模型的推理质量;Prompt 长度
- **验收**:
  - "分析 8 月经营情况,对比 7 月和去年 8 月" 能跑通并给出带 evidence 的结论
  - 故意问一个不存在的指标(如"毛利率"),必须返回 missing 而不是编
  - 全程 checkpoint 可回放
- **这个阶段就已经有独立价值了** —— 即使永远不做建看板,一个"会自己查数、自己校验、自己下结论"的分析助手也够用。

### Phase 3 —— 看板生成

- **目标**:接上 `LayoutDesigner → DashboardExecutor → DashboardReviewer → FinalResponse`
- **模块**:后 3 个节点 + `aiProvenance`
- **风险**:布局质量不稳定;Reviewer 和 Designer 互相打架导致震荡
- **验收**:
  - 同一个请求跑 5 次,5 次都能产出**可用**(非完美)的看板
  - Reviewer 的 10 条代码规则全部有单测
  - 回退最多 2 轮,不出现震荡

### Phase 4 —— Human in the Loop + 审计 UI

- **目标**:澄清卡片、等待/恢复、AgentPanel 时间线、"为什么建这个图"
- **验收**:歧义场景(华北 / 利润)必定停下来问,不猜

### Phase 5 —— 模型路由 + 云模型

- **目标**:按角色路由;接入云端强模型做 reasoning / design,本地模型做 structured / cheap
- **验收**:同一 workflow 在"全本地"和"混合"两种配置下都能跑完

### Phase 6(可选)—— 指标草案

- 见 8.3。**默认不做。**

---

## 14. Risks

| 风险 | 影响 | 对策 |
|---|---|---|
| **本地 30B 模型能力不足** | 整个方案的地基 | Phase 1 就先测 schema 合规率;不达标就把 reasoning/design 角色切云模型,本地只跑 structured。**这个测试要最早做,它决定方案是否成立** |
| LLM 幻觉指标 | 数出错,最严重 | 类型系统堵死(只能传 metricId);MetricValidator 零 LLM;缺就报缺 |
| LLM 幻觉维度取值 | 筛出空结果 | `resolve_dimension_value` 必须查库,命中多个就澄清 |
| Agent 无限循环 | 卡死、烧 token | 每条回退边带 `maxRetry`;全局节点执行上限 30;全局超时 10 分钟;UI 随时可中止 |
| Reviewer ↔ Designer 震荡 | 反复改不收敛 | Reviewer 给 `suggestedFix` 直接打 patch,而不是让 Designer 重设计;第 2 轮仍不过就带瑕疵交付并如实说明 |
| Prompt 过长 | 本地模型上下文爆 | State 传结构化数据而非对话历史;表结构走 `pickRelevantTables`;指标只传候选 top-k 而非 153 个;`datasets` 只传 sampleRows |
| State 过大 | checkpoint 文件爆 | 大结果集只存元信息 + checksum,全量另存 |
| Tool 调用错误 | 流程中断 | 统一 `ToolResult` + 面向 LLM 的错误信息;所有 Tool 可独立测试 |
| 看板质量不稳定 | 用户失望 | 10 条代码规则兜底;`aiProvenance` 让用户看得懂为什么;生成的看板默认 `status: "draft"`,人工确认才发布 |
| **抽取 dashboardService 引入回归** | 现有功能坏掉 | Phase 0 单独做、单独验、单独发一个版本;不和 AI 代码混在一个 commit |
| Token 成本(云模型) | 花钱 | 审计里记 token;默认本地;云模型只给 reasoning/design 两个角色 |
| 误判"数据没问题" | 最危险 —— 错的数被当成对的 | DataValidator 零 LLM;"总分对齐"必查;任何 FAIL 一律不准进入出图阶段 |
| 公司数据边界 | 数据泄漏 | Agent 默认只连本机配置的连接;云模型只发送**结构和聚合后的少量样本行**,不发明细;这条要在 Phase 5 接云模型前专门设计并让你确认 |

---

## 附:我建议砍掉/改掉的部分

为了不显得全盘照收,把和你原设定不一致的地方集中列出来:

1. **LangGraph → 自研 TS 状态机**(理由见结论一)
2. **VisualizationPlanner + DashboardDesigner 合并**为 `LayoutDesigner`(避免两节点互相推翻)
3. **12 个 chart setter → 1 个 `style_component`**(省 token、好调试、错误定位更准)
4. **DashboardExecutor 不用 LLM**(它是翻译器,不是决策者)
5. **DataValidator / MetricValidator / DashboardReviewer 的代码规则部分零 LLM**(防幻觉的关键)
6. **Phase 2 就该独立交付**(只读分析本身有价值,不必等看板生成)
7. **指标草案(Phase 6)默认不做**(闭环自证是可信度的致命伤)

---

## 下一步

最该先做、且能立刻验证方案是否成立的一件事:

> **拿 LM Studio 里的 Qwen3 30B-A3B,对着一个真实的 `ScopeResolver` schema 跑 20 次结构化输出,看合规率。**

这件事一天之内能出结论,而且结果直接决定:
- 合规率高 → 按 Phase 0→6 推进
- 合规率低 → 要么换模型,要么把 structured 角色改成"模板填空 + 代码解析"的保守路线

在这之前做任何编排层的工作都有可能白做。

---

# 附录 A · 可行性实验结果(2026-09-11 实测)

> 报告正文最后说"最该先做的一件事是测本地模型的结构化输出合规率"。已经做完,数据如下。
> 环境:LM Studio + `qwen/qwen3.6-35b-a3b`(不是配置里写的 `qwen3-30b-a3b`,见 A.4)。
> 用例:10 条真实中文分析请求,每条带人工核对过的期望区间;`temperature: 0`。
> **量两件事**:schema 合规率(能不能解析+过 schema)和**语义正确率**(日期/同环比/筛选真的算对了)。
> 只量前者是自欺欺人 —— schema 过了但日期错,对 BI 是更危险的失败。

## A.1 结论:方案成立

| 模式 | 次数 | 过 schema | 语义正确 | 中位耗时 | 输出 token |
|---|---|---|---|---|---|
| `json_schema` 强约束 · 关思考 | 20 | **20/20 (100%)** | 18/20 (90%) | 1.97s | 142 |
| 纯 prompt 约束 · 关思考 | 10 | **10/10 (100%)** | 9/10 (90%) | 4.85s | 200 |
| `json_schema` · 开思考 | 10 | 10/10(需兜底,见 A.3) | 8/10 (80%) | 1.65s | 115+114 思考 |
| `json_object` | 10 | — | — | — | **LM Studio 直接 400** |

**100% 的 schema 合规率,零重试。** 本地 35B-A3B 完全扛得住结构化输出,Phase 0→6 的路线成立。

剩下 10% 的语义错误全部集中在**同一条用例**(`"对比一下今年8月和7月的销售额"`),而且 `temperature:0` 下每次都错得一模一样 —— 这不是模型不稳定,是**我的 prompt 没定义"用户并列提到两个周期时谁是主周期"**。补上这条规则后这条过了,但"去年全年销售额"又开始自作主张加同比。

**这个打地鼠现象比合规率数字本身更有价值**,它直接催生了 A.2。

## A.2 重要发现:不要让 LLM 算日期

实验一的错误全是**日期算术**错误,不是格式错误。于是试了第二种分工:

```
原方案  LLM → {"dateRange":{"start":"2026-08-01","end":"2026-08-31"}, ...}   模型做算术
新方案  LLM → {"period":{"kind":"last_month"}, "comparisons":["mom","yoy"]}  模型只分类
        代码 → resolvePeriod() / shiftRange() 算出确定区间
```

同一批用例、同一个模型:

| | 过 schema | 最终日期正确 | 中位耗时 | 输出 token |
|---|---|---|---|---|
| 让模型算日期 | 100% | 90% | 1970ms | 142 |
| **符号化 + 代码算日期** | 100% | 90% | **689ms** | **42** |

准确率在这批用例上打平,但:

1. **快 2.9 倍、省 3.4 倍 token**(模型只吐一个枚举值,不吐 6 个日期)
2. **失败模式完全不同**。符号化的错是**分类错**(把"8月和7月"归成了 `explicit` 跨月区间),这种错**能显示给用户看**:「解析为:2026年8月,环比 7月 [改]」。让模型算日期的错是**算术错**,静悄悄地就把去年同期算成了 2025-07 —— 用户看不出来。
3. **闰年/月末/季度边界这些坑一次性关掉**。`resolvePeriod` + `shiftRange` 已经写了并跑过 15 条单测(含 2024-02 闰年、闰日同比、非整月环比),**全过**。这部分永远不会再错,而且改 prompt 不会碰坏它。
4. **prompt 只需要教分类,不需要教算术边界** —— 打地鼠的范围小了一个数量级。

> **建议把这条写进正文第 5 节:凡是 LLM 输出里含"算出来的数",都要考虑能不能退化成"选出来的枚举 + 代码算"。** 同样的思路适用于 TopN 的 N、粒度推导、甚至图表尺寸。

## A.3 LM Studio 的三个坑(会影响实现)

1. **`json_object` 不支持。** 报 `'response_format.type' must be 'json_schema' or 'text'`。
   → 正文第 11.2 节的三级降级改成**两级**:`json_schema` → 纯 prompt。`json_object` 只对云端 OpenAI 有意义。

2. **开思考 + `json_schema` 时,受约束的 JSON 会整个跑进 `reasoning_content`,`content` 是空的。**
   实测:`{"grain": "day"}` 出现在 `reasoning_content` 里,`content: ""`,`finish_reason: "stop"`。
   → 结构化调用一律用 `reasoning_effort: "none"`;同时加兜底:`content` 为空时去 `reasoning_content` 里捞。

3. **`chat_template_kwargs.enable_thinking: false` 完全不生效。** 真正管用的是 **`reasoning_effort: "none"`**。见 A.4。

## A.4 顺带修掉的现网 bug

DB Studio 当前发的请求里带的是 `chat_template_kwargs: { enable_thinking: false }`(`aiClient.ts:buildChatRequest`),而这个参数在 LM Studio + Qwen3.6 上**根本不起作用**。同时 `streamChat` 只读 `delta.content`,把 `delta.reasoning_content` 整个丢掉。

复刻现网请求实测一个一句话问题:

| | 首个正文字符延迟 | 思考字符 | 正文字符 |
|---|---|---|---|
| 修复前 | **21,100ms** | 2,366(全被丢弃) | 35 |
| 修复后 | **556ms** | 0 | 65 |

**也就是说:在用户自己的默认配置下,问一个一句话的问题,AI 面板会先卡住 21 秒一动不动。** 这不是"模型慢",是参数没生效 + 思考流被丢弃。

已修(`0.45.24`):
- `provider === "local"` 且关思考时,**同时**发 `chat_template_kwargs` 和 `reasoning_effort: "none"`(老端点认前者,LM Studio 认后者;不发给云端 provider,避免被拒)
- `StreamCallbacks` 增加 `onThinking?`,把 `reasoning_content` 透出去 —— 用户**主动开思考**时至少能看见"在想",而不是对着一个死掉的界面

## A.5 模型 id 对不上

`aiStore.ts` 的默认配置写的是 `local.model = "qwen3-30b-a3b"`,而 LM Studio 实际服务的是 `qwen/qwen3.6-35b-a3b`。LM Studio 目前会宽容处理(用已加载的那个),但这属于"碰巧能用"。
→ 建议:Agent 启动时调一次 `listModels()`(已有),对不上就用实际加载的那个,并在设置里提示。

## A.6 修订后的下一步

可行性已经验证,按正文的 Phase 0 开始 —— **抽 `dashboardService`**。同时把 A.2 的结论落进 `ScopeResolver` 的契约设计:节点输出符号化 period,日期由已经写好并测过的 `resolvePeriod` / `shiftRange` 算。

探针脚本(`probe.mjs` / `probe2.mjs`)是一次性的可行性验证,不进仓库;结论以本附录为准。Phase 1 建 `agent/model/structured.ts` 时,这批用例应该转成正式回归测试。

---

# 附录 B · Phase 1 地基与第二个实验(2026-09-11)

## B.1 落地了什么

| 模块 | 作用 |
|---|---|
| `agent/jsonSchema.ts` | JSON Schema 子集校验。**错误信息是写给 LLM 看的**:带路径、期望、实得,模型能照着自己改 |
| `agent/model/structured.ts` | 结构化输出客户端。附录 A 那三个 LM Studio 的坑全落在这里:两级降级(json_schema→纯 prompt,跳过不支持的 json_object)、`reasoning_effort:"none"`、`content` 为空时去 `reasoning_content` 捞 |
| `agent/tools/registry.ts` | Tool 注册表 + 统一契约。入参校验集中在这里,保证每个工具的错误格式一致 |
| `agent/tools/metricTools.ts` | 4 个指标工具。`validateMetrics` 是纯函数、零 LLM |
| `agent/audit.ts` | 审计流水:谁、哪个节点、调了什么、成没成、多久、多少 token |

## B.2 第二个实验:节点该不该规划工具调用序列?

拿真实的 153 个指标 + 5 条真实请求,同一个模型,两种节点形状各跑 20 次:

| 节点形状 | 过 schema | **工具链真能跑通** | 中位耗时 | 输出 token |
|---|---|---|---|---|
| A. LLM 规划工具调用序列(通用 tool-calling) | 20/20 | **12/20** | 1749ms | 115 |
| B. LLM 只输出本步意图,**代码去调工具** | 20/20 | **20/20** | **742ms** | **37** |

**两种形状的 schema 合规率都是 100%,零重试** —— 结构化输出这层完全没问题,即使 schema 比附录 A 的 ScopeResolver 复杂得多(嵌套数组 + 按工具切换参数)。

差别全在能不能真跑通。A 的 8 次失败是同一个模式:模型在**一批** calls 里先 `search_metrics` 再 `get_metric_definition`,而后者的 `metricId` 依赖前者的返回 —— 要么没填(`INVALID_ARGS`),要么是编的(`NOT_FOUND`)。

**这不是模型的错,是形状的错。** 一次性批量规划天然表达不了调用间的依赖。

## B.3 结论:Agent 节点不做通用 tool-calling loop

这是和附录 A.2「不要让 LLM 算日期」同一个道理的第二个实例:

> **给 LLM 最小的那份工作(分类 / 抽取),组合交给代码。**

具体到本项目:

- 每个节点有**固定的工具使用模式**,写死在节点代码里。`MetricPlanner` 就是「LLM 输出 metricTerms + dimensions → 代码调 validate_metrics → 代码按验过的 id 调 get_metric_definition」。
- 多步靠**图的边**来走,不靠一次输出里塞多个调用。
- 因此**不需要**通用的 tool-calling 循环,也就不依赖模型的 function-calling 能力 —— 只依赖它的结构化输出能力,而那个实测 100%。

正文第 5 节的节点图不用改,但要补一条约束:**节点的 schema 里不许出现 `tool` 字段**。工具是节点的实现细节,不是模型的选择项。

顺带,B 形状下的行为全对:
- 「我想知道毛利率」→ 验过 0、缺 1,**不拿近似的顶上**
- 「分析上个月营业数据」→ 模型多要了几个指标,验过 3、缺 2,缺的如实报
- 「8月华东大区各网点」→ 验过 2、维度全支持

## B.4 指标匹配的三种结局

`validateMetrics` 拿真实 153 个指标扫了一遍,三种结局都要分得清:

```
销售额    ✅ 销售额                 精确命中
线上销售额 ✅ 线上销售额
日店均    ✅ 日店均
毛利率    ❌ 缺(无近似)            不存在就报缺,不编
利润      ❌ 缺(无近似)
退款率    ❌ 缺(无近似)
会员数    ❓ 问人:预存/领券/消费/新增会员数
评分      ❓ 问人:稽核分数/团购平台平均分/点评平台评分/团购平台评分
```

中间那条 ❓ 是过程中修出来的一个真缺陷:原来的门槛是「相似度 < 0.6 就报缺」,于是「会员数」被判成**不存在** —— 可指标中心里明明有四个并列的兄弟指标,用户心里有一个,只是没说全。**低分并列是「你指哪个」,不是「没有」**,现在只要有两个以上候选咬得很近(不论分高分低)就升级成澄清。

打分也修了一处:包含匹配的分数原来按**指标名长度**算,导致「各渠道」(它别名里有「总销售额」)对 q=销售额 能拿到 0.6,和真正的「销售额」只差 0.4,离误触发歧义只剩一步。改成按**命中串**长度算,并给别名命中打折,现在掉到 0.3 上下。

## B.5 下一步

Phase 1 还差的:数据工具(`build_query_plan` / `execute_query_plan` / `validate_dataset`)和看板工具(包 dashboardService)。然后进 Phase 2,把 8 个只读节点串成图。

---

# 附录 C · 真机上撞出来的坑(Phase 0–4 全部落地后)

> 设计报告和两个实验附录讲的是「应该怎么做」。这一节记的是**做出来之后,在真实
> 数据和真实提问上撞到的问题** —— 十来个,几乎每一个都比架构图值钱,因为下次改这块
> 的人(包括我自己)最容易在同样的地方栽。
>
> 排序按危险程度,不按发现顺序。

## C.0 最危险的一类:看起来成功了

这一路最反复出现的不是崩溃,是**看着对、实际错**。崩溃至少会喊一声;这类不会。

| 撞到的 | 表面现象 | 实际 |
|---|---|---|
| 图收成 END 时 status 变 done | 八个步骤全绿勾 | 体检判了 fail、分析根本没跑,报告区空白 |
| 结果被截断在 2 万行 | 「取数 20,000 行」正常显示 | 合计少了 60%,每一行都对,加起来才露馅 |
| 比率指标被当成可加 | 笔均金额有数、有小数、像模像样 | 31 天的笔均金额加了 31 遍,815 vs 真值 26 |
| 时段筛选塞进 day 维度 | 查询照跑,表也画出来了 | 「21点之后」这个条件根本没生效,而没人说 |
| 「打开看板」 | 打开了一个看板 | 是你之前开着的**另一块**板子 |

**共同点**:每一处都是"某个环节悄悄退化了,而下游看不出来"。所以这套系统里
真正起作用的不是哪个聪明的节点,是那些**专门用来发现退化**的检查。

对应的纪律:
- 任何"放弃了某件事"的路径都必须**显式置成失败**,不能靠默认值收场。
- UI 上「跑没跑过」只能认执行轨迹(state.trace),不能靠 status 推。
- 数据只要被截断,后面所有聚合一律不可信 —— 硬拦,不给选项。

## C.1 是我的自动修正把事情弄糟了

两次,而且都很典型:

**假警告**:「数据点多于 30 个,开数据标签会糊成一团」—— 可数据标签**默认根本不开**。
一次刷 4 条,全是噪音。删掉规则,改成建组件时按点数决定开不开(≤12 才开)。
**警告一件不存在的事,比不警告更糟** —— 它会训练人忽略所有警告。

**改坏了能看的数**:`NO_SCALE` 规则对所有 KPI 一律建议「万」,于是笔均金额 32.60 元
显示成「0万」、日店均 4180 元变成「0.4万」。改成从真实数据算量级再决定,
而且**两个方向都判**:该换的没换要提,不该换的换了要撤。

教训:**自动修正必须看真实数据,不能只看结构。** 只看"这是个 KPI 没配 scale"
就下手,一定会有改坏的那天。

## C.2 「别替模型做决定」和「别让模型做算术」的边界

这两句话会互相打架,边界在哪撞了两次才想清楚。

**第一次**:时间维度塌缩。按 month 查 8 月只回 1 行,什么都分析不出来。
我的第一版修法是「比建议粒度粗就一律降」—— 结果把「今年前两个月用 month」
(2 个桶,完全合理)也强行降成了 day。**粒度是分析决策,不是公式。**
改成只在**切不出多于一个桶**时才介入,而且:唯一维度就换粒度,还有别的业务维度
就直接去掉那个塌缩的时间维度(细化它会把行数乘 31 倍)。

**第二次**:「对比8月和7月」vs「列出5月6月7月8月」。加了跨月区间的规则,前者被
当成区间;不加,后者只取一个月。两条规则在 prompt 里怎么写都顾此失彼 ——
最后用代码定死那个窄情形:**恰好 2 个连续整月 + 要了对比 → 晚的为主 + 早的做环比**,
超过 2 个月不动。

**边界是这样**:
- 能用一句确定性规则说清、且判错了下游看不出来的 → 代码定死
- 需要理解意图、判错了当场就能看见的 → 留给模型

## C.3 模型陷入重复循环,根因在我的 schema

范围解析崩了,报「输出不是合法 JSON(收到 2315 个字符)」。查了才发现:模型把
同一条筛选**吐了十几遍**,直到撞上 max_tokens 被硬截断,JSON 断在半截。

根因不是 prompt,是 **`filters` 数组没设 `maxItems`**。json_schema 模式下上限
是靠语法约束住解码的,不设就管不住。`S.arr` 现在默认带上限。

顺带:撞 max_tokens 时要**报"输出被截断,通常是数组没设上限"**,别报成"不是合法
JSON" —— 后者会让人去查 prompt,方向全错。

## C.4 别让模型凭记忆想你有什么指标

本地 35B 把 `candidateMetricTerms` 填成了「经营情况」—— 用户原话里的话题词,
不是指标,核对那步直接失败。云端模型能自己拆成销售额/订单量/笔均金额。

但**清单就在本机,给它看一眼就行**。加上清单后本地模型立刻从 0/1 变成 10/12。

第一版清单我又写砸了:按分类取前 14 个、还**按名字长度排序**。结果 12 个会员指标
(都在「经营指标」这一类、名字偏长)被整体砍掉,问「会员情况」只能去选微信/支付宝
存量店 —— 那是支付渠道。**用名字长度当重要性代理是错的。**

改成按「根指标 vs 渠道变体」分:名字以另一个指标名结尾的就是变体,153 个里 121 个
是变体。只列根指标 + 一句变体命名规律,清单从 ~1800 字压到 267 字,**覆盖反而全了**。

## C.5 做不到的必须说出来

拿一句真实的难题试出来的:

> 华东和华北所有网点 按网点视角 列出 5/6/7/8月 晚上21点之后的线下和线上销售额,
> 21~22 22~23 23~24 24以后 5档

第一次跑,三个筛选条件全错:「华东、华北」当成网点名、「线下、线上」重复筛、
「21:00-22:00」塞进 day 维度。而查询照跑、结果为空,**没有任何人告诉用户
"21点之后"这个要求根本没做到**。

现在四道防线:
1. RequirementAnalyzer 主动声明 `unsupported`(实测能准确说出时段表达不了)
2. 代码检查筛选值形状(日期维度的值必须像日期)
3. **筛选值拿真实取值核一遍**(「华东」→ 查库 → 补成「华东大区」;对不上就丢掉并提示"确认一下是不是记错了维度")
4. 这些"没做到的"顶在面板最前面,不是埋在结论后头

## C.6 一份没人在意但很值钱的收获

追笔均金额那个 bug 时发现:**看板本身就有同一个 bug**。明细表开行合计、图表把多行
并到一个 x —— 走的都是同一个 `metricRollup`,一样会把笔均金额加成 31 倍。

Agent 的数据体检**顺手体检了 BI 自己**。这不是设计时预期的,但回头看很合理:
把"数对不对"做成一个独立的、零 LLM 的检查层,它就不只服务于 AI 那条路。

## C.7 下一步:对强模型可以放开哪些,不能放开哪些

云端模型的能力明显够,所以该把"因为模型不够聪明"设的限制拆掉。但要分清两类:

**可以放开的(限制来自模型能力)**
- 指标清单的详细程度 —— 强模型可以给全量、带单位和口径,让它自己判断怎么搭配
- 维度组合 —— 现在维度候选是一个全局枚举,可以改成把每个指标各自支持的维度给它,
  让它自己判断哪些能一起用
- 分析查询固定砍到 2 个维度 —— 可以改成按**预估行数**决定,而不是数个数

**不能放开的(限制来自"错了没人发现")**
- metricId 必须来自 validate_metrics —— 再聪明的模型也不知道你的口径怎么定
- 日期算术 —— 聪明模型照样会静默算错去年同期
- 数据体检 —— 截断、不可加、总分对不上是事实,不是意见
- 评审的修改白名单 —— 能改标题,不能改指标绑定

一句话:**凡是"判错了下游看不出来"的,不管模型多强都不放开;凡是"判错了当场就能
看见"的,尽量交给模型。**
