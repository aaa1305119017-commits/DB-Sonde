import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "sonde-integration-"));
try {
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, [
    `export * from ${JSON.stringify(resolve("src/features/dashboard/semantic.ts"))};`,
    `export * from ${JSON.stringify(resolve("src/features/dashboard/domain.ts"))};`,
    `export { buildChatRequest } from ${JSON.stringify(resolve("src/features/ai/aiClient.ts"))};`,
    `export * from ${JSON.stringify(resolve("src/lib/sql.ts"))};`,
    `export * from ${JSON.stringify(resolve("src/features/etl/fileCatalog.ts"))};`,
    `export { dataxAdapter } from ${JSON.stringify(resolve("src/features/etl/adapters/datax.ts"))};`,
    `export { outputColumns, sqlVocab } from ${JSON.stringify(resolve("src/features/lineage/sqlColumns.ts"))};`,
    `export { buildEntityPrompt } from ${JSON.stringify(resolve("src/features/entity/entityPrompt.ts"))};`,
    `export * as dash from ${JSON.stringify(resolve("src/features/dashboard/dashboardService.ts"))};`,
    `export { matchDimensionValue } from ${JSON.stringify(resolve("src/features/dashboard/dataService.ts"))};`,
    `export { scaledText } from ${JSON.stringify(resolve("src/features/dashboard/widgets/metricUtils.ts"))};`,
    `export { validate, S } from ${JSON.stringify(resolve("src/features/agent/jsonSchema.ts"))};`,
    `export { extractJson } from ${JSON.stringify(resolve("src/features/agent/model/structured.ts"))};`,
    `export { callTool } from ${JSON.stringify(resolve("src/features/agent/tools/registry.ts"))};`,
    `export { useMetrics as metricsStore } from ${JSON.stringify(resolve("src/features/metrics/metricsStore.ts"))};`,
    `export { checkDataset, checkTotals, verdict, expectedPoints } from ${JSON.stringify(resolve("src/features/agent/validation/dataChecks.ts"))};`,
    `export { resolvePeriod, shiftRange, describeRange, suggestGrain, PERIOD_KINDS } from ${JSON.stringify(resolve("src/features/agent/period.ts"))};`,
    `export { Graph, END } from ${JSON.stringify(resolve("src/features/agent/graph.ts"))};`,
    `export { createState } from ${JSON.stringify(resolve("src/features/agent/state.ts"))};`,
    `export { explainFailure } from ${JSON.stringify(resolve("src/features/agent/workflow.ts"))};`,
    `export { splitComparisonSpan } from ${JSON.stringify(resolve("src/features/agent/period.ts"))};`,
    `export { packLayout, layoutHeight, repairLayout, resolveLayout } from ${JSON.stringify(resolve("src/features/agent/layout.ts"))};`,
    `export { reviewLayout, reviewVerdict, applyFixes, applyJudgement } from ${JSON.stringify(resolve("src/features/agent/review.ts"))};`,
    `export { metricValidator } from ${JSON.stringify(resolve("src/features/agent/nodes/index.ts"))};`,
    `export { providerFor, routingSummary } from ${JSON.stringify(resolve("src/features/agent/model/structured.ts"))};`,
    `export { isAdditiveExpression, metricRollup } from ${JSON.stringify(resolve("src/features/dashboard/semantic.ts"))};`,
    `export { useLineage as lineageStore, tableId } from ${JSON.stringify(resolve("src/features/lineage/lineageStore.ts"))};`,
    `export { useOps as opsStore } from ${JSON.stringify(resolve("src/features/lineage/opsStore.ts"))};`,
    `export { useEtl as etlStore } from ${JSON.stringify(resolve("src/features/etl/etlStore.ts"))};`,
    `export { importSummary } from ${JSON.stringify(resolve("src/features/metrics/MetricsCenter.tsx"))};`,
    `export { planSourceTables } from ${JSON.stringify(resolve("src/features/metrics/queryPlan.ts"))};`,
    `export { checkMetrics, referencedColumns } from ${JSON.stringify(resolve("src/features/metrics/metricHealth.ts"))};`,
    `export { dataExecutor } from ${JSON.stringify(resolve("src/features/agent/nodes/index.ts"))};`,
    `export { dashboardExecutor } from ${JSON.stringify(resolve("src/features/agent/nodes/index.ts"))};`,
    `export { getDraft } from ${JSON.stringify(resolve("src/features/agent/tools/dashboardTools.ts"))};`,
    `export { lockedPlanner } from ${JSON.stringify(resolve("src/features/agent/nodes/index.ts"))};`,
    `export { useAnalysis } from ${JSON.stringify(resolve("src/features/agent/analysisStore.ts"))};`,
    `export { buildLockedGraph } from ${JSON.stringify(resolve("src/features/agent/workflow.ts"))};`,
    `export { parseDashboardFile } from ${JSON.stringify(resolve("src/features/dashboard/transfer.ts"))};`,
    `export { tableAliases, selectExpressionFor, fromClause, fastDimensionValues } from ${JSON.stringify(resolve("src/features/agent/tools/dimensionProbe.ts"))};`,
    `export { executeDataset, clearQueryCache } from ${JSON.stringify(resolve("src/features/dashboard/query.ts"))};`,
    `export { api } from ${JSON.stringify(resolve("src/lib/api.ts"))};`,
    `export { mergeCanvasRuntime, nextDrillPath } from ${JSON.stringify(resolve("src/features/dashboard/useDashboardRuntime.ts"))};`,
    `export { registerTool, resetTools } from ${JSON.stringify(resolve("src/features/agent/tools/registry.ts"))};`,
  ].join("\n"));
  const output = join(dir, "test.cjs");
  buildSync({ entryPoints: [entry], outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  // 被测模块里有引入 zustand store 的(它们在模块加载时就读 localStorage)。
  // node 上没有,给个内存版,免得 import 阶段就炸。
  if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== "function") {
    const mem = new Map();
    globalThis.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      clear: () => mem.clear(),
    };
  }
  const { semanticDataset, compileSemanticDataset, resolveSemanticDocument, normalizeDashboard, placeWidgetNear, buildChatRequest, buildDataQuery, resolveReference, enrichTasks, dataxAdapter, outputColumns, sqlVocab, buildEntityPrompt, dash, matchDimensionValue, scaledText, validate, S, extractJson, callTool, metricsStore, checkDataset, checkTotals, verdict, expectedPoints, shiftRange, describeRange, Graph, END, createState, stepState, stepDetail, explainFailure, isAdditiveExpression, metricRollup, providerFor, routingSummary, packLayout, layoutHeight, repairLayout, resolveLayout, reviewLayout, reviewVerdict, applyFixes, applyJudgement, lineageStore, opsStore, etlStore, tableId, importSummary, planSourceTables, checkMetrics, referencedColumns , registerTool, resetTools , parseDashboardFile, mergeCanvasRuntime, nextDrillPath , dataExecutor , tableAliases, selectExpressionFor, fromClause, fastDimensionValues , executeDataset , clearQueryCache , dashboardExecutor , getDraft , lockedPlanner, buildLockedGraph , useAnalysis } = createRequire(import.meta.url)(output);
  const plan = {
    kind: "sql", dimensions: { region: { label: "区域", expression: "region" } }, sourceTables: ["orders"],
    template: "SELECT {{select}}SUM(amount) AS value FROM orders WHERE day BETWEEN {{start}} AND {{end}}{{filters}}{{groupBy}}",
  };
  const metric = { id: "sales", key: "sales", name: "销售额", type: "template", queryPlan: plan, enabled: true, connId: "c", database: "retail", dimensions: ["region"], unit: "元" };
  const widget = { id: "w", datasetId: "semantic:w", type: "kpi", bindings: { metricIds: ["sales"], secondaryMetricIds: [], measures: ["sales"] }, options: { metrics: {} } };
  const scope = { start: "2026-01-01", end: "2026-01-31" };
  const ds = semanticDataset(widget, [metric], scope);
  assert.deepEqual(ds.groupBy, []);
  assert(!compileSemanticDataset(ds, [metric]).sql.includes("GROUP BY"));
  const changed = { ...metric, queryPlan: { ...plan, template: plan.template.replace("SUM(amount)", "SUM(net_amount)") } };
  assert(compileSemanticDataset(ds, [changed]).sql.includes("SUM(net_amount)"));
  assert.throws(() => compileSemanticDataset(ds, []), /已删除/);
  assert.throws(() => compileSemanticDataset(ds, [{ ...metric, enabled: false }]), /已停用/);
  const bar = { ...widget, type: "bar", bindings: { ...widget.bindings, dimension: "region" } };
  const byRegion = semanticDataset(bar, [metric], scope);
  assert(compileSemanticDataset(byRegion, [metric]).sql.includes("GROUP BY region"));
  const filtered = compileSemanticDataset(byRegion, [metric], [{ field: "region", kind: "select", value: "O'Reilly" }]).sql;
  assert(filtered.includes("region='O''Reilly'"));
  assert.equal(resolveSemanticDocument({ widgets: [bar], datasets: [], metrics: [] }, [metric]).metrics[0].id, "sales");
  const normalizedTable = normalizeDashboard({ schemaVersion: 3, id: "d", widgets: [{ ...widget, type: "table", bindings: { ...widget.bindings, dimensions: ["day", "region", "store", "channel"], metricIds: Array.from({ length: 13 }, (_, i) => `m${i}`), secondaryMetricIds: ["secondary"] } }] });
  assert.deepEqual(normalizedTable.widgets[0].bindings.dimensions, ["day", "region", "store", "channel"]);
  assert.equal(normalizedTable.widgets[0].bindings.metricIds.length, 12);
  assert.deepEqual(normalizedTable.widgets[0].bindings.secondaryMetricIds, []);
  const normalizedLine = normalizeDashboard({ schemaVersion: 3, id: "l", widgets: [{ ...bar, type: "line", bindings: { ...bar.bindings, dimensions: ["day", "region"], seriesDimension: "store" } }] });
  assert.deepEqual(normalizedLine.widgets[0].bindings.dimensions, ["day"]);
  assert.equal(normalizedLine.widgets[0].bindings.seriesDimension, "store");
  /* 组件筛选字段就是数据集里的维度名,名字由建数据集的人定,不再有白名单 ——
     以前写死成大区/主管/网点那几个,别的数据集建出来的组件一存就被清空。
     只挡掉不是字符串和空串的脏数据。 */
  const normalizedComponentFilter = normalizeDashboard({ schemaVersion: 3, id: "f", widgets: [{ ...bar, filtersEnabled: true, filterFields: ["date", "region", "war_zone", "store", 7, "", null] }] });
  assert.equal(normalizedComponentFilter.widgets[0].filtersEnabled, true);
  assert.deepEqual(normalizedComponentFilter.widgets[0].filterFields, ["date", "region", "war_zone", "store"]);
  const intersected = compileSemanticDataset(byRegion, [metric], [
    { field: "region", kind: "in", value: `华东${String.fromCharCode(1)}华北` },
    { field: "region", kind: "in", value: "华东" },
  ]).sql;
  assert.equal((intersected.match(/region IN/g) ?? []).length, 2);
  const multiPlan = { ...plan, dimensions: Object.fromEntries(["day", "region", "store", "channel"].map((name) => [name, { label: name, expression: name }])) };
  const multiMetric = { ...metric, dimensions: ["day", "region", "store", "channel"], queryPlan: multiPlan };
  const semanticTable = semanticDataset({ ...normalizedTable.widgets[0], bindings: { ...normalizedTable.widgets[0].bindings, metricIds: ["sales"], measures: ["sales"] } }, [multiMetric], scope);
  assert.deepEqual(semanticTable.groupBy, ["day", "region", "store", "channel"]);
  assert(compileSemanticDataset(semanticTable, [multiMetric]).sql.includes("GROUP BY day, region, store, channel"));
  const origin = { ...normalizedTable.widgets[0], id: "origin", x: 0, y: 0, w: 2, h: 2 };
  const rightCopy = placeWidgetNear({ ...origin, id: "copy-1" }, [origin], origin);
  assert.deepEqual([rightCopy.x, rightCopy.y], [2, 0]);
  const nextCopy = placeWidgetNear({ ...rightCopy, id: "copy-2" }, [origin, rightCopy], rightCopy);
  assert.deepEqual([nextCopy.x, nextCopy.y], [4, 0]);
  const belowCopy = placeWidgetNear({ ...origin, id: "copy-3" }, [origin, { ...origin, id: "right-blocker", x: 2 }], origin);
  assert.deepEqual([belowCopy.x, belowCopy.y], [0, 2]);
  const multiSortSql = buildDataQuery("mysql", "shop_ads", undefined, "ads_outlet_daily", {
    orderBy: [{ column: "stat_date", dir: "desc" }, { column: "store_id", dir: "asc" }],
    limit: 200,
    offset: 0,
  });
  assert(multiSortSql.includes("ORDER BY `stat_date` DESC, `store_id` ASC"));
  const aiBase = {
    builtin: { model: "builtin", baseUrl: "", ready: false },
    local: { model: "qwen3.5-35b-a3b", baseUrl: "http://127.0.0.1:1234/v1" },
    cloud: { model: "cloud", baseUrl: "", apiKey: "" },
    includeSampleRows: false,
  };
  const directAi = buildChatRequest({ ...aiBase, provider: "local", thinkingEnabled: false }, aiBase.local.model, []);
  const thinkingAi = buildChatRequest({ ...aiBase, provider: "local", thinkingEnabled: true }, aiBase.local.model, []);
  const cloudAi = buildChatRequest({ ...aiBase, provider: "cloud", thinkingEnabled: true }, aiBase.cloud.model, []);
  assert.equal(directAi.chat_template_kwargs.enable_thinking, false);
  assert.equal(thinkingAi.chat_template_kwargs.enable_thinking, true);
  assert.equal("chat_template_kwargs" in cloudAi, false);
  assert.equal(resolveReference("/worker/jobs/a.json", ["/local/jobs/a.json"], [{ from: "/worker", to: "/local" }]), "/local/jobs/a.json");
  assert.equal(resolveReference("a.json", ["/one/a.json", "/two/a.json"]), undefined);
  const file = { id: "f", references: ["/local/jobs/a.json"], flows: [{ sources: [{ kind: "db", table: "raw" }], targets: [{ kind: "db", table: "fact" }] }] };
  const task = { id: "t", references: ["/worker/jobs/a.json"], sources: [], targets: [] };
  assert.equal(enrichTasks([task], [file], [{ from: "/worker", to: "/local" }])[0].targets[0].table, "fact");
  const parsed = dataxAdapter.parse(JSON.stringify({ job: { content: [{ reader: { name: "mysqlreader", parameter: { connection: [{ jdbcUrl: ["jdbc:mysql://host/db"], querySql: ["select * from a", "select * from b"] }] } }, writer: { name: "mysqlwriter", parameter: { connection: [{ jdbcUrl: "jdbc:mysql://host/db", table: ["target"] }] } } }] } }));
  assert.equal(parsed[0].sources.length, 2);
  const scanner = spawnSync("python3", ["-c", `
import importlib.util, pathlib, tempfile
spec = importlib.util.spec_from_file_location("inspect_etl", "src-tauri/resources/inspect_etl.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as folder:
    root = pathlib.Path(folder)
    (root / "job.py").write_text('sql = "INSERT INTO mart.target SELECT * FROM raw.source"\\ndynamic = f"SELECT * FROM {table}"\\n')
    (root / "snapshot.before.sql").write_text("INSERT INTO backup VALUES (1)")
    (root / ".private.sql").write_text("SELECT * FROM secrets")
    result = module.inspect(root)
    assert len(result["files"]) == 1, result
    assert result["files"][0]["sql"] == ["INSERT INTO mart.target SELECT * FROM raw.source"], result
    assert len(result["warnings"]) == 1, result
`], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(scanner.status, 0, scanner.stderr);
  // 列级相关性:灌宽表的每条入口都在 SELECT 里写明它产出哪几列。
  // 指标只读其中几列,靠这个把不相干的入口(供应链 / 会员 / 巡检)剪掉。
  const wmSql = "SELECT stat_date, store_id, SUM(order_cnt - refund_cnt) AS wm_order_cnt, ROUND(SUM(paid_amount), 2) AS online_gmv_amt FROM shop_dws.dws_online_channel_day GROUP BY stat_date, store_id";
  const wmCols = outputColumns(wmSql);
  assert(wmCols.has("online_gmv_amt") && wmCols.has("wm_order_cnt"), "别名列要认出来");
  assert(wmCols.has("stat_date") && wmCols.has("store_id"), "裸列也要认出来");
  assert(!wmCols.has("paid_amount"), "函数里的参数不是产出列");
  const vocab = sqlVocab("SELECT SUM(a.offline_gmv_amt + a.online_gmv_amt) FROM shop_ads.ads_outlet_daily a");
  assert(vocab.has("online_gmv_amt") && vocab.has("offline_gmv_amt"), "口径里读到的列要进词表");
  assert(!vocab.has("sum") && !vocab.has("select"), "SQL 关键字不算列");
  assert([...wmCols].some((c) => vocab.has(c)), "线上入口应命中销售额口径");
  const scCols = outputColumns("SELECT stat_date, store_id, SUM(delivery_amount) AS shipment_amt FROM shop_dws.dws_inventory_trade_day GROUP BY stat_date, store_id");
  assert(!vocab.has("shipment_amt"), "供应链入口不该命中销售额口径");
  assert(scCols.has("shipment_amt"));

  // 360 全景「问 AI」的提示词:同名作业要能区分,指标不能变成 [object Object]。
  const facts = {
    id: "shop_ads.ads_outlet_daily",
    up: ["shop_dws.dws_online_channel_day"],
    downTables: [],
    metrics: [
      { id: "v1:total_gmv", name: "销售额", fields: ["offline_gmv_amt", "online_gmv_amt", "stat_date"] },
      { id: "v1:online_gmv", name: "线上销售额", fields: ["online_gmv_amt", "stat_date"] },
      /* 再凑几个指标:共用键是按**占比**认的(几乎每个指标都读),不再按字段名硬剔。
         指标太少时没有占比可言,那时候 stat_date 就该当成普通列照常列出来 ——
         它确实只有那么几个指标读。 */
      ...Array.from({ length: 8 }, (_, i) => (
        { id: `v1:m${i}`, name: `指标${i}`, fields: ["stat_date", `col_${i}_amt`] })),
      { id: "v1:x", name: "解析不出的指标", fields: [] },
    ],
    producedBy: [
      { src: "datax_jobs", job: { id: "a", name: "ads_outlet_daily" }, from: ["shop_dws.dws_online_channel_day"], cols: ["online_gmv_amt"] },
      { src: "datax_jobs", job: { id: "b", name: "ads_outlet_daily" }, from: ["shop_dws.dws_inventory_trade_day"], cols: ["shipment_amt"] },
    ],
  };
  const prompt = buildEntityPrompt(facts, "应用库");
  assert(!prompt.includes("[object Object]"), "指标必须是名字,不能是对象");
  assert(prompt.includes("销售额") && prompt.includes("线上销售额"));
  // 两条同名作业靠「从哪读 / 灌哪几列」区分开
  assert(prompt.includes("ads_outlet_daily ← shop_dws.dws_online_channel_day,灌 online_gmv_amt"));
  assert(prompt.includes("ads_outlet_daily ← shop_dws.dws_inventory_trade_day,灌 shipment_amt"));
  assert(prompt.includes("online_gmv_amt — 2 个指标"), "指标按字段聚合");
  /* 几乎每个指标都读的键(这儿 10/10)拎到「共用键」那一行,不占用下面的清单 ——
     否则它永远排第一,把真正有区分度的列挤到 25 行开外看不见。
     注意它不是被扔掉:改这种字段波及面最大,得让模型知道。 */
  assert(!prompt.split("\n").some((l) => l.startsWith("- stat_date —")), "共用键不占清单里的位置");
  assert(prompt.split("\n").some((l) => l.includes("共用键") && l.includes("stat_date")), "共用键要单独说,不能悄悄扔掉");
  assert(prompt.includes("另有 1 个指标没解析出具体字段"));

  // 看板改写层 —— 原来闭在 DashboardWorkspace 的 useState 里,搬成纯函数后才测得了。
  const gmv = { id: "m1", key: "gmv", name: "销售额", type: "measure", enabled: true, connId: "c",
                database: "d", source: "t", expression: "SUM(amt)", dimensions: ["day", "store"], unit: "元", caliber: "" };
  const d0 = dash.create({ title: "测试看板" });
  assert.equal(d0.widgets.length, 0);
  assert.equal(d0.status, "draft");

  // 新建组件:数据源留空,由人在检查器里选 —— 数据集是全局的,猜一个塞进去会让图上
  // 出现一份对不上的数,而且没人会想到去改它。
  const k = dash.addWidget(d0, { type: "kpi", title: "KPI" });
  const kpi = k.doc.widgets.find((w) => w.id === k.id);
  assert.equal(kpi.datasetId, "", "新组件不预设数据集");
  assert.deepEqual(kpi.bindings.measures, [], "也不预设度量");
  assert.equal(kpi.bindings.dimension, undefined, "KPI 不该带分析维度");
  // 指名数据集时就用它
  const bound = dash.addWidget(d0, { type: "bar", title: "柱图", datasetId: "dataset-x" });
  assert.equal(bound.doc.widgets.find((w) => w.id === bound.id).datasetId, "dataset-x");
  const b = dash.addWidget(k.doc, { type: "bar", title: "柱图" });

  // 放置避让:两个组件不能重叠
  const [wa, wb] = b.doc.widgets;
  assert(!(wa.x < wb.x + wb.w && wb.x < wa.x + wa.w && wa.y < wb.y + wb.h && wb.y < wa.y + wa.h), "新组件必须放到空位");

  // 容器:子组件宽度收窄、不许嵌套容器
  const c = dash.addWidget(b.doc, { type: "container", title: "Tab 容器" });
  const tabId = c.doc.widgets.find((w) => w.id === c.id).tabs[0].id;
  const child = dash.addWidget(c.doc, { type: "line", title: "折线", metric: gmv, parentId: c.id, tabId });
  const childWidget = child.doc.widgets.find((w) => w.id === child.id);
  assert.equal(childWidget.parentId, c.id);
  assert(childWidget.w <= 6, "容器里的子组件最宽 6 栏");
  assert.throws(() => dash.addWidget(c.doc, { type: "container", parentId: c.id, tabId }), /容器里不能再放容器/);

  // 删容器连带删子组件
  const afterDelete = dash.deleteWidget(child.doc, c.id);
  assert(!afterDelete.widgets.some((w) => w.id === c.id || w.parentId === c.id), "删容器要连子组件一起删");

  // 复制容器:子组件跟着复制并改挂到副本上
  const dup = dash.duplicateWidget(child.doc, c.id, "副本");
  const copies = dup.doc.widgets.filter((w) => w.parentId === dup.id);
  assert.equal(copies.length, 1, "容器副本要带上子组件");
  assert.notEqual(copies[0].id, child.id, "子组件副本要换新 id");
  assert.equal(dup.doc.widgets.find((w) => w.id === dup.id).title, "副本");

  // patchWidget:options 深合一层,不整个覆盖
  const boundDoc = dash.patchWidget(b.doc, b.id, {
    bindings: { ...b.doc.widgets.find((w) => w.id === b.id).bindings, measures: ["amount"] },
  });
  const patched = dash.patchWidget(boundDoc, b.id, { title: "改名", options: { topN: 10 } });
  const pw = patched.widgets.find((w) => w.id === b.id);
  assert.equal(pw.title, "改名");
  assert.equal(pw.options.topN, 10);
  assert.equal(pw.options.decimals, 2, "没传的 options 字段要保留");
  assert.deepEqual(pw.bindings.measures, ["amount"], "没传 bindings 就不动");
  assert.throws(() => dash.patchWidget(b.doc, "不存在", {}), /组件不存在/);

  // toggle / move
  assert.equal(dash.toggleWidget(b.doc, b.id).widgets.find((w) => w.id === b.id).visible, false);
  assert.equal(dash.moveWidget(b.doc, b.id, { x: 2 }).widgets.find((w) => w.id === b.id).x, 2);

  // 筛选器:没有数据集要明确报错,而不是静默什么都不做
  assert.throws(() => dash.addFilter(b.doc), /还没有数据集/);
  const withDs = { ...b.doc, datasets: [{ id: "ds1", name: "d", sourceType: "sql", connectionId: "c", sql: "",
    fields: [{ name: "store", typeName: "", role: "dimension" }, { name: "gmv", typeName: "", role: "measure" }] }] };
  const f = dash.addFilter(withDs);
  const filter = f.doc.filters.find((x) => x.id === f.id);
  assert.equal(filter.field, "store", "默认取第一个维度字段");
  assert.equal(filter.scope, "global", "默认全局联动");
  assert.equal(dash.deleteFilter(f.doc, f.id).filters.length, 0);
  const noDim = { ...b.doc, datasets: [{ ...withDs.datasets[0], fields: [{ name: "gmv", typeName: "", role: "measure" }] }] };
  assert.throws(() => dash.addFilter(noDim), /没有可筛选的维度/);

  // 文档级
  assert.equal(dash.setMeta(d0, { title: "新标题", refreshInterval: 60 }).refreshInterval, 60);
  assert.equal(dash.setScope(d0, { start: "2026-08-01", end: "2026-08-31" }).metricScope.end, "2026-08-31");
  assert.throws(() => dash.addTab(b.doc, b.id, "Tab 2"), /不是容器组件/);
  assert.equal(dash.addTab(c.doc, c.id, "Tab 2").doc.widgets.find((w) => w.id === c.id).tabs.length, 2);

  // 纯函数:改写不能动传进去的文档
  assert.equal(d0.widgets.length, 0, "addWidget 不能改动传进去的文档");

  // 维度取值匹配:命中多个时原样返回候选,绝不替用户挑一个
  const zones = ["华东大区", "华东南区", "华北大区", "西北大区"];
  assert.deepEqual(matchDimensionValue(zones, "华东大区"), ["华东大区"], "精确优先");
  assert.deepEqual(matchDimensionValue(zones, "华东"), ["华东大区", "华东南区"], "前缀命中多个要都返回");
  assert.deepEqual(matchDimensionValue(zones, "北大区"), ["华北大区", "西北大区"], "前缀不命中就退到包含匹配");
  assert.deepEqual(matchDimensionValue(zones, "不存在"), []);
  assert.deepEqual(matchDimensionValue(zones, "  "), []);

  // 新增的组件字段必须活过一次存取归一化 —— refreshInterval 当初就是漏在这里,
  // 存进文件后每次加载都被抹掉,设置形同虚设。
  const rich = normalizeDashboard({
    schemaVersion: 3, id: "d1", title: "t", widgets: [{
      id: "w1", type: "bar", datasetId: "ds", title: "图",
      subtitle: "口径:含税", footnote: "数据截至昨日",
      bindings: { metricIds: ["m1"], measures: [], secondaryMetricIds: [], dimensions: ["day"] },
      options: {
        decimals: 2, showLegend: true, smooth: true, topN: 0, metrics: {},
        numberFormat: { scale: "wan", prefix: "¥", suffix: "万元" },
        chart: { axis: { yMin: 100, yMax: 900, yTitle: "元", xTitle: "日期", splitLine: true },
                 tooltip: { mode: "item" }, markLine: [{ value: 500, label: "目标" }] },
      },
    }],
  });
  const rw = rich.widgets[0];
  assert.equal(rw.subtitle, "口径:含税", "副标题要保留");
  assert.equal(rw.footnote, "数据截至昨日", "脚注要保留");
  assert.equal(rw.options.numberFormat.scale, "wan");
  assert.equal(rw.options.numberFormat.prefix, "¥");
  assert.equal(rw.options.chart.axis.yMin, 100);
  assert.equal(rw.options.chart.axis.splitLine, true);
  assert.equal(rw.options.chart.tooltip.mode, "item");
  assert.deepEqual(rw.options.chart.markLine, [{ value: 500, label: "目标" }]);
  assert.equal(rw.options.decimals, 2, "老字段不能被挤掉");

  // 数字显示格式:在线端(scaledText)和离线导出端(standalone.runtime 的 scaled)
  // 必须同语义,否则同一个看板在线看是「1,234.6 万元」,导出后变成「12,345,678 元」。
  // 离线端是另一份手写实现,这几条断言就是防它漂。
  assert.equal(scaledText(12345678, 1, "元", { scale: "wan" }), "1234.6万元");
  assert.equal(scaledText(12345678, 2, "元", { scale: "yi" }), "0.12亿元");
  assert.equal(scaledText(12345678, 0, "元"), "12345678元", "不配格式就原样");
  assert.equal(scaledText(1234, 1, "元", { scale: "wan", suffix: "万" }), "0.1万", "suffix 填了就整个接管");
  assert.equal(scaledText(1234, 0, "元", { scale: "none", prefix: "¥" }), "¥1234元");

  // ── 数据质量体检:整条链路上最重要的一层,零 LLM ──
  const col = (...names) => names.map((name) => ({ name }));
  const shape = {
    dimensions: ["day", "store"],
    metrics: [{ field: "gmv", name: "销售额", rollup: "sum", unit: "元" },
              { field: "rate", name: "出货率", rollup: "avg", unit: "%" }],
    timeField: "day", dateRange: { start: "2026-08-01", end: "2026-08-03" }, grain: "day",
  };
  const qr = (rows) => ({ columns: col("day", "store", "gmv", "rate"), rows, truncated: false });

  // 空结果不许拿去画图
  assert.equal(checkDataset(qr([]), shape)[0].code, "EMPTY");
  assert.equal(verdict(checkDataset(qr([]), shape)).status, "fail");

  // 维度组合重复 = GROUP BY 没盖住 / JOIN 放大,求和会重复计算
  const dupRows = checkDataset(qr([
    ["2026-08-01", "A", 100, 50], ["2026-08-01", "A", 200, 60],
    ["2026-08-02", "B", 300, 70], ["2026-08-03", "C", 400, 80],
  ]), shape);
  const dupIssue = dupRows.find((i) => i.code === "DUPLICATE_DIMENSIONS");
  assert(dupIssue && dupIssue.level === "fail", "同维度多行是硬错");
  assert.deepEqual(dupIssue.samples, ["2026-08-01 / A"], "要指出是哪个组合重了");

  // 日期缺口:3 天的区间只回来 1 天
  const gap = checkDataset(qr([["2026-08-01", "A", 100, 50]]), shape).find((i) => i.code === "TIME_GAPS");
  assert(gap && gap.level === "fail", "缺超过 20% 算硬错");
  assert(gap.message.includes("应有 3 个"), gap.message);

  // 整列空 / 空值过多
  const allNull = checkDataset(qr([["2026-08-01", "A", null, 1], ["2026-08-02", "B", null, 2], ["2026-08-03", "C", null, 3]]), shape);
  assert(allNull.some((i) => i.code === "ALL_NULL" && i.level === "fail"));

  // 负值只对金额/数量类报,比率不报
  const neg = checkDataset(qr([["2026-08-01", "A", -5, 50], ["2026-08-02", "B", 10, -1], ["2026-08-03", "C", 20, 30]]), shape);
  const negs = neg.filter((i) => i.code === "NEGATIVE");
  assert.equal(negs.length, 1, "单位是 % 的比率出现负值不该报,只报金额/数量:" + JSON.stringify(negs.map((n) => n.message)));

  // 极端值是 warn 不是 fail —— 那是让分析节点去解释的异常点,不是错误
  const spike = checkDataset(qr([["2026-08-01", "A", 10, 1], ["2026-08-02", "B", 10, 1], ["2026-08-03", "C", 10, 1],
                                 ["2026-08-01", "D", 12, 1], ["2026-08-02", "E", 9999, 1]]), shape)
    .find((i) => i.code === "OUTLIER");
  assert(spike && spike.level === "warn");

  // 总分对齐 —— 最能抓出 JOIN 放大这类隐蔽错误的一条
  const grouped = qr([["2026-08-01", "A", 100, 50], ["2026-08-02", "B", 200, 60], ["2026-08-03", "C", 300, 70]]);
  const totalOk = { columns: col("gmv"), rows: [[600]], truncated: false };
  assert.deepEqual(checkTotals(grouped, totalOk, shape.metrics), [], "对得上就不报");
  const totalBad = { columns: col("gmv"), rows: [[400]], truncated: false };
  const mismatch = checkTotals(grouped, totalBad, shape.metrics)[0];
  assert.equal(mismatch.code, "TOTAL_MISMATCH");
  assert.equal(mismatch.level, "fail");
  assert(mismatch.message.includes("JOIN"), "要点出可能的原因,而不是只说对不上");
  // 比率型不参与总分对齐 —— 平均值跨行汇总本来就没有唯一答案
  assert.deepEqual(checkTotals(grouped, { columns: col("rate"), rows: [[999]], truncated: false },
    [{ field: "rate", name: "出货率", rollup: "avg", unit: "%" }]), []);
  // 容差之内不报
  assert.deepEqual(checkTotals(grouped, { columns: col("gmv"), rows: [[601]], truncated: false }, shape.metrics), []);

  /* 这儿原来测的是 checkRollup(「比率被求和」判硬错)。那个函数删了 —— 它写好之后
     生产代码里一次都没调用过,而且在当前结构下也点不着:查询计划里的 rollup 就是
     metricRollup 算出来的那一个,不存在「请求的聚合方式」跟它不一致的情况。
     跑不到的检查加上绿着的测试,给的是「这条守住了」的错觉。
     这件事真正该守的位置是指标定义那一层,见 test-metric-health 的
     ratio-not-aggregated / suspicious-scale / null-unsafe-sum —— 那儿是人能写错、
     而且写错了在界面上完全看不出来的地方(笔均金额算成 2680 元就是从那儿来的)。 */

  // 区间展开
  assert.equal(expectedPoints({ start: "2026-08-01", end: "2026-08-31" }, "day"), 31);
  assert.equal(expectedPoints({ start: "2026-01-01", end: "2026-06-30" }, "month"), 6);
  assert.equal(expectedPoints({ start: "2026-08-31", end: "2026-08-01" }, "day"), 0, "反着的区间返回 0 而不是负数");

  // 干净数据要能过
  assert.equal(verdict(checkDataset(qr([["2026-08-01", "A", 100, 50], ["2026-08-02", "B", 110, 51],
                                        ["2026-08-03", "C", 120, 52]]), shape)).status, "pass");

  const cols = (...n) => n.map((name) => ({ name }));
  // ── 不可加指标的识别(真机上「笔均金额 31 天一加变 31 倍」那个 bug)──
  // 顶层除法 = 比率;COUNT(DISTINCT) 每天去重加起来会把同一个对象数很多遍。
  assert.equal(isAdditiveExpression("SUM(a.gmv + a.online_gmv) AS value"), true);
  assert.equal(isAdditiveExpression("{{select}}SUM(a.gmv)/NULLIF(SUM(a.cnt),0)*1 AS value"), false, "笔均金额:顶层除法");
  assert.equal(isAdditiveExpression("SUM(a.gmv)/NULLIF(COUNT(DISTINCT a.store_id),0) AS value"), false, "日店均");
  assert.equal(isAdditiveExpression("COUNT(DISTINCT CASE WHEN x>0 THEN a.store_id END) AS value"), false, "网点数");
  assert.equal(isAdditiveExpression("SUM(a.amount / a.rate) AS value"), true,
    "除号在括号里是可加的 —— 不能只看有没有斜杠");
  assert.equal(isAdditiveExpression("AVG(a.score) AS value"), false);
  assert.equal(isAdditiveExpression("COUNT(a.id) AS value"), true, "不去重的 COUNT 是可加的");

  // metricRollup:template 型以前只看单位带不带 %,笔均金额单位是「元」所以被判成可加
  const tpl = (name, expr, unit) => ({
    id: name, key: name, name, type: "template", enabled: true, connId: "c", database: "d", unit,
    aliases: [], caliber: "", category: "", dimensions: ["day"],
    queryPlan: { kind: "sql", sourceTables: ["t"], dimensions: {},
      template: `SELECT {{select}}${expr} AS value FROM t WHERE d BETWEEN {{start}} AND {{end}}` },
  });
  assert.equal(metricRollup(tpl("销售额", "SUM(a.gmv)", "元")), "sum");
  assert.equal(metricRollup(tpl("笔均金额", "SUM(a.gmv)/NULLIF(SUM(a.cnt),0)", "元")), "avg",
    "单位是元但它是比率 —— 这正是真机上漏掉的那个");
  /* 去重计数单独归一类,不再跟比率混在 avg 里。两者都不能跨组相加,但后果不同:
     比率跨组还能按平均粗看一眼,去重计数连这个都不成立(同一家店出现在两个组里会被数两遍)。
     分开之后明细表的列合计显示「—」而不是一个看着像数的平均值。 */
  assert.equal(metricRollup(tpl("网点数", "COUNT(DISTINCT a.store_id)", "家")), "count_distinct");
  /* 定义指标的人填了就听他的 —— 有些意图从 SQL 里看不出来:
     「有效天数」= COUNT(DISTINCT 日期),按网点分组后各店天数加起来是网点有效天数
     (算日均时的分母),不分组直接查出来是日历天数。两个都对,猜不出要哪个。 */
  assert.equal(metricRollup({ ...tpl("有效天数", "COUNT(DISTINCT a.d)", "天"), rollup: "sum" }), "sum",
    "指标上显式声明的合并方式优先于自动判断");
  assert.equal(metricRollup(tpl("差评率", "SUM(a.bad)/NULLIF(SUM(a.cnt),0)*100", "%")), "avg");

  // 总分对齐的报错要指对方向:倍数和行数对得上 = 不可加,不是 JOIN 放大
  const g31 = { columns: cols("day", "aov"), rows: Array.from({ length: 31 }, (_, i) => [`2026-08-${i + 1}`, 26]), truncated: false };
  const t1 = { columns: cols("aov"), rows: [[26]], truncated: false };
  const nonAdd = checkTotals(g31, t1, [{ field: "aov", name: "笔均金额", rollup: "sum", unit: "元" }])[0];
  assert.equal(nonAdd.code, "TOTAL_MISMATCH");
  assert(nonAdd.message.includes("不能跨行相加"), "要指出是不可加,别一口咬定 JOIN:" + nonAdd.message);
  assert(!nonAdd.message.includes("JOIN"), nonAdd.message);
  // 倍数和行数对不上,才该怀疑 JOIN
  const blown = checkTotals({ columns: cols("store", "gmv"), rows: [["A", 700], ["B", 700]], truncated: false },
    { columns: cols("gmv"), rows: [[500]], truncated: false }, [{ field: "gmv", name: "销售额", rollup: "sum", unit: "元" }])[0];
  assert(blown.message.includes("JOIN"), blown.message);

  // ── 角色路由:想的活走云端,填表的活走本地 ──
  const cfg = (over) => ({ provider: "local", builtin: { model: "", baseUrl: "", ready: false },
    local: { baseUrl: "http://127.0.0.1:1234/v1", model: "qwen" },
    cloud: { baseUrl: "https://api.deepseek.com/v1", apiKey: "k", model: "deepseek-chat" },
    thinkingEnabled: false, includeSampleRows: false, ...over });
  const full = cfg({});
  assert.equal(providerFor("reasoning", full), "cloud", "理解题意/写结论是「想」");
  assert.equal(providerFor("design", full), "cloud", "选图表/排版面是「想」");
  assert.equal(providerFor("review", full), "cloud");
  assert.equal(providerFor("structured", full), "local", "范围解析是「填表」,本地又准又快还省钱");
  assert.equal(providerFor("cheap", full), "local");

  // 云端没配全 → 整体回落到全局,不能因为"默认想走云端"就跑不起来
  const noCloud = cfg({ cloud: { baseUrl: "", apiKey: "", model: "" } });
  assert.equal(providerFor("reasoning", noCloud), "local");
  assert.equal(providerFor("design", noCloud), "local");
  const halfCloud = cfg({ cloud: { baseUrl: "https://x/v1", apiKey: "", model: "m" } });
  assert.equal(providerFor("reasoning", halfCloud), "local", "缺 apiKey 也算没配全");

  // 用户显式指定的优先级最高
  assert.equal(providerFor("reasoning", cfg({ agentRoles: { reasoning: "local" } })), "local");
  assert.equal(providerFor("structured", cfg({ agentRoles: { structured: "cloud" } })), "cloud");

  // 全局就是云端时,填表的活仍然留本地(本地可用的话)
  assert.equal(providerFor("structured", cfg({ provider: "cloud" })), "local");
  assert.equal(providerFor("reasoning", cfg({ provider: "cloud" })), "cloud");

  const summary = routingSummary(full);
  assert.equal(summary.length, 5);
  assert.equal(summary.find((r) => r.role === "reasoning").reason, "按角色默认");
  assert.equal(routingSummary(cfg({ agentRoles: { reasoning: "local" } })).find((r) => r.role === "reasoning").reason, "你指定的");

  // ── 看板排版:模型决定放什么,代码决定摆哪儿 ──
  const LI = (o) => ({ band: "trend", type: "bar", title: "图", metricIds: ["m1"], dimensions: ["day"],
    width: "half", reason: "", ...o });
  const goodPlan = [
    LI({ band: "kpi", type: "kpi", title: "销售额", dimensions: [], width: "third", metricIds: ["m1"] }),
    LI({ band: "kpi", type: "kpi", title: "订单量", dimensions: [], width: "third", metricIds: ["m2"] }),
    LI({ band: "kpi", type: "kpi", title: "笔均金额", dimensions: [], width: "third", metricIds: ["m3"] }),
    LI({ band: "trend", type: "line", title: "趋势", width: "full" }),
    LI({ band: "structure", type: "pie", title: "渠道", dimensions: ["channel"], width: "half" }),
    LI({ band: "ranking", type: "bar", title: "排名", dimensions: ["store"], width: "half", topN: 10 }),
    LI({ band: "detail", type: "table", title: "明细", dimensions: ["day", "store"], width: "full" }),
  ];
  const packed = packLayout(goodPlan);
  // 不重叠、不越界
  for (const a of packed) assert(a.x >= 0 && a.x + a.w <= 12, `${a.title} 越界`);
  for (let i = 0; i < packed.length; i++) for (let j = i + 1; j < packed.length; j++) {
    const [a, b] = [packed[i], packed[j]];
    assert(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${a.title} 和 ${b.title} 重叠`);
  }
  // KPI 一定在第一行,阅读层级不能乱
  assert(packed.filter((p) => p.band === "kpi").every((p) => p.y === 0), "KPI 必须在最上面");
  assert(packed.find((p) => p.band === "detail").y > packed.find((p) => p.band === "trend").y, "明细在趋势下面");
  // 换 band 一定换行 —— 否则趋势图会和 KPI 挤一行
  assert.equal(packed.find((p) => p.title === "趋势").x, 0, "换 band 要换行");
  // sourceIndex 要指回原数组 —— 不带它,Reviewer 的修正会改错组件
  assert.deepEqual(packed.map((p) => goodPlan[p.sourceIndex].title), packed.map((p) => p.title));
  assert.equal(layoutHeight(packed), 21);

  // ── Reviewer:十条确定性规则 ──
  const badPlan = [
    LI({ band: "trend", type: "line", title: "网点对比", dimensions: ["store"] }),      // 折线用在非时间维度
    LI({ band: "structure", type: "pie", title: "网点占比", dimensions: ["store"] }),   // 40 个分类还用饼图
    LI({ band: "ranking", type: "bar", title: "网点排名", dimensions: ["store"] }),     // 排名没 topN
    LI({ band: "kpi", type: "kpi", title: "销售额KPI", dimensions: ["day"], width: "third" }), // KPI 带维度
    LI({ band: "trend", type: "bar", title: "重复图", dimensions: ["channel"] }),
    LI({ band: "trend", type: "bar", title: "重复图2", dimensions: ["channel"] }),      // 和上面一模一样
    LI({ band: "detail", type: "table", title: "假指标表", dimensions: ["day"], metricIds: ["我编的"], width: "full" }),
  ];
  const rvCtx = { categoryCounts: { 0: 40, 1: 40, 2: 40, 3: 1, 4: 6, 5: 6, 6: 30 }, pointCounts: {},
    validatedMetricIds: ["m1"], ratioMetricIds: [], timeDimensions: ["day", "week", "month", "year"] };
  const found = reviewLayout(packLayout(badPlan), rvCtx);
  const codes = found.map((f) => f.code);
  for (const expected of ["WRONG_CHART_TYPE", "KPI_WITH_DIMENSION", "DUPLICATE_WIDGET", "UNVALIDATED_METRIC"]) {
    assert(codes.includes(expected), `应该抓到 ${expected},实际:${codes.join("、")}`);
  }
  // finding 的 index 必须指回原数组,否则打补丁会改错组件
  const kpiFinding = found.find((f) => f.code === "KPI_WITH_DIMENSION");
  assert.equal(badPlan[kpiFinding.index].title, "销售额KPI", "index 必须指原数组下标,不是排版后的");
  const fakeFinding = found.find((f) => f.code === "UNVALIDATED_METRIC");
  assert.equal(badPlan[fakeFinding.index].title, "假指标表");
  assert.equal(reviewVerdict(found).verdict, "needs_revision");

  // 迭代打补丁要收敛:修完会产生新重复(三张图都被改成 bar 后彼此相同),代码里收掉,
  // 不值得为它烧一轮 LLM 重设计
  const recheck = (items) => reviewLayout(packLayout(items), rvCtx);
  const repaired = applyFixes(badPlan, found, recheck);
  assert.equal(reviewVerdict(recheck(repaired.items)).verdict, "pass", "自动修完应该能过:" + JSON.stringify(repaired.remaining));
  assert(repaired.items.length < badPlan.length, "重复和空组件要被删掉");
  assert(repaired.items.every((i) => i.metricIds.length > 0), "没绑指标的空组件要删,留着比没有更糟");
  assert(repaired.items.every((i) => !(i.type === "kpi" && i.dimensions.length)), "KPI 不该带维度");
  assert(repaired.applied.includes("DROP_EMPTY"));

  // 干净的版面不该被乱改
  const cleanFindings = reviewLayout(packLayout(goodPlan), { categoryCounts: { 4: 5, 5: 20 }, pointCounts: {},
    validatedMetricIds: ["m1", "m2", "m3"], ratioMetricIds: [], timeDimensions: ["day", "week", "month", "year"] });
  assert(!cleanFindings.some((f) => f.severity === "must_fix"), "正常版面不该报必须修:" + cleanFindings.map((f) => f.code).join("、"));

  // ── AI 溯源:必须活过存取,且不能泄进导出的离线 HTML ──
  const withProv = normalizeDashboard({
    schemaVersion: 3, id: "d-prov", title: "8月经营看板",
    widgets: [{ id: "w1", type: "kpi", datasetId: "ds", title: "销售额",
      bindings: { metricIds: ["m1"], measures: [], secondaryMetricIds: [], dimensions: [] },
      options: { decimals: 2, showLegend: true, smooth: true, topN: 0, metrics: {} } }],
    aiProvenance: {
      workflowId: "wf-1", userRequest: "分析上个月经营情况,做个看板",
      createdAt: "2026-09-11T10:00:00.000Z", model: "cloud · deepseek-chat",
      widgetReasons: { w1: "销售额是核心指标,放在最上面第一眼能看到" },
      autoFixed: ["自动修了 2 处:WRONG_CHART_TYPE、DUPLICATE_WIDGET"],
      openIssues: ["网点排名数据点较多,数据标签可能拥挤"],
    },
  });
  assert.equal(withProv.aiProvenance.userRequest, "分析上个月经营情况,做个看板",
    "顶层是逐字段列举的,漏了就会在存取之间被静默抹掉 —— refreshInterval 当年就是这么丢的");
  assert.equal(withProv.aiProvenance.widgetReasons.w1, "销售额是核心指标,放在最上面第一眼能看到");
  assert.deepEqual(withProv.aiProvenance.openIssues, ["网点排名数据点较多,数据标签可能拥挤"]);
  // 人工建的看板不该凭空多出这个字段
  assert.equal(normalizeDashboard({ schemaVersion: 3, id: "d2", title: "手工", widgets: [] }).aiProvenance, undefined);
  // 服务层写入
  const marked = dash.setProvenance(dash.create({ title: "T" }),
    { workflowId: "wf", userRequest: "q", createdAt: "t", widgetReasons: { a: "b" } });
  assert.equal(marked.aiProvenance.workflowId, "wf");

  // 删掉的假警告:数据标签默认就不开,"开了会糊"是在警告不存在的事(真机上一次刷 4 条噪音)。
  // 该做的是建组件时按点数决定开不开,而不是事后提醒。
  const noisy = reviewLayout(packLayout([LI({ dimensions: ["store"] })]), {
    categoryCounts: { 0: 40 }, pointCounts: { 0: 400 },
    validatedMetricIds: ["m1"], ratioMetricIds: [], timeDimensions: ["day", "week", "month", "year"] });
  assert(!noisy.some((f) => f.code === "TOO_MANY_LABELS"), "不该再有这条假警告:" + noisy.map((f) => f.code).join("、"));

  // ── 截断:比"数据有问题"更危险,每行都对但加起来少一大截,表面看不出来 ──
  const tshape = { dimensions: ["day"], metrics: [{ field: "gmv", name: "销售额", rollup: "sum", unit: "元" }],
    timeField: "day", dateRange: { start: "2026-08-01", end: "2026-08-31" }, grain: "day" };
  const cut = { columns: cols("day", "gmv"), rows: Array.from({ length: 20000 }, () => ["2026-08-01", 1]), truncated: true };
  const cutIssues = checkDataset(cut, tshape);
  assert.equal(verdict(cutIssues).status, "fail", "截断必须硬拦 —— 否则合计、同环比、TopN 全是残缺数据上算的");
  assert.equal(cutIssues[0].code, "TRUNCATED");
  assert(cutIssues[0].message.includes("减少分组维度"), "要指出该降维重查,而不是提高上限硬扛");
  // 截断时总分对齐毫无意义 —— 少的那部分本来就没查回来,报 JOIN 会把人带偏
  assert.deepEqual(checkTotals(cut, { columns: cols("gmv"), rows: [[48260000]], truncated: false }, tshape.metrics), [],
    "截断时不该报 TOTAL_MISMATCH");
  // 没截断时照常比
  const whole = { columns: cols("day", "gmv"), rows: [["2026-08-01", 100], ["2026-08-02", 100]], truncated: false };
  assert.equal(checkTotals(whole, { columns: cols("gmv"), rows: [[500]], truncated: false }, tshape.metrics)[0].code, "TOTAL_MISMATCH");

  // ── 单位换算要看真实量级,不能一刀切 ──
  // 真机教训:第一版对所有 KPI 一律建议「万」,笔均金额 32.60 元被显示成「0万」、
  // 日店均 4180 元变成「0.4万」—— 自动修正把能看的数改成了看不懂的数。
  const KPI = (title, metricId, scale) => ({ band: "kpi", type: "kpi", title, metricIds: [metricId],
    dimensions: [], width: "third", reason: "", ...(scale ? { scale } : {}) });
  const kpis = [KPI("销售额", "m1"), KPI("订单量", "m2"), KPI("笔均金额", "m3", "wan"), KPI("日店均", "m4", "wan")];
  const mags = { 0: 48260000, 1: 1806400, 2: 32.60, 3: 4180.00 };   // 千万级/百万级/几十元/几千元各一个
  const scaleCtx = { categoryCounts: {}, pointCounts: {}, magnitudes: mags,
    validatedMetricIds: ["m1", "m2", "m3", "m4"], ratioMetricIds: [], timeDimensions: ["day"] };
  const scaleFindings = reviewLayout(packLayout(kpis), scaleCtx);
  const wanted = Object.fromEntries(scaleFindings.filter((f) => f.fix?.scale != null).map((f) => [kpis[f.index].title, f.fix.scale]));
  assert.equal(wanted["销售额"], "wan", "4826 万该换算");
  assert.equal(wanted["订单量"], "wan");
  assert.equal(wanted["笔均金额"], "none", "32.60 元换成万就是 0,必须撤掉");
  assert.equal(wanted["日店均"], "none", "4180 元换成万是 0.4,反而看不懂");
  const scaled = applyFixes(kpis, scaleFindings, (n) => reviewLayout(packLayout(n), scaleCtx));
  assert.equal(scaled.items.find((i) => i.title === "笔均金额").scale, "none");
  assert.equal(scaled.items.find((i) => i.title === "销售额").scale, "wan");
  assert.equal(scaled.items.length, 4, "四个不同指标的 KPI 不是重复图");
  // 亿级走亿
  assert.equal(reviewLayout(packLayout([KPI("全年GMV", "m1")]), { ...scaleCtx, magnitudes: { 0: 3.2e8 } })
    .find((f) => f.fix?.scale).fix.scale, "yi");
  // 拿不到量级时不瞎猜
  assert(!reviewLayout(packLayout([KPI("未知", "m1")]), { ...scaleCtx, magnitudes: {} })
    .some((f) => f.code === "NO_SCALE" || f.code === "WRONG_SCALE"), "算不出量级就别动它");

  // ── 数组 schema 必须带上限 ──
  // 不带上限时模型会陷入重复循环,把同一项吐十几遍直到撞 max_tokens 被截断,
  // 最后得到一段断在半截的 JSON —— 真机上就是这么挂的。
  assert.equal(S.arr(S.str()).maxItems, 20, "S.arr 默认就要有上限");
  assert.equal(S.arr(S.str(), "x", 4).maxItems, 4);
  assert(validate(["a", "b", "c"], S.arr(S.str(), "x", 2))[0].includes("最多 2 项"));

  // ── Reviewer 的判断层:只能改标题/层级,绝不能绕过指标验证 ──
  const JI = (o) => ({ band: "trend", type: "bar", title: "图1", metricIds: ["m1"],
    dimensions: ["store"], width: "half", reason: "", ...o });
  const judgeItems = [JI({ title: "图1" }), JI({ title: "bar chart", band: "detail", type: "kpi", dimensions: [] }), JI({ title: "多余的" })];
  const judged = applyJudgement(judgeItems, { verdict: "needs_revision", findings: [
    { index: 0, issue: "标题看不出在说什么", severity: "should_fix", fix: { title: "8月各网点销售额排名", subtitle: "按网点汇总,单位元" } },
    { index: 1, issue: "核心数字被放到明细区", severity: "must_fix", fix: { band: "kpi" } },
    { index: 2, issue: "和第0个是同一件事", severity: "should_fix", fix: { drop: true } },
    { index: 0, issue: "应该换个指标", severity: "must_fix", fix: { metricIds: ["我偷偷塞的"] } },
    { index: 0, issue: "应该换成饼图", severity: "must_fix", fix: { type: "pie" } },
    { index: -1, issue: "整体缺一张趋势图", severity: "should_fix" },
  ] });
  /* 审查层**只报不动手**。真机上一块 8 组件的看板被自动修了 9 处,
     一多半是标题重写和「这个组件多余」—— 用户原话:「版式主题感觉没变化,
     像是被你框死了」。设计是模型做的,端上来的却是被我改过一遍的版本。
     会让人**读错数**的硬伤由代码规则管(那些有客观标准);
     标题好不好、哪个组件多余,没有客观标准,交回给设计者。 */
  assert.equal(judged.items[0].title, "图1", "标题是设计者的决定,评审只能提意见,不能改");
  assert.equal(judged.items[0].subtitle, undefined, "副标题同理");
  assert.equal(judged.items[1].band, "kpi", "层级还可以改 —— 它影响的是兜底排版的顺序,不是审美");
  assert.equal(judged.items.length, 3, "评审说「多余」不算数,不能替设计者删组件");
  const dropped = judged.remaining.map((r) => r.reason);
  assert.ok(dropped.includes("标题看不出在说什么") && dropped.includes("和第0个是同一件事"),
    "不动手,但意见要如实留给人看:" + JSON.stringify(dropped));
  // 越权必须挡住:指标绑定是过了验证闸门的,评审动不了
  assert.deepEqual(judged.items.map((i) => i.metricIds), [["m1"], ["m1"], ["m1"]], "绝不允许评审改指标绑定");
  assert.deepEqual(judged.items.map((i) => i.type), ["bar", "kpi", "bar"], "图表类型由代码规则管,评审改不了");
  // 改不动的要如实留给人,不能吞掉
  const left = judged.remaining.map((r) => r.reason);
  assert(left.includes("应该换个指标") && left.includes("应该换成饼图") && left.includes("整体缺一张趋势图"),
    "越权和没给 fix 的意见都要留下来给人看:" + JSON.stringify(left));
  // pass 时不该动任何东西
  const untouched = applyJudgement(judgeItems, { verdict: "pass", findings: [] });
  assert.deepEqual(untouched.items, judgeItems);
  assert.deepEqual(untouched.applied, []);
  // 空 fix 不算修改
  const emptyFix = applyJudgement(judgeItems, { verdict: "needs_revision",
    findings: [{ index: 0, issue: "说不清", severity: "nit", fix: { title: "   " } }] });
  assert.deepEqual(emptyFix.items[0].title, "图1", "空白标题不算修改");
  assert.equal(emptyFix.remaining.length, 1, "改不动就留给人");

  // ── ratio 型计划按定义不可加,别看它分子长什么样 ──
  // 踩过:「店均预存金额」= 预存金额 ÷ 营业网点日数,分子 SUM(...) 看着可加,
  // 于是整体被判成 sum,明细表开行合计就把一堆"店均"加起来了。
  const ratioPlan = {
    id: "r1", key: "r1", name: "店均预存金额", type: "template", enabled: true, connId: "c", database: "d",
    unit: "元", aliases: [], caliber: "", category: "", dimensions: ["day"],
    queryPlan: {
      kind: "ratio", scale: 1,
      numerator: { kind: "sql", sourceTables: ["t"], dimensions: {},
        template: "SELECT {{select}}COALESCE(SUM(b.deposit_amt),0) AS value FROM t WHERE d BETWEEN {{start}} AND {{end}}" },
      denominator: { kind: "sql", sourceTables: ["t"], dimensions: {},
        template: "SELECT {{select}}COUNT(DISTINCT CONCAT(a.store_id,'#',a.stat_date)) AS value FROM t WHERE d BETWEEN {{start}} AND {{end}}" },
    },
  };
  assert.equal(metricRollup(ratioPlan), "avg", "比率型跨行相加没有意义,和分子是不是 SUM 无关");
  // 可加的仍然是 sum,别矫枉过正
  assert.equal(metricRollup({ ...ratioPlan, queryPlan: ratioPlan.queryPlan.numerator }), "sum");

  // 周期内真去重的人数指标,显示层绝不能求和
  const distinctMetric = { ...ratioPlan, id: "r2", name: "消费会员数", unit: "人",
    queryPlan: { kind: "sql", sourceTables: ["t"], dimensions: {},
      template: "SELECT {{select}}COUNT(DISTINCT CASE WHEN b.consume_flag=1 AND b.member_flag=1 THEN b.user_id END) AS value FROM t WHERE d BETWEEN {{start}} AND {{end}}" } };
  assert.equal(metricRollup(distinctMetric), "count_distinct", "按天的去重人数加起来会把同一个人数很多遍");

  // ── 把一张已经删掉的表从血缘里摘干净 ────────────────────────────
  // 真机场景:线上把 ads_outlet_member_day 和它的 DataX 作业都删了,可 Sonde 里
  // 还留着 3 条边 + 一条 ops 记录,巡检天天报警、图上画着通往空气的线。
  {
    const gone = "shop_ads.ads_outlet_member_day";
    const keep = "shop_ads.ads_outlet_daily";
    lineageStore.setState({ scanned: [
      { from: "shop_dws.dws_user_outlet_behavior_day", to: gone, source: "etl", kind: "写入" },
      { from: "shop_dim.dim_outlet_mapping", to: gone, source: "etl", kind: "写入" },
      { from: gone, to: "metric:m1", source: "metric", kind: "用于" },
      { from: "shop_dwd.dwd_a", to: keep, source: "etl", kind: "写入" },   // 无关的边,必须活下来
    ] });
    opsStore.setState({
      ops: { [gone]: { origin: "etl", schedule: "0 0 8 * * ? *" }, [keep]: { origin: "etl", schedule: "0 0 9 * * ? *" } },
      health: { [gone]: { state: "error", checkedAt: 1 } },
    });

    lineageStore.getState().forgetNode(gone);
    const left = lineageStore.getState().scanned;
    assert.equal(left.length, 1, "指向它的三条边(不论来源)都该清掉,得到:" + JSON.stringify(left));
    assert.equal(left[0].to, keep, "别的表的血缘不能受牵连");
    assert.equal(opsStore.getState().ops[gone], undefined, "运行状态也要一起忘掉,否则巡检还会报它");
    assert.equal(opsStore.getState().health[gone], undefined);
    assert.ok(opsStore.getState().ops[keep], "只忘掉这一个节点");
    assert.ok(/已摘掉/.test(lineageStore.getState().lastMsg ?? ""), lineageStore.getState().lastMsg);

    // 反向对照:换个不存在的节点 id,必须什么都不删,并且明说"没找到"
    lineageStore.getState().forgetNode("shop_ads.不存在的表");
    assert.equal(lineageStore.getState().scanned.length, 1, "摘一个血缘里没有的节点不该误伤任何边");
    assert.ok(/没有指向/.test(lineageStore.getState().lastMsg ?? ""),
      "没删到东西就得说没删到,不能也报「已摘掉」:" + lineageStore.getState().lastMsg);

    // 作业不删,下次扫描会把边画回来 —— 所以要能单独摘作业
    etlStore.setState({ sources: [{ id: "s1", name: "[datax_jobs]", kind: "datax", updatedAt: 0, jobs: [
      { id: "j1", name: "ads_outlet_member_day", kind: "datax", sources: [], targets: [{ kind: "db", database: "shop_ads", table: "ads_outlet_member_day" }] },
      { id: "j2", name: "ads_outlet_daily", kind: "datax", sources: [], targets: [{ kind: "db", database: "shop_ads", table: "ads_outlet_daily" }] },
    ] }] });
    etlStore.getState().removeJob("s1", "j1");
    const jobs = etlStore.getState().sources[0].jobs;
    assert.deepEqual(jobs.map((j) => j.id), ["j2"], "只摘掉点名的那个作业,同源的其余 60 个作业不能跟着没");
    // 反向对照:作业 id 打错时不能静默清空整个源
    etlStore.getState().removeJob("s1", "j-typo");
    assert.equal(etlStore.getState().sources[0].jobs.length, 1);
    assert.equal(tableId("shop_ads", "ads_outlet_member_day"), gone);

    lineageStore.setState({ scanned: [] });
    opsStore.setState({ ops: {}, health: {} });
    etlStore.setState({ sources: [] });
  }

  // ── 导入指标目录:"一个都没导进去"绝不能报绿的 ────────────────────
  // 真机踩过:底表从 ads 换到 dws,重新导一份口径,点的是「导入指标目录」(keep),
  // 12 个标识全在库里 → 全跳过 → 弹了个绿色的「跳过 12 个同标识的」。
  // 人看完以为成了,回头查数还是老表,而且指标编辑器里根本不显示底表,查不出来。
  {
    const allSkipped = importSummary({ added: 0, replaced: 0, skipped: 12 });
    assert.equal(allSkipped.kind, "warn", "一个都没变的导入必须是警告色,不能是 success");
    assert.ok(/一个都没导进去/.test(allSkipped.text), allSkipped.text);
    assert.ok(/导入并覆盖同名指标/.test(allSkipped.text),
      "光说「跳过了」没用,得把该点哪个按钮写在脸上:" + allSkipped.text);

    // 反向对照:真覆盖了就该是 success,别把正常结果也吓唬成警告
    const replaced = importSummary({ added: 0, replaced: 12, skipped: 0 });
    assert.equal(replaced.kind, "success");
    assert.ok(/覆盖 12 个/.test(replaced.text), replaced.text);
    // 部分跳过仍是成功 —— 毕竟有东西进去了
    const mixed = importSummary({ added: 3, replaced: 0, skipped: 9 });
    assert.equal(mixed.kind, "success");
    assert.ok(/新增 3 个/.test(mixed.text) && /跳过 9 个/.test(mixed.text), mixed.text);
    // 取消选文件 → 什么都不弹
    assert.equal(importSummary({ added: 0, replaced: 0, skipped: 0 }), null);
  }

  // 语义指标的底表要能从 queryPlan 里解析出来给界面显示 —— 改没改对得看得见
  {
    const ratio = {
      kind: "ratio", scale: 1,
      numerator: { kind: "sql", dimensions: {}, sourceTables: ["shop_dws.dws_user_outlet_behavior_day", "shop_ads.ads_outlet_dim"], template: "SELECT 1" },
      denominator: { kind: "sql", dimensions: {}, sourceTables: ["shop_ads.ads_outlet_dim"], template: "SELECT 1" },
    };
    assert.deepEqual(planSourceTables(ratio),
      ["shop_dws.dws_user_outlet_behavior_day", "shop_ads.ads_outlet_dim"],
      "比率型要把分子分母的底表并起来去重");
  }

  // ── 指标体检:底表没了 / 字段不存在,得当场看得出来 ──────────────
  // 这条测试对应的真事:ads_outlet_member_day 被删,12 个会员指标的口径还挂在上面,
  // 指标中心一切正常,直到有人去查数才发现是空的。
  {
    const mk = (id, name, tables, template) => ({
      id, key: id, name, type: "template", enabled: true, connId: "c", database: "d",
      unit: "人", aliases: [], caliber: "", category: "会员", dimensions: ["day"],
      queryPlan: { kind: "sql", scale: 1, dimensions: {}, sourceTables: tables, template },
    });
    // 库里真实存在的列
    const world = {
      "shop_dws.dws_user_outlet_behavior_day": ["stat_date", "user_id", "behavior_outlet_id", "consume_flag", "member_flag", "consume_amt"],
      "shop_dim.dim_outlet_mapping": ["qm_id", "store_id"],
    };
    const lookup = async (_conn, db, table) => world[`${db}.${table}`] ?? null;

    const good = mk("m1", "消费会员数", ["shop_dws.dws_user_outlet_behavior_day", "shop_dim.dim_outlet_mapping"],
      "SELECT {{select}}COUNT(DISTINCT CASE WHEN b.consume_flag=1 AND b.member_flag=1 THEN b.user_id END) AS value"
      + " FROM shop_dws.dws_user_outlet_behavior_day b JOIN shop_dim.dim_outlet_mapping sm ON sm.qm_id=b.behavior_outlet_id"
      + " WHERE b.stat_date BETWEEN {{start}} AND {{end}}");
    const badCol = mk("m2", "预存金额", ["shop_dws.dws_user_outlet_behavior_day"],
      "SELECT {{select}}SUM(b.deposit_amt) AS value FROM shop_dws.dws_user_outlet_behavior_day b WHERE b.stat_date BETWEEN {{start}} AND {{end}}");
    const badTable = mk("m3", "会员消费额", ["shop_ads.ads_outlet_member_day"],
      "SELECT {{select}}SUM(m.member_consume_amt) AS value FROM shop_ads.ads_outlet_member_day m WHERE m.stat_date BETWEEN {{start}} AND {{end}}");

    const r = await checkMetrics([good, badCol, badTable], lookup);
    assert.equal(r.checked, 3);
    assert.equal(r.tables, 3, "同一张底表被多个指标共用时只问一次:" + r.tables);
    const byName = Object.fromEntries(r.unhealthy.map((h) => [h.metricName, h.issues]));

    assert.ok(!byName["消费会员数"], "口径完全对得上的指标不能被报出来 —— 会误报的体检没人看第二次");
    assert.equal(byName["预存金额"][0].kind, "column-missing");
    assert.ok(/deposit_amt/.test(byName["预存金额"][0].text), byName["预存金额"][0].text);
    assert.equal(byName["会员消费额"][0].kind, "table-missing");
    assert.ok(/ads_outlet_member_day/.test(byName["会员消费额"][0].text));
    // 表都没了就别再报它的列 —— 并集缺一块,判出来的"列不存在"全是假的
    assert.equal(byName["会员消费额"].length, 1,
      "底表不存在时不该顺带报一堆列不存在:" + JSON.stringify(byName["会员消费额"]));

    // 反向对照 1:库里啥都有,必须一个问题都不报
    const all = async () => [...new Set(Object.values(world).flat().concat(["deposit_amt", "member_consume_amt"]))];
    const clean = await checkMetrics([good, badCol, badTable], all);
    assert.equal(clean.unhealthy.length, 0, "列全都在时不能还报问题:" + JSON.stringify(clean.unhealthy));

    // 反向对照 2:停用的指标不体检(停用就是不想要了,报它是噪音)
    const off = await checkMetrics([{ ...badTable, enabled: false }], lookup);
    assert.equal(off.checked, 0);

    // 表名本身会被 `库.表` 的写法抓成"列",必须排掉,否则每个指标都误报一次
    assert.ok(referencedColumns("FROM shop_dws.dws_user_outlet_behavior_day b").includes("dws_user_outlet_behavior_day"),
      "抠列的正则确实会把表名抓进来 —— 所以 checkMetrics 里那层排除是必需的,不是多余小心");
  }

  // ── 转圈的那一步必须是真正在跑的那一步 ────────────────────────
  // 真机现象:界面一直停在「核对指标中心」转圈。其实核对早就过了 ——
  // onStep 只在节点跑完时回调,于是下一步等云模型的那几十秒,
  // 界面显示的还是上一步。看着一模一样,判断完全相反。
  {
    const g = new Graph();
    let release;
    const gate = new Promise((r) => { release = r; });
    g.addNode("Fast", async () => ({}));
    g.addNode("Slow", async () => { await gate; return {}; });
    g.setEntry("Fast");
    g.addEdge("Fast", "Slow");
    g.addEdge("Slow", END);

    const seen = [];
    const running = g.run(createState({ userRequest: "问题" }), { onStep: (s) => seen.push(s.currentNode) });

    // 让 Fast 跑完、Slow 进场并卡住
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(seen[seen.length - 1], "Slow",
      "Slow 正在跑的时候,界面拿到的 currentNode 必须已经是 Slow,不能还停在 Fast:" + JSON.stringify(seen));
    assert.ok(seen.includes("Fast"), "Fast 也要报过,否则时间线缺一格:" + JSON.stringify(seen));

    release();
    const done = await running;
    assert.equal(done.status, "done");
    assert.ok(done.nodeStartedAt > 0, "得记下这一步什么时候开始的,界面才能显示「已等 N 秒」");
  }

  // ── 放开排版:模型自己的构图要留住,只修真冲突 ──────────────────
  // 起因是用户的话:「就像有一个模版束缚他一样」。原来模型只能说"占半行、属于趋势区",
  // 坐标全由 packLayout 按固定 band 顺序铺 —— 于是每块看板长得一模一样。
  {
    const it = (title, x, y, w, h, extra = {}) => ({
      band: "trend", type: "bar", title, metricIds: ["m"], dimensions: ["store"],
      width: "half", reason: "r", x, y, w, h, ...extra,
    });

    // 模型的构图必须原样保留:左窄右宽、明细顶在最上面,都不该被重排
    const asDesigned = repairLayout([
      it("大图", 4, 0, 8, 8),
      it("窄KPI-1", 0, 0, 4, 2, { type: "kpi", band: "kpi", dimensions: [] }),
      it("窄KPI-2", 0, 2, 4, 2, { type: "kpi", band: "kpi", dimensions: [] }),
    ]);
    const big = asDesigned.find((p) => p.title === "大图");
    assert.deepEqual({ x: big.x, y: big.y, w: big.w, h: big.h }, { x: 4, y: 0, w: 8, h: 8 },
      "模型说大图放右边占 8 栏 8 行,就得是这样 —— 不能被重排成「第一行 KPI 第二行图」");
    assert.equal(asDesigned.find((p) => p.title === "窄KPI-2").x, 0, "左侧窄列要保持在左侧");
    // 走真正的入口再验一遍 —— 只测 repairLayout 的话,resolveLayout 退化成"永远兜底排版"
    // (等于这次放开白做了)没有任何测试会挂。踩过:第一版就是这样。
    const viaEntry = resolveLayout([
      it("大图", 4, 0, 8, 8),
      it("窄KPI-1", 0, 0, 4, 2, { type: "kpi", band: "kpi", dimensions: [] }),
      it("窄KPI-2", 0, 2, 4, 2, { type: "kpi", band: "kpi", dimensions: [] }),
    ]);
    const bigEntry = viaEntry.find((p) => p.title === "大图");
    assert.deepEqual({ x: bigEntry.x, y: bigEntry.y, w: bigEntry.w }, { x: 4, y: 0, w: 8 },
      "坐标都给全了就必须用模型的构图,不能退回按 band 铺:" + JSON.stringify(viaEntry.map((p) => ({ t: p.title, x: p.x, y: p.y }))));

    // 出界:夹回网格,不是丢掉
    const clamped = repairLayout([it("超宽", 8, 0, 9, 4)])[0];
    assert.ok(clamped.x + clamped.w <= 12, `夹回网格内,得到 x=${clamped.x} w=${clamped.w}`);

    // 重叠:后来的往下让,不是叠着画
    const split = repairLayout([it("A", 0, 0, 6, 4), it("B", 3, 1, 6, 4)]);
    const [a, b] = ["A", "B"].map((t) => split.find((p) => p.title === t));
    const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!hit, "重叠必须拆开:" + JSON.stringify([a, b].map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }))));

    // 大洞:模型常给 y=0 然后 y=20,要收上来
    const gapped = repairLayout([it("上", 0, 0, 12, 3), it("下", 0, 20, 12, 4)]);
    assert.equal(gapped.find((p) => p.title === "下").y, 3, "中间十几行空白要收掉:" + JSON.stringify(gapped.map((p) => p.y)));

    // 反向对照:模型没给坐标 → 退回按 band 铺,不能排出一堆 (0,0)
    const noCoords = resolveLayout([
      { band: "kpi", type: "kpi", title: "K", metricIds: ["m"], dimensions: [], width: "quarter", reason: "r" },
      { band: "trend", type: "line", title: "L", metricIds: ["m"], dimensions: ["day"], width: "full", reason: "r" },
    ]);
    assert.ok(noCoords.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), "兜底排版要给出完整坐标");
    assert.ok(noCoords.find((p) => p.title === "L").y > 0, "没坐标时仍按 band 分行,别全挤在第 0 行");

    // 反向对照:只有零星一个给了坐标 → 那多半是漏填,不该当构图用
    const mostlyMissing = resolveLayout([
      { band: "kpi", type: "kpi", title: "K1", metricIds: ["m"], dimensions: [], width: "quarter", reason: "r", x: 0, y: 0 },
      { band: "trend", type: "line", title: "L1", metricIds: ["m"], dimensions: ["day"], width: "full", reason: "r" },
      { band: "ranking", type: "bar", title: "B1", metricIds: ["m"], dimensions: ["store"], width: "half", reason: "r" },
    ]);
    assert.ok(mostlyMissing.find((p) => p.title === "L1").y > 0, "三个里只给一个坐标 = 漏填,应退回兜底排版");

    // text 块要能排进来 —— 看板不是图表堆,得能写小标题和结论
    const withText = repairLayout([
      { band: "kpi", type: "text", title: "分区", content: "一、总体", metricIds: [], dimensions: [], width: "full", reason: "r", x: 0, y: 0, w: 12, h: 1 },
      it("图", 0, 1, 6, 4),
    ]);
    assert.equal(withText.length, 2);
    assert.equal(withText.find((p) => p.type === "text").content, "一、总体");
  }

  // ── 真工具那一层:外观/正文到底有没有写进文档 ─────────────────
  // 上面那块打的是假工具,只证明了「executor 把字段传出去了」。
  // 传出去 ≠ 写进去 —— 中间还有 add_component / style_component 的真实现。
  // 「每块看板长得一样」如果是断在这一层,上面那些断言一个都抓不到。
  {
    const dash = await callTool("create_dashboard", { title: "外观验证", description: "" });
    assert.ok(dash.ok, JSON.stringify(dash.error));
    const id = dash.data.dashboardId;

    const text = await callTool("add_component", { dashboardId: id, type: "text", title: "分区", content: "一、总体判断" });
    assert.ok(text.ok, JSON.stringify(text.error));
    const styled = await callTool("style_component", {
      dashboardId: id, widgetId: text.data.widgetId,
      appearance: { visualPreset: "aurora", radius: 12, hideTitle: true },
      text: { fontSize: 18, align: "center" },
      footnote: "数据截至昨日",
    });
    assert.ok(styled.ok, JSON.stringify(styled.error));

    const doc = getDraft(id);
    const w = doc.widgets.find((x) => x.type === "text");
    assert.equal(w.options.content, "一、总体判断", "text 正文没写进文档,页面上就是个空卡");
    assert.equal(w.options.appearance?.visualPreset, "aurora",
      "视觉预设没写进文档 —— 这就是「版式主题始终是那一套」:" + JSON.stringify(w.options.appearance));
    assert.equal(w.options.appearance?.radius, 12);
    assert.equal(w.options.appearance?.hideTitle, true);
    assert.equal(w.options.text?.fontSize, 18);
    assert.equal(w.footnote, "数据截至昨日");

    // 两次 style 要合并而不是互相擦掉 —— executor 分几次配置同一个组件
    await callTool("style_component", { dashboardId: id, widgetId: text.data.widgetId, appearance: { radius: 4 } });
    const after = getDraft(id).widgets.find((x) => x.type === "text");
    assert.equal(after.options.appearance.radius, 4, "新值要生效");
    assert.equal(after.options.appearance.visualPreset, "aurora", "旧值不能被整个对象替换掉抹了");
  }

  // ── Phase 0:从 DashboardWorkspace 搬出来的三块,搬完得还能用 ──────
  {
    // 导入一律当新草稿:换 id、标题加后缀、revision 归 1。
    // 不换 id 会让「导入」变成「覆盖同 id 的现有看板」—— 而且是静默覆盖。
    const src = { id: "dashboard-old", title: "经营日报", status: "published", revision: 7,
      widgets: [{ id: "w1" }], datasets: [], filters: [], metrics: [] };
    const { doc, from } = parseDashboardFile(JSON.stringify(src), "x.json");
    assert.equal(from, "json");
    assert.notEqual(doc.id, "dashboard-old", "导入必须换新 id,否则会静默覆盖同 id 的看板");
    assert.equal(doc.revision, 1);
    assert.equal(doc.status, "draft");
    assert.ok(doc.title.includes("导入"), doc.title);
    assert.equal(doc.widgets.length, 1, "组件不能在搬运途中丢");
    // 反向对照:不是看板的 JSON 要报错,不能生成一个空看板让人以为导成功了
    assert.throws(() => parseDashboardFile('{"foo":1}', "x.json"), /不是有效的看板/);

    // 运行时合并的优先级:下钻 > 筛选 > 基础
    const docRt = { datasets: [{ id: "d1", metricIds: ["m"], connectionId: "c", sql: "" }], widgets: [{ id: "w1", datasetId: "d1" }] };
    const merged = mergeCanvasRuntime(docRt, {
      runtime: { d1: { loading: false, tag: "base" } },
      filteredRuntime: { d1: { loading: false, tag: "filtered" } },
      drillRuntime: { d1: { loading: false, tag: "drill" } },
      componentRuntime: {},
      comparisonRuntime: {},
    }, () => ["有筛选"]);
    assert.equal(merged.d1.tag, "drill", "下钻的运行时要盖过筛选和基础");
    const noDrill = mergeCanvasRuntime(docRt, {
      runtime: { d1: { loading: false, tag: "base" } },
      filteredRuntime: { d1: { loading: false, tag: "filtered" } },
      drillRuntime: {}, componentRuntime: {}, comparisonRuntime: {},
    }, () => ["有筛选"]);
    assert.equal(noDrill.d1.tag, "filtered", "有生效筛选时不能拿没筛过的数据画图");
    const noFilter = mergeCanvasRuntime(docRt, {
      runtime: { d1: { loading: false, tag: "base" } },
      filteredRuntime: { d1: { loading: false, tag: "filtered" } },
      drillRuntime: {}, componentRuntime: {}, comparisonRuntime: {},
    }, () => []);
    assert.equal(noFilter.d1.tag, "base");
    // 组件级运行时要能盖住数据集级的
    const byWidget = mergeCanvasRuntime(docRt, {
      runtime: { d1: { loading: false, tag: "base" } }, filteredRuntime: {}, drillRuntime: {},
      componentRuntime: { w1: { loading: false, tag: "component" } }, comparisonRuntime: {},
    }, () => []);
    assert.equal(byWidget.w1.tag, "component");

    /* 下钻链是「从当前维度再往下钻到哪几层」,不包含当前这层。
       点中的那个值属于组件现在按什么分组(这里是 zone),不属于链里的任何一层 ——
       记错了的话筛选条件会挂到另一个字段上,数字全不对,而且不报错。 */
    assert.deepEqual(nextDrillPath(["a", "b"], [], "x", "zone"), [{ dimension: "zone", value: "x" }],
      "第一次点,筛的是当前分组维度");
    assert.deepEqual(nextDrillPath(["a", "b"], [{ dimension: "zone", value: "x" }], "y", "zone"),
      [{ dimension: "zone", value: "x" }, { dimension: "a", value: "y" }],
      "第二次点,筛的是链里的第一层");
    assert.equal(nextDrillPath(["a", "b"], [{ dimension: "zone", value: "x" }, { dimension: "a", value: "y" }], "z", "zone"), null,
      "两层链钻两次就到底了");
    assert.equal(nextDrillPath([], [], "x", "zone"), null, "没配下钻维度时点一下不该有反应");
  }

  // ── 0 行时当场查清为什么,别留给人猜 ─────────────────────────
  // 真机上为一次「共 0 行」来回折腾了四五轮:是日期不对?筛选值对不上?
  // 还是指标口径本身就查不出数?每猜一轮都要改代码、装包、让人再跑一遍。
  // 这三种可能三次查询就分得开。
  {
    const seen = [];
    resetTools(); // 上一段已经清过了;这里只换成本段要用的假工具
    registerTool({ name: "execute_query_plan", description: "", readOnly: true,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: () => ({ planId: "p", rowCount: 0, truncated: false, columns: ["war_zone"], sampleRows: [] }) });
    registerTool({ name: "diagnose_empty_result", description: "", readOnly: true,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: (input) => {
        seen.push(`diagnose:${input.planId}`);
        return { verdict: "filters", message: "**是筛选条件筛空的**。去掉筛选后有 812 行。", counts: {} };
      } });

    const state = { workflowId: "w", retry: {}, trace: [], errors: [], usage: [],
      dropped: [],
      plans: [{ role: "primary", planId: "p1", dateRange: { start: "2026-03-01", end: "2026-08-31" } },
              { role: "mom", planId: "p2", dateRange: { start: "2025-09-01", end: "2026-02-28" } }] };
    const out = await dataExecutor(state);
    assert.deepEqual(seen, ["diagnose:p1"], "只诊断主查询,别把对比查询也各查三遍:" + JSON.stringify(seen));
    assert.ok((out.dropped ?? []).some((d) => d.includes("是筛选条件筛空的")),
      "查不到数的原因要摆到界面上:" + JSON.stringify(out.dropped));

    /* 口径跑不起来时,数据库的**原话**必须摆出来。
       「查询直接报错」等于没说:是列名不对、JOIN 写错还是没权限?那一行字能结束整轮排查。 */
    resetTools();
    registerTool({ name: "execute_query_plan", description: "", readOnly: true,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: () => ({ planId: "p", rowCount: 0, truncated: false, columns: [], sampleRows: [] }) });
    registerTool({ name: "diagnose_empty_result", description: "", readOnly: true,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: () => ({ verdict: "metric", message: "**指标的 SQL 跑不起来**。数据库说:「Unknown column 'b.deposit_amt'」", counts: {} }) });
    const broken = await dataExecutor(state);
    assert.ok((broken.dropped ?? []).some((d) => d.includes("Unknown column")),
      "数据库的原话必须摆出来 —— 「查询直接报错」等于没说:" + JSON.stringify(broken.dropped));

    // 反向对照:有数据时一次诊断都不该跑(那是三条额外查询,白花时间)
    seen.length = 0;
    resetTools();
    registerTool({ name: "execute_query_plan", description: "", readOnly: true,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: () => ({ planId: "p", rowCount: 42, truncated: false, columns: [], sampleRows: [] }) });
    registerTool({ name: "diagnose_empty_result", description: "", readOnly: true,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: () => { seen.push("diagnose"); return { verdict: "not-empty", message: "" }; } });
    const fine = await dataExecutor(state);
    assert.deepEqual(seen, [], "有数据就别做诊断");
    assert.equal(fine.dropped, undefined, "没问题时不要往「没能满足」里塞东西");
    resetTools();
  }

  // ── 维表直查:从编译好的 SQL 里拆出「这个维度住在哪张表」 ────────
  // 八轮没修对的根子:拿完整指标 SQL(事实表 join 维表、扫半年、再 GROUP BY)
  // 去问「大区有哪些取值」,45 秒跑不完 → 探测超时 → 「华东」补不成「华东大区」
  // → in('华东') 一行都匹配不到 → 0 行。
  {
    const sql =
      "SELECT d.outlet_region AS war_zone, COUNT(DISTINCT b.user_id) AS v " +
      "FROM shop_dws.dws_user_outlet_behavior_day b " +
      "JOIN shop_dim.dim_outlet_mapping sm ON sm.qm_id=b.behavior_outlet_id " +
      "JOIN shop_ads.ads_outlet_dim d ON sm.store_id=d.outlet_uuid " +
      "WHERE b.stat_date BETWEEN '2026-03-01' AND '2026-08-31' GROUP BY d.outlet_region";
    const aliases = tableAliases(sql);
    assert.equal(aliases.b, "shop_dws.dws_user_outlet_behavior_day");
    assert.equal(aliases.sm, "shop_dim.dim_outlet_mapping");
    assert.equal(aliases.d, "shop_ads.ads_outlet_dim", "war_zone 住在这张小维表上,不在事实表上");
    assert.equal(selectExpressionFor(sql, "war_zone"), "d.outlet_region");

    /* 不写别名的表:`FROM x WHERE ...` 里正则会把 WHERE 捕成别名。
       上面那条 SQL 每个 JOIN 后面都跟着真别名,**根本走不到这个分支** ——
       测试数据够不着的代码,改坏了也没人知道。 */
    const noAlias = tableAliases("SELECT a FROM shop_ads.ads_outlet_dim WHERE x=1 GROUP BY a");
    assert.equal(noAlias.WHERE, undefined, "WHERE 不是别名:" + JSON.stringify(noAlias));
    assert.equal(noAlias.where, undefined);
    const joinNoAlias = tableAliases("FROM a.b x JOIN c.d ON x.i=1");
    assert.equal(joinNoAlias.ON, undefined, "ON 不是别名:" + JSON.stringify(joinNoAlias));
    // 反向对照:找不到的字段要返回 null,不能瞎给一个表达式
    assert.equal(selectExpressionFor(sql, "supervisor"), null,
      "SQL 里没有这个字段就得说没有 —— 瞎拆出来的表达式会查出一份错的取值清单");
    // 带函数的表达式不认(时间维度本来也不需要探)
    assert.equal(selectExpressionFor("SELECT DATE(b.stat_date) AS day FROM t b", "day"), null);
    // AS 写法也要认
    assert.equal(tableAliases("FROM shop_ads.ads_outlet_dim AS d JOIN x y").d, "shop_ads.ads_outlet_dim");
    /* 维度名**就是列名**时,编译器不写别名:`SELECT outlet_region, COUNT(...) FROM ...`。
       这个探测函数当初是照着旧目录写的(维度一律是 `d.outlet_region`),正则要求带点又带 AS,
       于是裸列名一个都匹配不上 —— 探测一路 return null,任何带筛选值的问题都得到
       「无法核对到真实取值」。不是偶尔失败,是这一整类从来就没成功过。 */
    const bare = "SELECT outlet_region, COUNT(DISTINCT a.stat_date) AS business_days " +
      "FROM shop_ads.ads_outlet_daily a JOIN shop_ads.ads_outlet_dim d ON a.store_id = d.outlet_uuid " +
      "WHERE stat_date >= '2026-09-14' GROUP BY outlet_region";
    assert.equal(selectExpressionFor(bare, "outlet_region"), "outlet_region", "裸列名也要认出来");
    assert.equal(fromClause(bare), "shop_ads.ads_outlet_daily a JOIN shop_ads.ads_outlet_dim d ON a.store_id = d.outlet_uuid",
      "裸列名没法静态判断属于哪张表,只能拿整个 FROM 去查 —— 猜错表会查出一份别的表的清单,那比查不到更糟");

    // 只在 SELECT 列表里找:WHERE / GROUP BY 里的同名词不算"选出来的列"
    assert.equal(selectExpressionFor("SELECT a.x AS x FROM t WHERE outlet_region = '1'", "outlet_region"), null,
      "WHERE 里出现过不等于它被选了出来");
    assert.equal(selectExpressionFor("SELECT a.x FROM t GROUP BY outlet_region", "outlet_region"), null);
    // 带别名的仍然走原来的快路(只扫那一张维表)
    assert.equal(selectExpressionFor("SELECT d.outlet_region AS war_zone FROM x d", "war_zone"), "d.outlet_region");
    // 前缀相同的列名不能误命中
    assert.equal(selectExpressionFor("SELECT outlet_region_name FROM t", "outlet_region"), null,
      "outlet_region_name 不是 outlet_region");

    /* 上面几条只验了两个解析函数,没验探测**真的用了**它们 —— 把实现改成
       "裸列名时随便挑 FROM 里第一张表",那几条照样全绿。测试够不着的代码,改坏了没人知道。
       所以这里直接看它最后发出去的那条 SQL。 */
    {
      const metric = {
        id: "business_days", name: "有效天数", enabled: true, connId: "c", type: "measure",
        dimensions: ["outlet_region"], timeField: "stat_date", unit: "天", aliases: [], caliber: "", category: "营业",
        source: "shop_ads.ads_outlet_daily a JOIN shop_ads.ads_outlet_dim d ON a.store_id = d.outlet_uuid",
        expression: "COUNT(DISTINCT a.stat_date)",
      };
      const dataset = { id: "d", name: "x", sourceType: "sql", connectionId: "c", database: "", sql: "", fields: [],
        metricIds: ["business_days"], metricScope: { start: "2026-09-14", end: "2026-09-20" } };
      let sent = null;
      const values = await fastDimensionValues(dataset, "outlet_region", 301, "华东大区", [metric], {
        dialectFor: () => "mysql",
        readQuery: async (_id, _db, sql) => { sent = sql; return { columns: [{ name: "outlet_region" }], rows: [["华东大区"]] }; },
      });
      assert.deepEqual(values, ["华东大区"], "探测要真能把「华东大区」查回来");
      assert.ok(/FROM shop_ads\.ads_outlet_daily a JOIN shop_ads\.ads_outlet_dim d ON/.test(sent),
        "裸列名要拿**整个 FROM**去查,不许只挑一张表 —— 猜错表会查出一份别的表的清单:" + sent);
      assert.ok(!/stat_date >=|BETWEEN/.test(sent),
        "取值探测不带日期范围 —— 大区有哪些跟这一周有没有生意是两件事:" + sent);
    }

  }

  // ── 取数超时要给能动手的建议 ─────────────────────────────────
  // 真机:「[DataExecutor] 取数失败(primary):Dashboard query timed out after 30 seconds.」
  // 甩一句 timed out 出来,用户只能干瞪眼。超时和"写错了"不是一回事:
  // 前者是这条查询太重,能靠少要指标/缩短区间/去掉高基数维度自己解决。
  {
    resetTools();
    registerTool({ name: "execute_query_plan", description: "", readOnly: true,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: () => { throw new Error("Dashboard query timed out after 180 seconds."); } });
    const state = { workflowId: "w", retry: {}, trace: [], errors: [], usage: [], dropped: [],
      validatedMetrics: Array.from({ length: 8 }, (_, i) => ({ metricId: `m${i}`, name: `指标${i}`, unit: "元",
        caliber: "", rollup: "sum", supportedDimensions: ["month"], dateScoped: true, sourceTables: ["t"] })),
      scope: { label: "2026-03-01 至 2026-08-31", dateRange: { start: "2026-03-01", end: "2026-08-31" }, comparisonRanges: [], filters: [] },
      plans: [{ role: "primary", planId: "p1", dateRange: { start: "2026-03-01", end: "2026-08-31" } }] };
    await assert.rejects(() => dataExecutor(state), (e) => {
      assert.ok(/太重/.test(e.message), "要说清是太重了,不是写错了:" + e.message);
      assert.ok(/8 个指标/.test(e.message), "要点出是几个指标一起查:" + e.message);
      assert.ok(/2026-03-01 至 2026-08-31/.test(e.message), "要点出时间范围:" + e.message);
      assert.ok(/缩短/.test(e.message), "要给能动手的建议:" + e.message);
      return true;
    });

    // 反向对照:不是超时的失败别硬套这套说辞
    resetTools();
    registerTool({ name: "execute_query_plan", description: "", readOnly: true,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: () => { throw new Error("Unknown column 'b.deposit_amt' in 'field list'"); } });
    await assert.rejects(() => dataExecutor(state), (e) => {
      assert.ok(!/太重/.test(e.message), "列名写错不是「太重」,别给错的建议:" + e.message);
      assert.ok(/Unknown column/.test(e.message), "数据库原话要留着:" + e.message);
      return true;
    });
    resetTools();
  }

  // ── 8 个组件一起开火,别把连接池抽干 ──────────────────────────
  // 真机:AI 建了个 8 组件的看板,一打开 8 条查询同时发。连接池 max=5,
  // 5 条抢到连接(各自超时),剩下 3 条报「pool timed out while waiting for
  // an open connection」—— 一个看着像数据库坏了、其实是我们自己挤死自己的错。
  {
    let inFlight = 0;
    let peak = 0;
    const calls = [];
    const realInvoke = globalThis.__TAURI_INTERNALS__;
    // executeDataset 最终走 api.runReadOnlyQuery;非 Tauri 环境下它走 mock,
    // 这里直接替掉 mock 的底层实现来数并发。
    const { api } = createRequire(import.meta.url)(output);
    const original = api.runReadOnlyQuery;
    api.runReadOnlyQuery = async (...args) => {
      inFlight++; peak = Math.max(peak, inFlight);
      calls.push(args[2]);
      await new Promise((r) => setTimeout(r, 25));
      inFlight--;
      return { columns: [{ name: "v" }], rows: [[1]], truncated: false };
    };
    const ds = (i) => ({ id: `d${i}`, name: "x", sourceType: "sql", connectionId: "c", sql: `SELECT ${i}`, fields: [] });
    await Promise.all(Array.from({ length: 8 }, (_, i) => executeDataset(ds(i), (k) => k, 100)));
    assert.equal(calls.length, 8, "八条都要跑到,不能被挡掉");
    assert.ok(peak <= 3, `同时在跑的最多 3 条,实测峰值 ${peak} —— 再多就会把 max=5 的连接池抽干`);
    assert.ok(peak > 1, `也别退化成一条条排队(那样 8 个组件要等 8 倍),实测峰值 ${peak}`);
    api.runReadOnlyQuery = original;
    void realInvoke;
  }

  // ── 同一条查询只跑一次 + 结果缓存 ───────────────────────────
  // 真机:打开一个 8 组件看板要跑 8 条重查询;切一下筛选器再 8 条;开了同环比再翻倍;
  // 而这之前 AI 刚把同样的数查过一遍。同一份数据来回查十几次,每次几十秒 —— 就是「慢」。
  {
    const { api } = createRequire(import.meta.url)(output);
    const original = api.runReadOnlyQuery;
    let hits = 0;
    api.runReadOnlyQuery = async () => {
      hits++;
      await new Promise((r) => setTimeout(r, 20));
      return { columns: [{ name: "v" }], rows: [[1]], truncated: false };
    };
    clearQueryCache();
    const ds = { id: "d1", name: "x", sourceType: "sql", connectionId: "c", sql: "SELECT 1", fields: [] };

    // 同时来 5 个一模一样的请求 → 只该发一次(看板打开时就是这种情形)
    await Promise.all(Array.from({ length: 5 }, () => executeDataset(ds, (k) => k, 100)));
    assert.equal(hits, 1, `在飞的同一条查询要合并,实测发了 ${hits} 次`);

    // 跑完之后再要,走缓存
    await executeDataset(ds, (k) => k, 100);
    assert.equal(hits, 1, "跑完的结果要缓存,不该再发请求");

    // 换个参数就是另一条查询,不能串味
    await executeDataset({ ...ds, sql: "SELECT 2" }, (k) => k, 100);
    assert.equal(hits, 2, "不同 SQL 必须各查各的");
    await executeDataset(ds, (k) => k, 200);
    assert.equal(hits, 3, "行数上限不同也是另一条查询");

    // 点「刷新」= 明确要最新的数,缓存必须让路
    clearQueryCache();
    await executeDataset(ds, (k) => k, 100);
    assert.equal(hits, 4, "清了缓存就得真去查 —— 否则点刷新等于没点");

    // 失败不缓存:一次超时不该让接下来五分钟全是同一个错
    clearQueryCache();
    api.runReadOnlyQuery = async () => { hits++; throw new Error("timed out"); };
    await assert.rejects(() => executeDataset(ds, (k) => k, 100));
    await assert.rejects(() => executeDataset(ds, (k) => k, 100));
    assert.equal(hits, 6, "两次失败要真的发两次请求");
    api.runReadOnlyQuery = original;
    clearQueryCache();
  }

  // ── 模型的设计要真的落到看板上 ────────────────────────────────
  // 用户说「版式主题感觉没变化,始终都是这一套,像被你框死了」。
  // 我两轮里宣称过两次「放开了排版和配色」,却**从没验证过那些字段真的传下去了**。
  // 松开 Reviewer 只是拿掉一个覆盖源,不等于设计就到得了文档。
  {
    const seen = { add: [], style: [], move: [] };
    resetTools();
    registerTool({ name: "create_dashboard", description: "", readOnly: false,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: () => ({ dashboardId: "dash1" }) });
    registerTool({ name: "add_component", description: "", readOnly: false,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: (i) => { seen.add.push(i); return { widgetId: `w${seen.add.length}` }; } });
    registerTool({ name: "move_component", description: "", readOnly: false,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: (i) => { seen.move.push(i); return {}; } });
    registerTool({ name: "style_component", description: "", readOnly: false,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: (i) => { seen.style.push(i); return {}; } });
    for (const n of ["set_dashboard_scope", "set_dashboard_provenance", "save_dashboard"]) {
      registerTool({ name: n, description: "", readOnly: false,
        schema: { type: "object", properties: {}, additionalProperties: true }, run: () => ({ dashboardId: "dash1" }) });
    }

    const state = {
      workflowId: "w", retry: {}, trace: [], errors: [], usage: [], dropped: [],
      scope: { label: "近3月", dateRange: { start: "2026-06-01", end: "2026-08-31" }, comparisonRanges: [] },
      validatedMetrics: [{ metricId: "m1", name: "会员消费额", unit: "元", caliber: "", rollup: "sum",
        supportedDimensions: ["month", "war_zone"], dateScoped: true, sourceTables: ["t"] }],
      layout: {
        title: "会员经营", description: "", theme: "结论先行",
        preset: "violet", palette: ["#5B8FF9", "#5AD8A6"],
        items: [
          { band: "kpi", type: "text", title: "分区", content: "一、总体判断", metricIds: [], dimensions: [],
            width: "full", reason: "r", x: 0, y: 0, w: 12, h: 1,
            appearance: { hideTitle: true, titleAlign: "center" }, text: { fontSize: 18, align: "center" } },
          { band: "trend", type: "line", title: "趋势", metricIds: ["m1"], dimensions: ["month"],
            width: "half", reason: "r", x: 0, y: 1, w: 8, h: 5,
            appearance: { visualPreset: "aurora", radius: 12 },
            chart: { lineArea: true, barOrientation: "vertical" }, footnote: "数据截至昨日" },
        ],
      },
    };
    await dashboardExecutor(state);

    // 文字块的正文要传下去,否则页面上就是个空卡
    const textAdd = seen.add.find((a) => a.type === "text");
    assert.equal(textAdd.content, "一、总体判断", "text 块的正文没传:" + JSON.stringify(textAdd));

    // 模型自己排的坐标要原样落地,不能被兜底排版顶掉
    const lineMove = seen.move[1];
    assert.deepEqual({ x: lineMove.x, y: lineMove.y, w: lineMove.w, h: lineMove.h }, { x: 0, y: 1, w: 8, h: 5 },
      "模型排的位置要原样落地:" + JSON.stringify(lineMove));

    // 外观/图表细节/脚注:这三样是「版式主题」的全部,丢一样看板就长得一样
    // 整板预设要铺到**每一张**卡上 —— 模型只挑一次基调,不必逐卡配色。
    // 「版式主题始终是那一套」的真实原因不是被框死,是 appearance 是可选字段,
    // prompt 一长模型就省了,于是每张卡都是默认样式。
    assert.ok(seen.style.every((x) => x.appearance?.visualPreset),
      "每张卡都该带上整板预设:" + JSON.stringify(seen.style.map((x) => x.appearance)));
    const lineStyle = seen.style.find((x) => x.appearance?.visualPreset === "aurora");
    assert.ok(lineStyle, "外观预设没传下去 —— 这就是「每块看板长得一样」的原因:" + JSON.stringify(seen.style));
    assert.equal(lineStyle.appearance.visualPreset, "aurora", "单卡自己给的预设要盖过整板的");
    const textStylePreset = seen.style.find((x) => x.text);
    assert.equal(textStylePreset.appearance.visualPreset, "violet", "没自己指定的卡,用整板基调");
    assert.equal(lineStyle.appearance.radius, 12);
    assert.equal(lineStyle.footnote, "数据截至昨日");
    assert.equal(lineStyle.chart.lineArea, true);
    // 整板配色要兜底进每张图
    assert.deepEqual(lineStyle.chart.palette, ["#5B8FF9", "#5AD8A6"], "整板 palette 要落到图上");
    // 文本块的排版
    const textStyle = seen.style.find((x) => x.text);
    assert.equal(textStyle.text.fontSize, 18);
    assert.equal(textStyle.appearance.hideTitle, true);
  }

  // ── 参数锁死模式:人给的参数,一个字都不许改 ──────────────────
  // 十几轮失败里一多半出在「把人话变成参数」:日期解析成 6 天、两个大区被粘成
  // 一个不存在的取值、时间维度被漏掉。这类错**判错了下游看不出来**。
  // 所以分工换一下:数据是什么人说了算,数据说明什么模型说了算。
  {
    const sent = [];
    resetTools();
    registerTool({ name: "build_query_plan", description: "", readOnly: true,
      schema: { type: "object", properties: {}, additionalProperties: true },
      run: (i) => { sent.push(i); return { planId: `p${sent.length}` }; } });

    const params = {
      metricIds: ["m1", "m2"],
      dimensions: ["month", "war_zone", "store"],
      dateRange: { start: "2026-06-01", end: "2026-08-31" },
      comparisons: ["mom"],
      filters: [{ field: "war_zone", values: ["华东大区", "华北大区"] }],
      focus: "重点看预存转化",
      wantsDashboard: true,
    };
    const out = await lockedPlanner({ workflowId: "w", lockedParams: params, retry: {}, trace: [], errors: [], usage: [] });

    assert.equal(sent.length, 2, "主查询 + 一个环比");
    const primary = sent[0];
    assert.deepEqual(primary.dimensions, ["month", "war_zone", "store"],
      "维度是人选的,**一个都不许砍** —— 自然语言那条路上 trimDimensions 会替他做主:" + JSON.stringify(primary.dimensions));
    assert.deepEqual(primary.filters, [{ field: "war_zone", values: ["华东大区", "华北大区"] }],
      "取值是他从真实清单里点的,不该再去库里核一遍");
    assert.deepEqual(primary.dateRange, { start: "2026-06-01", end: "2026-08-31" }, "区间照搬");
    assert.equal(primary.grain, "month", "粒度取维度里的那个时间维度");
    assert.deepEqual(sent[1].dateRange, { start: "2026-03-01", end: "2026-05-31" }, "环比区间要是前三个整月:" + JSON.stringify(sent[1].dateRange));
    assert.deepEqual(out.plans.map((p) => p.role), ["primary", "mom"]);

    // 锁死模式下体检失败**不回头重规划** —— 维度和区间是用户选的,轮不到程序改
    const g = buildLockedGraph();
    const routes = g.validate();
    assert.deepEqual(routes, [], "图配置要合法:" + JSON.stringify(routes));
    resetTools();
  }

  // ── zustand 选择器必须返回稳定引用 ──────────────────────────
  // 真机:进「分析」直接黑屏。原因是 `useMetrics((s) => s.metrics.filter(...))` ——
  // 每次调用都产生一个新数组,zustand 比较出"变了"就重渲染,重渲染又产生新数组,
  // 无限循环,React 把整棵树卸掉。tsc 和构建都看不出来,只有跑起来才炸。
  // 这里用源码级检查兜住这一类:组件里不许在选择器里现做数组。
  {
    const fs = await import("node:fs");
    const bad = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(e.name)) {
          const text = fs.readFileSync(full, "utf8");
          // use<Store>((s) => s.<字段>.filter/map/slice/sort/concat(...)
          const re = /use[A-Z]\w*\(\s*\(\w+\)\s*=>\s*\w+\.\w+\.(filter|map|slice|sort|concat|flatMap)\s*\(/g;
          /* 选择器直接返回新对象/新数组**字面量**。
             注意只认 `=> ({` 和 `=> [` —— `=> {` 是函数体,不是对象字面量,
             useDrag((d) => { … }) 这种回调会被误伤。 */
          const re2 = /use[A-Z]\w*\(\s*\(\w+\)\s*=>\s*(\(\s*\{|\[)/g;
          for (const m of [...text.matchAll(re), ...text.matchAll(re2)]) {
            bad.push(`${full.replace("src/", "")}: ${m[0]}`);
          }
        }
      }
    };
    walk("src");
    assert.deepEqual(bad, [],
      "选择器里现做数组/对象 = 每次都是新引用 = 无限重渲染 = 黑屏。过滤搬到 useMemo 里:\n" + bad.join("\n"));
  }

  // ── 「分析」的表单要活过切 tab ────────────────────────────────
  // 真机:选好指标维度日期,切去看一眼表再切回来,全没了 —— 一张白纸。
  // 根因是状态放在组件的 useState 里,而 QueryPanel 只渲染当前 tab,
  // 切走组件就被卸载。跑到一半切走更糟:查询还在跑,setState 已经没人接。
  {
    const store = useAnalysis.getState();
    store.reset();
    store.patch({ metricIds: ["m1", "m2"], dimensions: ["war_zone"], grain: "week", focus: "重点看预存" });
    store.patch({ filterValues: { war_zone: ["华东大区"] } });

    // 组件卸载重挂 = 重新从 store 读;这里直接验落盘的那份
    const saved = JSON.parse(localStorage.getItem("sonde.analysis.v1"));
    assert.deepEqual(saved.metricIds, ["m1", "m2"], "指标要留住 —— 选指标是有成本的,不该因为看一眼别的表就重来");
    assert.equal(saved.grain, "week");
    assert.equal(saved.focus, "重点看预存");
    assert.deepEqual(saved.filterValues, { war_zone: ["华东大区"] }, "筛选取值也要留");
    // patch 是合并不是覆盖 —— 改一个字段不能把别的清掉
    assert.deepEqual(saved.dimensions, ["war_zone"], "第二次 patch 不能把第一次的维度冲掉");

    // 运行状态放内存(带样例行,存盘既大又没必要),但要能跨卸载读到
    useAnalysis.setState({ run: { status: "done", trace: ["DataExecutor"], errors: [] } });
    assert.equal(useAnalysis.getState().run.status, "done", "跑到一半切走再回来,进度要接得上");
    // 结果不该落盘
    const saved2 = JSON.parse(localStorage.getItem("sonde.analysis.v1"));
    assert.equal(saved2.run, undefined, "运行结果别写进 localStorage");

    store.reset();
    assert.deepEqual(JSON.parse(localStorage.getItem("sonde.analysis.v1")), { modelChoiceMigration: 1 });
  }

  // 带表别名前缀的维度:读进来必须剥成裸名,且派生指标带分组要能拼出可用的 SQL。
  // 真机上这两条各自炸过一次(Unknown column 'd.outlet_region' / 出货率一分组就没维度列)。
  {
    metricsStore.getState().importMetrics([{
      id: "m1", name: "销售额", key: "total_gmv", type: "measure", connId: "c1", enabled: true,
      source: "fact a JOIN dim d ON a.store_id = d.uuid", expression: "SUM(a.gmv)",
      dimensions: ["d.outlet_region", "a.stat_date", "outlet_region"],
      dimensionLabels: { "d.outlet_region": "大区", "a.stat_date": "日期", "已删掉的": "x" },
    }], "replace");
    const gmv = metricsStore.getState().metrics.find((m) => m.id === "m1");
    assert.deepEqual(gmv.dimensions, ["outlet_region", "stat_date"], "维度要剥成裸名并去重");
    assert.deepEqual(gmv.dimensionLabels, { outlet_region: "大区", stat_date: "日期" }, "标签跟着裸名走");

    const num = { ...gmv, id: "m2", name: "出货额", key: "out_amt", source: "supply a JOIN dim d ON a.store_id = d.uuid", expression: "SUM(a.out_amt)" };
    const derived = {
      ...gmv, id: "m3", name: "出货率", key: "shipment_rate", type: "derived", scale: 100,
      numeratorMetricId: "m2", denominatorMetricId: "m1",
    };
    const ds = { id: "d1", metricIds: ["m1", "m3"], groupBy: ["outlet_region"], connectionId: "c1",
      metricScope: { start: "2026-08-01", end: "2026-08-31" } };
    const sql = compileSemanticDataset(ds, [gmv, num, derived], [], "mysql").sql;
    assert(!/\bd\.outlet_region\b/.test(sql), "外层不能再出现带前缀的维度");
    assert(/MAX\(out_amt\)\/NULLIF\(MAX\(total_gmv\),0\)\*100 AS shipment_rate/.test(sql),
      "派生指标要拆成分子/分母再在外层相除");
    assert(!/NULL AS shipment_rate/.test(sql), "派生指标不该再占一个空单元");
    // 拆不开的派生指标 + 分组:要当场报清楚,而不是拼出一条注定 Unknown column 的 SQL
    const opaque = { ...derived, id: "m4", key: "bad", numeratorMetricId: "nope" };
    assert.throws(() => compileSemanticDataset({ ...ds, metricIds: ["m4"] }, [gmv, num, derived, opaque], [], "mysql"),
      /不支持按维度拆分/);
  }

  console.log("Integration checks passed: AI thinking mode payloads, multi-column data sorting, nearest duplicate placement, semantic table dimensions, V1 binding limits, component-local filter persistence/intersection, central references, KPI grain, filters, invalid metrics, path mapping, ambiguous paths and multiple DataX readers, column-level metric relevance, entity 360 AI prompt, dashboard service edits, dimension value matching, new widget fields survive normalize, number scaling, agent json-schema/tools/metric validation, data quality checks, period resolution, graph runtime, agent panel steps, real-run regressions, degenerate time dimension, non-additive metric rollup, metric menu grounding, clarification round-trip, role routing, dashboard layout and review, ai provenance, truncation and dimension trimming, value-aware number scaling, unmet-requirement reporting, reviewer judgement whitelist, cardinality-based dimension budget, ratio-plan rollup, lineage node removal, import summary honesty, metric health check, active-step attribution, free-form layout, tool debug console, query-planner probing, dashboard workspace extraction, last-n-months period, empty-result diagnosis, dimension-table probe, query-timeout advice, dataset query concurrency gate, mandatory time dimension, query cache and coalescing, design reaches the document, locked-parameter analysis, stable store selectors, analysis draft persistence, qualified dimension normalization, derived metric grouping.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
