// 小计/总计和图上"多行合成一个点"都是在**已经被数据库聚合过一轮**的值上再汇总。
// 这个前提决定了什么能算什么不能算,搞错了不会报错,只是数字不对 —— 而这些数字是要拿去汇报的。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-rollup-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: {
      contents: `
        export { aggregate } from './src/features/dashboard/widgets/metricUtils';
        export { resolveWidgetMetrics } from './src/features/dashboard/metrics';
      `,
      resolveDir: resolve('.'), loader: 'ts',
    },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { aggregate, resolveWidgetMetrics } = createRequire(import.meta.url)(outfile);

  const metric = (aggregation) => ({ key: 'k', field: 'f', name: 'f', aggregation, unit: '', decimals: 2, direction: 'neutral', columnIndex: 1 });
  // 五家店,每家一百单。
  const rows = [['A', 100], ['B', 100], ['C', 100], ['D', 100], ['E', 100]];

  assert.equal(aggregate(rows, metric('sum')), 500);
  // 原来返回 values.length —— 也就是 5,"有几家店",而不是"一共多少单"。
  assert.equal(aggregate(rows, metric('count')), 500, '计数的汇总是把各组计数相加,不是数有几组');
  assert.equal(aggregate(rows, metric('max')), 100);
  assert.equal(aggregate(rows, metric('min')), 100);
  assert.equal(aggregate(rows, metric('avg')), 100);
  assert.equal(aggregate([], metric('count')), 0, '没有行就是 0,不是崩');

  // 用户在左栏挑的汇总方式得传到渲染层。原来写死成 sum:明细表把一列平均值加起来,
  // 饼图也不再拦"平均值组不成整体"。
  const widget = {
    id: 'w1', type: 'table', title: 't', datasetId: 'ds1', x: 0, y: 0, w: 6, h: 4, visible: true, tabs: [],
    bindings: { dimensions: ['store'], measures: ['price'], aggregations: { price: 'avg' }, metricIds: [], secondaryMetricIds: [] },
    options: { decimals: 2, showLegend: true, smooth: false, topN: 0, metrics: {} },
  };
  const columns = [{ name: 'store' }, { name: 'price' }];
  assert.equal(resolveWidgetMetrics(widget, [], columns)[0].aggregation, 'avg', '选了平均就得是平均');
  const summed = { ...widget, bindings: { ...widget.bindings, aggregations: {} } };
  assert.equal(resolveWidgetMetrics(summed, [], columns)[0].aggregation, 'sum', '没选就按求和');
  const distinct = { ...widget, bindings: { ...widget.bindings, aggregations: { price: 'count_distinct' } } };
  assert.equal(resolveWidgetMetrics(distinct, [], columns)[0].aggregation, 'count_distinct', '去重计数要原样传下去,它有自己的汇总规则');

  console.log('rollup: 9 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
