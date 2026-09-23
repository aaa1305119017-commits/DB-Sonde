// 交叉表的列头:每个列维度一层(大区在上、主管在下),最后一行是指标。
// 原来所有列维度被拼成一个字符串「西北大区 / 刘海涛」挤在一格 —— 那不是交叉表,
// 是把两列粘一起了。分层之后合并的规则也变了:得看「这一层连同它上面所有层」,
// 只看本层的话,两个不同大区下的同名主管会被并成一格,数字就串了。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-pivot-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: { contents: `export { resolveWidgetMetrics } from './src/features/dashboard/metrics';`, resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { resolveWidgetMetrics } = createRequire(import.meta.url)(outfile);

  // 没绑度量时的兜底本来是「第二列就是指标」—— 那是给老文档留的(那时数据集是一段裸 SQL)。
  // 交叉表一摆:行是日期、列是品类,第二列正好是品类,于是表头写着「品类」、格子全是 0。
  const widget = {
    id: 'w1', type: 'table', title: 't', datasetId: 'ds1', x: 0, y: 0, w: 6, h: 4, visible: true, tabs: [],
    bindings: { dimensions: ['sale_date', 'product'], measures: [], metricIds: [], secondaryMetricIds: [] },
    options: { decimals: 2, showLegend: true, smooth: false, topN: 0, metrics: {} },
  };
  const columns = [{ name: 'sale_date' }, { name: 'product' }, { name: 'amount' }];
  assert.deepEqual(resolveWidgetMetrics(widget, [], columns), [], '绑过的维度不该被当成指标');

  // 老文档(没绑维度)照旧兜底,别把它们的图弄空。
  const legacy = { ...widget, bindings: { dimensions: [], measures: [], metricIds: [], secondaryMetricIds: [] } };
  assert.equal(resolveWidgetMetrics(legacy, [], columns)[0]?.field, 'product', '没绑维度时保留原来的兜底');

  console.log('pivot header: 2 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
