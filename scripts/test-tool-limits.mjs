// 工具入参的数组上限。
//
// S.arr 默认封顶 20 —— 那是为**模型输出**准备的护栏(json_schema 模式下不给上限,
// 模型可能重复吐同一项直到撞 max_tokens)。可同一套 schema 也在校验**我们自己代码
// 填进去的入参**,那个理由完全不成立,而撞上限的后果是整次分析报「入参不对」然后作废。
//
// 真机上废掉过一次:验收列出 22 条遗留问题,而 set_dashboard_provenance 的 openIssues
// 封顶 20 —— 结论复核已经通过、看板也设计出来了,死在最后记一笔来龙去脉的入参校验上。
// 同类的还有筛选条件的取值列表:按网点筛一次点二三十家太正常了。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-limits-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: { contents: `
      export * as dashboard from './src/features/agent/tools/dashboardTools';
      export { createDataToolRuntime } from './src/features/agent/tools/dataToolRuntime';
      export { validate } from './src/features/agent/jsonSchema';`,
      resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const mod = createRequire(import.meta.url)(outfile);
  const { validate } = mod;

  /** 把所有工具摊平成 name → schema,不管它们是怎么组织的。 */
  const schemas = new Map();
  const collect = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(collect);
    if (typeof value.name === 'string' && value.schema) { schemas.set(value.name, value.schema); return; }
    Object.values(value).forEach(collect);
  };
  collect(mod.dashboard);
  // 取数工具是工厂造出来的,先用空壳端口实例化一份 —— 这里只看 schema,不真跑
  collect(mod.createDataToolRuntime({
    readCatalog: () => [], nextId: () => 'p1', today: () => '2026-08-31',
    executeDataset: async () => ({ columns: [], rows: [], truncated: false }),
    fastDimensionValues: async () => null,
  }));
  assert(schemas.size > 0, '没收集到工具定义,测试本身失效了');

  const list = (n, make = (i) => `第${i}项`) => Array.from({ length: n }, (_, i) => make(i));
  // validate 返回的是错误字符串数组,空数组 = 通过
  const errorsOf = (name, input) => {
    const schema = schemas.get(name);
    assert(schema, `找不到工具 ${name}`);
    return validate(input, schema);
  };
  const ok = (name, input, why) => {
    const errors = errorsOf(name, input);
    assert.deepEqual(errors, [], `${why}\n  ${errors.join('\n  ')}`);
  };

  // 验收列出 22 条遗留问题 —— 真机上就是这个数字把整次分析废掉的
  ok('set_dashboard_provenance', {
    dashboardId: 'd', workflowId: 'w', userRequest: '八月怎么样',
    openIssues: list(22), autoFixed: list(30),
  }, '记一笔来龙去脉不该有二十条的上限 —— 那是验收结果原样抄进来的,不是模型吐的');

  // 按网点筛选,点了 30 家
  ok('build_query_plan', {
    metricIds: ['gmv'], dimensions: ['store'], dateRange: { start: '2026-08-01', end: '2026-08-31' },
    filters: [{ field: 'store', values: list(30, (i) => `网点${i}`) }],
  }, '筛选条件里选二三十个取值太正常了');

  ok('set_dashboard_scope', {
    dashboardId: 'd', start: '2026-08-01', end: '2026-08-31',
    filters: [{ field: 'store', values: list(30, (i) => `网点${i}`) }],
  }, '锁定范围里的取值同理');

  /* 但上限本身要留着:这些 schema 同时也约束模型的输出,
     完全不给上限会让它在 json_schema 模式下陷入重复吐同一项的解码循环。 */
  assert(errorsOf('set_dashboard_provenance', { dashboardId: 'd', workflowId: 'w', userRequest: 'x', openIssues: list(5000) }).length,
    '上限还是要有 —— 它挡的是模型的解码循环,只是不该定在 20');

  console.log('tool limits: 5 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
