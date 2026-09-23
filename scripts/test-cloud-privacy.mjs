import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

/**
 * 关掉「把真实取值和样本行发给 AI」之后,真实取值就**不许**进云端请求。
 *
 * 起因:这个开关默认是关的,可整条分析路径从来没人读过它
 * (`grep includeSampleRows src/features/agent/` 零命中)。
 * 于是每次分析都会把每个维度的 8 个真实取值(网点名、**主管姓名**)
 * 和 3 行真实数据发给云端模型,而用户以为自己关掉了。
 *
 * 一个不起作用的隐私开关比没有开关更糟 —— 它让人以为自己受保护。
 */
const dir = mkdtempSync(join(tmpdir(), 'sonde-cloud-privacy-'));
try {
  const outfile = join(dir, 'tests.cjs');
  buildSync({ stdin: { contents: `export * from './src/features/agent/nodes/layoutDesigner';\nexport { defaultAiConfig } from './src/features/ai/aiConfigModel';`,
    resolveDir: resolve('.'), loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  const m = createRequire(import.meta.url)(outfile);

  // 真实感的数据:主管那一列是真人姓名,网点是真实网点名
  const result = {
    columns: [{ name: 'outlet_manager' }, { name: 'outlet_name' }, { name: 'gmv' }],
    rows: [['华北大区-主管-张三', '示例连锁·和平路店', 152340.5], ['华北大区-主管-李四', '示例连锁·南京路店', 98220.0]],
  };
  const plan = { metricIds: ['gmv'], shape: { dimensions: ['outlet_manager', 'outlet_name'] }, result };
  const state = { plans: [{ planId: 'p1', role: 'primary' }], supportingPlans: [], validatedMetrics: [],
    scope: { label: '上周' }, report: '', analysisSummary: '', evidenceGaps: [], investigation: [] };

  let sent = '';
  const { layoutDesigner, designDataViews } = m.createLayoutDesigner({
    getPlan: () => plan,
    callStructured: async (call) => { sent = JSON.stringify(call); throw new Error('stop after capture'); },
  });

  // 两头都要测:辅助函数本身会不会漏,以及**节点有没有真的把开关传下去**。
  // 只测前者的话,把节点里那个参数写死成 true 也照样全绿。
  const shapeOnly = JSON.stringify(designDataViews(state, false));
  assert.ok(!shapeOnly.includes('张三') && !shapeOnly.includes('和平路店'), '辅助函数本身不许漏:' + shapeOnly);
  assert.ok(JSON.stringify(designDataViews(state, true)).includes('张三'), '明确要样本时才给');

  const run = async (includeSampleRows) => {
    sent = '';
    try { await layoutDesigner(state, { modelConfig: { ...m.defaultAiConfig(), includeSampleRows } }); } catch { /* 抓到请求就够 */ }
    return sent;
  };

  const off = await run(false);
  assert.ok(off, '得真的构造出请求才谈得上检查');
  for (const secret of ['张三', '李四', '和平路店', '南京路店', '152340']) {
    assert.ok(!off.includes(secret), `开关关着,真实取值「${secret}」不许出现在云端请求里`);
  }
  // 形状信息照常给 —— 版面设计靠它决定用什么图、排几栏
  assert.ok(off.includes('outlet_manager') && off.includes('outlet_name'), '维度**名字**还是要给,否则没法设计版面');
  assert.ok(/"count":\s*2/.test(shapeOnly), '取值个数要给 —— 分类多少个决定用饼图还是条形图:' + shapeOnly);
  assert.ok(/"rowCount":\s*2/.test(shapeOnly), '行数要给');

  const on = await run(true);
  assert.ok(on.includes('张三') && on.includes('和平路店'), '用户明确打开时才给真实取值');
  assert.ok(on.includes('152340'), '打开时样本行也给');

  console.log('Cloud privacy passed: real values stay local unless explicitly allowed; shape still reaches the designer.');
} finally { rmSync(dir, { recursive: true, force: true }); }
