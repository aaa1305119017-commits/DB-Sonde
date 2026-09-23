import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

/**
 * 「问一句话 → 查得出数」这条路,用**和真实目录一模一样形状**的指标走一遍。
 *
 * 存在的理由是一次真机故障:取值探测的正则要求 `别名.列 AS 字段`,而真实指标编译出来
 * 是裸列名 `SELECT outlet_region, ...` —— 于是凡是带筛选值的问题**一次都没成功过**,
 * 而所有单元测试全绿。因为那些测试里的 SQL 是我手打的字符串,当然匹配得上;
 * 真实 SQL 从来匹配不上。测试数据够不着真实形状,就等于没测。
 *
 * 所以这里定死两条:
 *  1. **SQL 一律由真编译器生成**,测试里不许出现手写的 SELECT;
 *  2. 指标夹具照抄真实目录的形状 —— type:"measure"、source 是带 JOIN 的 FROM 子句、
 *     维度是**裸列名**(outlet_region 这种),不是 `d.outlet_region` 那种旧写法。
 *
 * 不连库、不调模型:数据库换成只记录 SQL 的假实现,模型返回写死的计划。
 * 所以它拦不住"库里列不存在""查询超时""模型答得好不好" —— 那些要真机。
 * 它拦的是**形状对不上**:解析、筛选值核对、连接选择、维度处理。
 * 今天六轮真机故障里有三轮属于这一类。
 */

const dir = mkdtempSync(join(tmpdir(), 'sonde-analysis-e2e-'));
const response = data => ({ ok: true, data, ms: 1, promptTokens: 2, completionTokens: 3 });

try {
  const outfile = join(dir, 'tests.cjs');
  buildSync({
    stdin: {
      contents: [
        `export * from './src/features/agent/questionPlanning';`,
        `export * from './src/features/agent/queryPlanModel';`,
        `export * from './src/features/agent/analysisCatalog';`,
        `export { fastDimensionValues } from './src/features/agent/tools/dimensionProbe';`,
        `export { compileSemanticDataset } from './src/features/dashboard/semantic';`,
      ].join('\n'),
      resolveDir: resolve('.'), loader: 'ts',
    },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  const m = createRequire(import.meta.url)(outfile);

  /* ── 指标夹具:照抄真实目录的形状 ──────────────────────────────
     关键在三处,错一处这个测试就失去意义:
       type:"measure"(不是带 queryPlan 的旧结构)
       source 是一整段带 JOIN 的 FROM 子句
       dimensions 是**裸列名** —— 真实目录就是这么写的 */
  const shaped = (id, name, expression) => ({
    id, key: id, name, enabled: true, type: 'measure', connId: 'app', connName: '应用库',
    catalogId: 'demo-v1', category: '营业', unit: '元', decimals: 2, aliases: [name], caliber: `${name}口径`,
    timeField: 'stat_date',
    dimensions: ['stat_date', 'outlet_region', 'outlet_manager', 'outlet_name'],
    dimensionLabels: { stat_date: '日期', outlet_region: '大区', outlet_manager: '主管', outlet_name: '网点' },
    source: 'shop_ads.ads_outlet_daily a JOIN shop_ads.ads_outlet_dim d ON a.store_id = d.outlet_uuid',
    expression, numerator: '', denominator: '', sql: '',
  });
  const catalog = [
    shaped('offline_gmv', '线下销售额', 'SUM(a.offline_gmv_amt)'),
    shaped('online_gmv', '线上销售额', 'SUM(a.online_gmv_amt)'),
    // 另一个连接上的指标:不该被选中,也不该混进菜单
    { ...shaped('other', '别的库的指标', 'SUM(a.x)'), connId: 'warehouse', connName: '原始库' },
  ];

  // ── 1. 编译器产出的就是裸列名。这条一旦不成立,底下所有断言都失去意义 ──
  const dataset = {
    id: 'd', name: 'probe', sourceType: 'sql', connectionId: 'app', database: '', sql: '', fields: [],
    metricIds: ['offline_gmv'], metricScope: { start: '2026-09-15', end: '2026-09-21' },
  };
  const compiled = m.compileSemanticDataset({ ...dataset, groupBy: ['outlet_region'] }, catalog, [], 'mysql').sql;
  assert.ok(/SELECT\s+outlet_region\s*,/i.test(compiled),
    '真实形状编译出来就是裸列名 —— 这个前提不成立的话,这整个测试就又变成"测我想象中的数据"了：' + compiled);

  // ── 2. 取值探测:能从这条 SQL 里认出维度、并查到真实取值 ──
  let probeSql = null;
  const values = await m.fastDimensionValues(dataset, 'outlet_region', 301, '华东大区', catalog, {
    dialectFor: () => 'mysql',
    readQuery: async (_id, _db, sql) => { probeSql = sql; return { columns: [{ name: 'outlet_region' }], rows: [['华东大区']] }; },
  });
  assert.deepEqual(values, ['华东大区'], '裸列名维度必须探得到取值 —— 探不到的话任何带筛选的问题都会挂');
  assert.ok(/FROM shop_ads\.ads_outlet_daily a JOIN shop_ads\.ads_outlet_dim d ON/.test(probeSql),
    '拿不准列属于哪张表就用整个 FROM,不许猜一张：' + probeSql);
  assert.ok(!/stat_date|BETWEEN/.test(probeSql), '取值不随日期变,探测不该带日期范围：' + probeSql);

  // ── 3. 整条规划路径:一句话 → 可执行的查询计划 ──
  const plan = {
    metricIds: ['offline_gmv', 'online_gmv'], dimensions: ['stat_date', 'outlet_region'],
    period: { kind: 'explicit', start: '2026-09-15', end: '2026-09-21', count: 1 },
    comparisons: ['mom'], filters: [{ field: 'outlet_region', values: ['华东大区'] }],
    coverage: [{ area: '营业', metricIds: ['offline_gmv', 'online_gmv'], disposition: 'selected', reason: '本题主体' }],
    angle: '看华东大区上周线下线上', assumptions: [], questions: [],
  };
  const asked = [];
  const probes = [];
  const planner = m.createQuestionPlanner({
    readCatalog: () => catalog,
    callStructured: async (call) => { asked.push(call); return response(plan); },
    dimensionValues: async (ds, field, limit, search, snapshot) => {
      probes.push({ field, search });
      // 真编译器 + 真解析,只把数据库换掉
      return m.fastDimensionValues(ds, field, limit, search, snapshot, {
        dialectFor: () => 'mysql',
        readQuery: async () => ({ columns: [{ name: field }], rows: [['华东大区'], ['华北大区']] }),
      });
    },
  });

  const state = {
    workflowId: 'e2e', connId: 'app', today: '2026-09-22', status: 'running',
    userRequest: '我想分析下上周，华东大区，线下各渠道，线上各渠道的营业状况',
    usage: [], errors: [], trace: [], retry: {}, requirement: { wantsDashboard: true },
  };
  const out = await planner(state, {});

  assert.equal(out.status, undefined, '这条路应该一路走通,不该停下来问人：' + JSON.stringify(out.clarification));
  assert.ok(out.lockedParams, '要产出可执行的查询参数');
  assert.deepEqual(out.lockedParams.filters, [{ field: 'outlet_region', values: ['华东大区'] }],
    '用户说的「华东大区」要被核对成库里的真实取值并留下');
  assert.deepEqual(out.lockedParams.metricIds, ['offline_gmv', 'online_gmv']);
  assert.ok(out.scope.dateRange.start === '2026-09-15' && out.scope.dateRange.end === '2026-09-21');
  assert.deepEqual(probes.map(p => p.field), ['outlet_region'], '只探要筛的那个维度');

  // 别的连接的指标不该出现在给模型的菜单里 —— 指标编译出的 SQL 认死自己的库
  assert.ok(!asked[0].system.includes('别的库的指标'), '跨连接的指标不许混进菜单');
  assert.ok(asked[0].system.includes('线下销售额'));

  // ── 4. 产出的参数要能真的编译成查询 ──
  const prepared = m.prepareQueryPlan(out.lockedParams, catalog);
  assert.equal(prepared.dataset.connectionId, 'app');
  const finalSql = m.compileSemanticDataset(
    { ...prepared.dataset, groupBy: out.lockedParams.dimensions }, catalog, prepared.filters ?? [], 'mysql').sql;
  assert.ok(/outlet_region/.test(finalSql) && /offline_gmv_amt/.test(finalSql) && /online_gmv_amt/.test(finalSql),
    '最终 SQL 要同时带上维度和两个指标：' + finalSql);

  // ── 5. 连接:指标挂在哪个连接,就用哪个 ──
  assert.equal(m.catalogConnection(catalog, 'somewhere-else').connId, 'somewhere-else',
    '多个连接都有指标时不许替用户挑');
  assert.equal(m.catalogConnection(catalog.filter(x => x.connId === 'app'), 'somewhere-else').connId, 'app',
    '只有一个连接有指标时,那就是唯一正确答案 —— 不该因为用户在看别的库就判"没有可用指标"');

  console.log('Analysis end-to-end passed: real catalog shape, bare-column probing, filter resolution, executable plan, connection ownership. No database or model.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
