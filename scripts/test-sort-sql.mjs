// 组件上设的排序必须编进 SQL,不能只在前端排。
//
// 取数是有行数上限的,后端按 ORDER BY 截前 N 行。只在前端排的话,排的是「截回来的
// 那一段」—— 日粒度下几十万行截到五万,再按 GMV 降序,看到的是那五万行里的最大值,
// 日期还从中间某天开始。用户原话:「我选的是2026年 但是排序完他从2026-4月几号开始」。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-sortsql-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: { contents: `export { resolveWidgetDatasets } from './src/features/dashboard/resolveDatasets';`,
      resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { resolveWidgetDatasets } = createRequire(import.meta.url)(outfile);

  const dataset = {
    schemaVersion: 1, id: 'ds1', name: '销售', connectionId: 'c1', database: 'db',
    source: { kind: 'join', base: { table: 'ads', alias: 't1' }, joins: [], columns: [] },
    fields: [
      { name: 'stat_date', column: 'stat_date', from: 't1', role: 'dimension', type: 'DATE' },
      { name: 'region', column: 'region', from: 't1', role: 'dimension' },
      { name: 'store', column: 'store', from: 't1', role: 'dimension' },
      { name: 'amount', column: 'amount', from: 't1', role: 'measure' },
    ], updatedAt: '',
  };
  const scope = { start: '2026-01-01', end: '2026-12-31' };
  const make = (type, dims, table = {}, grains = {}) => ({
    id: 'w1', type, title: 't', datasetId: 'ds1', x: 0, y: 0, w: 6, h: 4, visible: true, tabs: [],
    bindings: { dimension: dims[0], dimensions: dims, grains, measures: ['amount'],
                aggregations: { amount: 'sum' }, metricIds: [], secondaryMetricIds: [] },
    options: { decimals: 2, showLegend: true, smooth: true, topN: 0, metrics: {}, table },
  });
  const sqlOf = (w) => resolveWidgetDatasets([w], [dataset], () => 'mysql', scope)[0].sql;
  const orderOf = (sql) => (sql.split('\n').find((l) => l.startsWith('ORDER BY')) ?? '');

  // 没设排序:按维度升序(时间轴天然就是时间先后)
  assert.equal(orderOf(sqlOf(make('table', ['region', 'store']))), 'ORDER BY `region`, `store`',
    '没设排序就按维度升序');

  // 指标降序要进 SQL —— 少了它,后端截的就是「按维度排的前 N 行」,排出来的名次是假的
  const byMetric = orderOf(sqlOf(make('table', ['region', 'store'], { metricSort: { key: 'field:amount', dir: 'desc' } })));
  assert(/^ORDER BY `amount` DESC/.test(byMetric), `指标排序要编进 SQL: ${byMetric}`);
  // 维度补在后面当并列时的次序,否则翻页和取前 N 行不稳定
  assert(/`region`, `store`/.test(byMetric), `并列时要有稳定的次序: ${byMetric}`);

  // 维度降序
  const byDim = orderOf(sqlOf(make('table', ['region', 'store'], { dimensionSorts: { region: 'desc' } })));
  assert(/^ORDER BY `region` DESC/.test(byDim), `维度降序要编进 SQL: ${byDim}`);
  // 「组内降序」在 SQL 里就是「前面的维度排完,这一列在组内降序」—— 位置不变,方向变
  const grouped = orderOf(sqlOf(make('table', ['region', 'store'], { dimensionSorts: { store: 'group_desc' } })));
  assert(/`region`, `store` DESC|`store` DESC, `region`/.test(grouped), `组内降序: ${grouped}`);

  /* 时间轴不按数值排。折线图的 x 轴按 GMV 排完,月份就乱了(2026-09 排在 2026-02 前面),
     那条线看上去一路上涨,其实什么也不表示。 */
  const timeLine = orderOf(sqlOf(make('line', ['stat_date'], { metricSort: { key: 'field:amount', dir: 'asc' } }, { stat_date: 'month' })));
  assert(!/amount/.test(timeLine), `折线图的时间轴不该按指标排: ${timeLine}`);
  assert(/DATE_FORMAT/.test(timeLine), `时间轴按时间先后: ${timeLine}`);

  // 但明细表按金额排很正常 —— 那是一张明细,不是时间序列
  const timeTable = orderOf(sqlOf(make('table', ['stat_date', 'store'], { metricSort: { key: 'field:amount', dir: 'desc' } }, { stat_date: 'day' })));
  assert(/^ORDER BY `amount` DESC/.test(timeTable), `明细表按金额排是正常的: ${timeTable}`);

  // 条形图按指标排名次 —— 分类轴不是时间
  const bar = orderOf(sqlOf(make('bar', ['region'], { metricSort: { key: 'field:amount', dir: 'desc' } })));
  assert(/^ORDER BY `amount` DESC/.test(bar), `条形图按指标排名次: ${bar}`);

  // 排序指着的度量已经不在了:当没设,别编一句引用不存在列的 SQL
  const stale = orderOf(sqlOf(make('table', ['region'], { metricSort: { key: 'field:gone', dir: 'desc' } })));
  assert.equal(stale, 'ORDER BY `region`', `排序指着的度量没了就当没设: ${stale}`);

  console.log('sort sql: 10 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
