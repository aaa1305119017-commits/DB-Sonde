// 在组件编辑面板里设的东西,重开软件必须还在。
//
// 出过事的地方是 normalizeDashboard 里的 bindings:它不是把读到的东西原样带过来,
// 而是逐字段列举着重建一遍。列漏了的字段就在「存 → 读」之间被静默抹掉 —— 界面上
// 点得动、当场也生效,一重开就回到默认值,而且不报任何错。
// 时间粒度(月/日)、每个指标的汇总方式、柱状图的图例维度都这么丢过。
//
// 同一个文件里 widget 自己用的是 `...raw`(原样带过来再覆盖校验过的字段),
// bindings 却是白名单 —— 下面最后一条就是盯着这个差别。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-persist-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: {
      contents: `export { normalizeDashboard, createWidget } from './src/features/dashboard/domain';`,
      resolveDir: resolve('.'), loader: 'ts',
    },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { normalizeDashboard, createWidget } = createRequire(import.meta.url)(outfile);

  /** 存盘再读回来 —— 中间过一趟 JSON,跟真实的落盘一致。 */
  const roundTrip = (widget) =>
    normalizeDashboard(JSON.parse(JSON.stringify({ schemaVersion: 3, id: 'd', widgets: [widget] }))).widgets[0];

  const bar = {
    ...createWidget('bar', 'ds1'),
    bindings: {
      dimension: 'sale_date', dimensions: ['sale_date'],
      seriesDimension: 'region',
      measures: ['amount', 'orders'],
      aggregations: { amount: 'sum', orders: 'count_distinct' },
      grains: { sale_date: 'month' },
      metricIds: [], secondaryMetricIds: [],
    },
  };
  const savedBar = roundTrip(bar);
  assert.deepEqual(savedBar.bindings.grains, { sale_date: 'month' }, '时间粒度要留住 —— 选了「月」重开又变回原样就是这儿丢的');
  assert.deepEqual(savedBar.bindings.aggregations, { amount: 'sum', orders: 'count_distinct' }, '每个指标的汇总方式要留住');
  assert.equal(savedBar.bindings.seriesDimension, 'region', '柱状图也能设图例维度(多组柱),不能只给折线图留');

  const line = { ...bar, type: 'line' };
  assert.equal(roundTrip(line).bindings.seriesDimension, 'region', '折线图的图例维度');

  // 排序、透视布局这些放在 options.table 里,一并盯住。
  const table = {
    ...createWidget('table', 'ds1'),
    bindings: { dimension: 'region', dimensions: ['region', 'store'], measures: ['amount'], metricIds: [], secondaryMetricIds: [] },
    options: {
      ...createWidget('table', 'ds1').options,
      table: {
        dimensionSorts: { region: 'desc', store: 'group_asc' },
        metricSort: { key: 'field:amount', dir: 'desc', within: true },
        dimensionPlacements: { region: 'column' },
        dimensionCustomOrders: { region: ['华东', '华北'] },
        columnWidths: { region: 180 },
      },
    },
  };
  const savedTable = roundTrip(table).options.table;
  assert.deepEqual(savedTable.dimensionSorts, { region: 'desc', store: 'group_asc' }, '维度排序');
  assert.deepEqual(savedTable.metricSort, { key: 'field:amount', dir: 'desc', within: true }, '按指标排序');
  assert.deepEqual(savedTable.dimensionPlacements, { region: 'column' }, '透视布局:哪些维度放到列上');
  assert.deepEqual(savedTable.dimensionCustomOrders, { region: ['华东', '华北'] }, '自定义顺序');
  assert.equal(savedTable.columnWidths.region, 180, '列宽');

  // 锁定范围。
  const locked = { ...bar, options: { ...bar.options, lockedScope: { start: '2026-01-01', end: '2026-03-31', filters: { region: ['华东'] } } } };
  assert.deepEqual(roundTrip(locked).options.lockedScope,
    { start: '2026-01-01', end: '2026-03-31', filters: { region: ['华东'] } }, '锁定的数据范围');

  /* 病根不是「漏了哪个字段」,是 bindings 用白名单重建 —— 以后再加字段照样会漏,
     而且漏了不报错。这条盯着它必须原样带过来。 */
  const future = { ...bar, bindings: { ...bar.bindings, someFutureSetting: { a: 1 } } };
  assert.deepEqual(roundTrip(future).bindings.someFutureSetting, { a: 1 },
    'bindings 要原样带过来再覆盖校验过的字段,不能用白名单 —— 否则以后新加的设置还会这么丢');

  /* 看板顶层字段是逐个列举的(不像 widget 用 ...raw),漏一个就同样静默抹掉 ——
     自动刷新间隔当年就是这么丢的。这儿把 DashboardDocument 上的字段名读出来,
     逐个塞进去看能不能原样回来:以后谁加了新字段却忘了加进 normalizeDashboard,
     这条就会红,而不是等用户发现「我设的东西又没了」。 */
  const domain = readFileSync('src/features/dashboard/domain.ts', 'utf8');
  const block = domain.match(/export interface DashboardDocument \{([\s\S]*?)\n\}/);
  assert(block, '没找到 DashboardDocument 的定义');
  const fields = [...block[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);

  // 每个字段给一个能认得出来的值;新加字段没在这儿登记,下面那条断言会先红。
  const sample = {
    schemaVersion: 3, id: 'doc-1', title: '我的看板', description: '说明',
    status: 'published', revision: 7, updatedAt: '2026-01-02T03:04:05.000Z',
    metricScope: { start: '2026-01-01', end: '2026-03-31' },
    refreshInterval: 300,
    datasets: [{ id: 'w1', name: '销售', connectionId: 'c1', database: 'db', sql: 'select 1', fields: [] }],
    metrics: [{ id: 'm1', name: 'GMV', datasetId: 'ds1', field: 'amount', aggregation: 'sum' }],
    filters: [{ id: 'f1', field: 'region', kind: 'select', value: '华东' }],
    widgets: [bar],
    aiProvenance: { model: 'x', createdAt: '2026-01-01' },
  };
  const unregistered = fields.filter((f) => !(f in sample));
  assert.deepEqual(unregistered, [],
    `DashboardDocument 新增了字段但这个测试没登记:${unregistered.join(', ')} —— 登记后再确认 normalizeDashboard 也带上了它`);

  const savedDoc = normalizeDashboard(JSON.parse(JSON.stringify(sample)));
  for (const field of fields) {
    assert.notEqual(savedDoc[field], undefined, `「${field}」在存取之间被抹掉了 —— normalizeDashboard 里没带上它`);
  }
  assert.equal(savedDoc.refreshInterval, 300, '自动刷新间隔');
  assert.equal(savedDoc.revision, 7, '版本号');
  assert.equal(savedDoc.status, 'published', '发布状态');

  console.log(`widget persistence: 15 assertions passed (看板顶层 ${fields.length} 个字段逐个验过)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
