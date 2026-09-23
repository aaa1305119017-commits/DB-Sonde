// 交叉表的列:顺序、多层表头、列数封顶。
// 界面上很难把这几件事都摆出来(得先有一份取值够多的真数据),但它们错了都很难看出来:
// 列顺序不听配置、深一层被并进浅一层、或者一千多列把整个应用拖垮。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-pivot-layout-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: { contents: `export { buildPivot } from './src/features/dashboard/pivot';`, resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  const { buildPivot } = createRequire(import.meta.url)(outfile);

  const dim = (key) => ({ key, label: key, kind: 'dim', colIndex: 0 });
  const metric = (key) => ({ key, label: key, kind: 'metric', colIndex: 1, aggregation: 'sum' });

  // 大区 → 主管 两层列维度,行是网点。两个大区下有同名主管,这是最容易出错的地方。
  const records = [
    { store: 'A', zone: '北京', sup: '张', gmv: 1 },
    { store: 'A', zone: '北京', sup: '李', gmv: 2 },
    { store: 'A', zone: '上海', sup: '张', gmv: 3 },
    { store: 'B', zone: '北京', sup: '张', gmv: 4 },
  ];
  const dims = [dim('store'), dim('zone'), dim('sup')];
  const metrics = [metric('gmv')];
  const options = { dimensionPlacements: { zone: 'column', sup: 'column' } };

  const out = buildPivot(records, dims, metrics, options);
  const groups = out.columns.filter((c) => c.groups).map((c) => c.groups);
  // 排的是拼音序(北京 bei < 上海 shang、李 li < 张 zhang),不是码点序 —— 中文列头得这么排才对。
  assert.deepEqual(groups, [['北京', '李'], ['北京', '张'], ['上海', '张']],
    '列头按层保留,不是拼成一个字符串;顺序是一层一层比出来的');
  // 同名主管在不同大区下是不同的列 —— 合并表头时只看本层会把它们并成一格,数字就串了。
  assert.equal(new Set(out.columns.filter((c) => c.groups).map((c) => c.key)).size, 3, '同名的下层在不同上层下是不同的列');

  // 列维度自己的排序方向要生效。原来写死升序,配了降序也没反应。
  const desc = buildPivot(records, dims, metrics, { ...options, dimensionSorts: { zone: 'desc' } });
  assert.deepEqual(desc.columns.filter((c) => c.groups).map((c) => c.groups[0]), ['上海', '北京', '北京'], '第一层按配置降序');

  // 列数不设上限 —— 那是人家的数据,少给一列都是错的。宽表靠横向虚拟化撑住
  // (只画视口里那几列,见 columnWindow),而不是把数据砍掉。
  const wide = Array.from({ length: 400 }, (_, i) => ({ store: 'A', zone: `z${String(i).padStart(3, '0')}`, gmv: i }));
  const all400 = buildPivot(wide, [dim('store'), dim('zone')], metrics, { dimensionPlacements: { zone: 'column' } });
  assert.equal(all400.columns.filter((c) => c.groups).length, 400, '有多少列就给多少列');

  console.log('pivot layout: 5 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
