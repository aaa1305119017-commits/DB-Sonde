// 三件在成品看板上一眼就看得见的错。都是真机跑出来的:
//
// 1) 一张 KPI 卡放六个指标,换算是**按第一个指标**定的、套到整张卡上 ——
//    销售额 5682 万要「万」,笔均金额 26 元跟着被除成「0万元」、网点数 463 家成了「0万家」。
//    定死任何一档都有一半读不出来,auto 让每个数按自己的量级选,这是唯一对的答案。
// 2) 环形图只剩一条细线圈,看着像"没数据"。半径本来三处各算一遍:pieRadii 算内外圈、
//    pieOuterRadius 又去收外圈(收完不管内圈)、导出端再内联抄一份。
//    内圈 55 外圈 75 是个 20 单位厚的环,外圈被收到 56 之后剩 1 个单位。
// 3) 副标题写着「按销售额降序」,柱子却按大区名顺排 —— 名字叫排名,读出来的名次全是错的。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-scale-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: { contents: `
      export { scaledText } from './src/features/dashboard/widgets/metricUtils';
      export { reviewLayout } from './src/features/agent/review';
      export { resolveLayout } from './src/features/agent/layout';
      export { reviewContext } from './src/features/agent/nodes/observations';`,
      resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { scaledText, reviewLayout, resolveLayout, reviewContext } = createRequire(import.meta.url)(outfile);

  /* ── 0. 量级是**算出来**的,不是喂进去的 ───────────────────────────────
     下面 1) 测的是 reviewLayout(消费者),量级由测试直接给。可生产环境里量级由
     reviewContext(生产者)算,而它**只收 sum / count 的指标** —— 去重计数、
     平均这些被静默丢掉。于是「营业额 2000 万 + 门店数 48 家」这张卡,
     生产者只看见营业额一个数,算出 magnitude == smallest,消费者收到的是
     一张"量级整齐"的卡,MIXED_SCALE 永远不触发,门店数照样显示成「0万家」。
     真机上就是这么漏过去的:修了消费者、测了消费者,生产者从来没测过。 */
  {
    const plan = {
      metricIds: ['gmv', 'stores'],
      shape: {
        dimensions: [],
        metrics: [
          { field: 'gmv', rollup: 'sum' },
          { field: 'stores', rollup: 'count_distinct' },
        ],
      },
      result: { columns: [{ name: 'gmv' }, { name: 'stores' }], rows: [[20038000, 48]], truncated: false },
    };
    const item = { type: 'kpi', title: '两战区营业额与门店基数', metricIds: ['gmv', 'stores'], dimensions: [], reason: '' };
    const ctx = reviewContext([item], { validatedMetrics: [] }, [plan]);
    assert.equal(ctx.magnitudes[0], 20038000, '最大的那个指标要算进去');
    assert.equal(ctx.smallest[0], 48,
      '去重计数的门店数也必须算进量级 —— 丢了它,这张卡在验收眼里就是"量级整齐"的');

    // 有了真实的 smallest,消费者才判得出跨档
    const findings = reviewLayout(resolveLayout([{ ...item, scale: 'wan', width: 'third' }]), ctx);
    const mixed = findings.find((f) => f.code === 'MIXED_SCALE');
    assert(mixed, '2000 万和 48 差 40 多万倍,必须判成跨档');
    assert.equal(mixed.fix.scale, 'auto');
  }

  /* 页面长度的阈值要和"组件数量由分析深度决定"这条设计提示对得上。
     原来是 40 行 —— 大概八九个组件就超了,模型刚按深度铺开就被验收推回去精简,
     两条规则互相打架。长本身不是错,滚半天没新东西才是。 */
  {
    const row = (y) => ({ type: 'bar', title: `图${y}`, metricIds: ['m1'], dimensions: ['d'], reason: '', x: 0, y, w: 12, h: 8 });
    const ctx = { validatedMetricIds: ['m1'], ratioMetricIds: [], categoryCounts: {}, pointCounts: {}, magnitudes: {}, smallest: {}, timeDimensions: [] };
    const tooLong = (items) => reviewLayout(resolveLayout(items), ctx).some((f) => f.code === 'TOO_LONG');

    // 七张整宽图 = 56 行,是个有深度的看板,不该被判太长
    assert(!tooLong([0, 8, 16, 24, 32, 40, 48].map(row)), '56 行不该判太长 —— 会把按深度铺开的设计推回去精简');
    // 九张 = 72 行,确实该提醒了
    assert(tooLong([0, 8, 16, 24, 32, 40, 48, 56, 64].map(row)), '72 行该提醒拆页');
  }

  // ── 1. 一张卡上量级跨档 ─────────────────────────────────────────────────
  const auto = (v, unit) => scaledText(v, 1, unit, { scale: 'auto' }, true);
  assert.equal(auto(56825000, '元'), '5,682.5万元', '大额按万');
  assert.equal(auto(26.15, '元'), '26.2元', '笔均金额保持原样 —— 除以一万就是「0万元」');
  assert.equal(auto(463, '家'), '463家', '网点数同理');
  assert.equal(auto(2173000, '单'), '217.3万单');
  assert.equal(auto(1.5e9, '元'), '15亿元', '上亿的按亿');
  // 定死一档时小的那个确实读不出来 —— 这就是 auto 要解决的
  assert.equal(scaledText(26.15, 1, '元', { scale: 'wan' }, true), '0万元', '这正是界面上看到的那个「0万元」');

  // 验收要按**整张卡**判,不是只看第一个指标
  const kpi = (patch = {}) => ({ type: 'kpi', title: '8月核心指标', metricIds: ['gmv', 'aov'],
    dimensions: [], band: 'headline', reason: '', x: 0, y: 0, w: 12, h: 3, ...patch });
  const context = {
    categoryCounts: {}, pointCounts: {}, validatedMetricIds: ['gmv', 'aov'], ratioMetricIds: [],
    timeDimensions: ['day', 'week', 'month', 'year'],
    magnitudes: { 0: 56825000 }, smallest: { 0: 26.15 },
  };
  const mixed = reviewLayout(resolveLayout([kpi({ scale: 'wan' })]), context);
  const fix = mixed.find((f) => f.code === 'MIXED_SCALE');
  assert(fix, '一张卡上量级跨了档要判出来');
  assert.equal(fix.fix.scale, 'auto', '改成 auto,而不是一刀切成 none(那样 5682 万会摊成 56,825,000)');
  // 已经是 auto 就别再提
  assert(!reviewLayout(resolveLayout([kpi({ scale: 'auto' })]), context).some((f) => f.code === 'MIXED_SCALE'));
  // 量级没跨档时照旧:模型没表态就代劳换算
  const same = { ...context, magnitudes: { 0: 56825000 }, smallest: { 0: 22446000 } };
  const single = reviewLayout(resolveLayout([kpi({ scale: undefined })]), same);
  assert.equal(single.find((f) => f.code === 'NO_SCALE')?.fix.scale, 'wan', '都是千万级就统一按万');
  assert(!single.some((f) => f.code === 'MIXED_SCALE'));

  // ── 2. 环形半径 ─────────────────────────────────────────────────────────
  new Function(readFileSync('src/features/dashboard/pieGeometry.runtime.js', 'utf8'))();
  const { pieRadii } = globalThis.__DASH_PIE__;
  assert.deepEqual(pieRadii(42, 75, false), [42, 75], '不显示标签就按用户设的来');
  const [hole, outer] = pieRadii(55, 75, true);
  assert.equal(outer, 56, '显示外置标签时外圈要收,给标签腾地方');
  assert(outer - hole >= 10, `收外圈时内圈要按比例跟着收,否则环被压成一条线(实得厚度 ${outer - hole})`);
  assert(hole < outer, '始终是个环,不是实心饼');
  assert.deepEqual(pieRadii(0, 75, true), [0, 56], '实心饼保持实心');
  assert.deepEqual(pieRadii(undefined, undefined, false), [42, 75], '缺省值');

  // ── 3. 「排名」就得排过 ─────────────────────────────────────────────────
  const compiler = readFileSync('src/features/agent/nodes/dashboardCompiler.ts', 'utf8');
  assert(/band === "ranking"[\s\S]{0,200}metricSort/.test(compiler),
    '标成排名的图必须带上按指标排序 —— 副标题写着「按销售额降序」、柱子却按名字顺排,读出来的名次全是错的');

  console.log('kpi scale: 16 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
