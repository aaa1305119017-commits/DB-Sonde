// 指标口径的静态体检 —— 不用连库就能发现的那几类错。
//
// 起因是一次分析里笔均金额算出来 2,680 元。定义看着没毛病,
// 实际上踩了两个坑,而且两个都不报错、算出来的数看着也不像坏数据:
//   · 比率的分子分母是裸列,没套 SUM —— 编出来是行级比值,一分组就是随便取某一行;
//   · scale=100 而单位不是 % —— 从别的比率指标抄过来忘了改,结果整整大一百倍
//     (真实值 26.80 元 × 100 = 2680)。
// 还有一类是 SUM(a + b):SQL 里 x+NULL=NULL,SUM 会整行跳过,分子分母跳的行不一样,
// 比值就偏了。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-health-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: { contents: `export { checkMetrics, nullUnsafeSums, sourceTablesOf } from './src/features/metrics/metricHealth';`,
      resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { checkMetrics, nullUnsafeSums, sourceTablesOf } = createRequire(import.meta.url)(outfile);

  // ── SUM(a + b) 会静默丢行 ───────────────────────────────────────────────
  assert.equal(nullUnsafeSums('SUM(a.offline_gmv_amt + a.online_gmv_amt)').length, 1, '两列相加要报');
  assert.equal(nullUnsafeSums('sum( a.x - a.y )').length, 1, '相减一样,大小写和空格都要认');
  assert.equal(nullUnsafeSums('SUM(COALESCE(a.x,0) + COALESCE(a.y,0))').length, 0, '兜住了就别报');
  assert.equal(nullUnsafeSums('SUM(a.gmv_amt)').length, 0, '单列不报');
  assert.equal(nullUnsafeSums('SUM(a.gmv) + 1').length, 0, '括号外面的加法跟 NULL 无关');
  assert.equal(nullUnsafeSums('SUM(CASE WHEN a.flag=1 THEN a.amt ELSE 0 END)').length, 0, 'CASE 里没有相加');
  assert.equal(nullUnsafeSums('COUNT(DISTINCT CASE WHEN (a.x + a.y) > 0 THEN a.d END)').length, 0,
    'COUNT(DISTINCT) 里的相加只是个条件,丢不了行');

  const base = { enabled: true, connId: 'c1', database: 'db', name: 'm', unit: '', category: '', caliber: '', key: '', connName: '' };
  const run = (metrics) => checkMetrics(metrics, async () => []);
  const kindsOf = (report, id) =>
    (report.unhealthy.find((h) => h.metricId === id)?.issues ?? []).map((i) => i.kind);

  // ── 比率的分子分母必须是聚合 ────────────────────────────────────────────
  const report = await run([
    { ...base, id: 'aov', name: '笔均金额', type: 'ratio', scale: 100, unit: '',
      source: 't a', numerator: 'a.offline_gmv_amt + a.online_gmv_amt', denominator: 'a.dine_order_cnt + a.wm_order_cnt' },
    { ...base, id: 'aov_ok', name: '笔均金额(改好的)', type: 'ratio', scale: 1, unit: '元',
      source: 't a', numerator: 'SUM(COALESCE(a.offline_gmv_amt,0) + COALESCE(a.online_gmv_amt,0))',
      denominator: 'SUM(COALESCE(a.dine_order_cnt,0) + COALESCE(a.wm_order_cnt,0))' },
    { ...base, id: 'rate', name: '差评率', type: 'ratio', scale: 100, unit: '%',
      source: 't a', numerator: 'SUM(a.bad)', denominator: 'SUM(a.cnt)' },
    { ...base, id: 'gmv', name: '销售额', type: 'measure', expression: 'SUM(a.offline_gmv_amt + a.online_gmv_amt)' },
  ]);

  const aov = kindsOf(report, 'aov');
  assert.equal(aov.filter((k) => k === 'ratio-not-aggregated').length, 2, '分子和分母各报一条');
  assert(aov.includes('suspicious-scale'), '×100 配非百分比单位要报 —— 26.80 元变 2680 就是这么来的');
  assert(aov.includes('null-unsafe-sum') === false, '裸列相加还谈不上 SUM 丢行,别重复报');

  assert.deepEqual(kindsOf(report, 'aov_ok'), [], '改对了就不该再报');
  assert.deepEqual(kindsOf(report, 'rate'), [], '差评率是真百分比,×100 正常');
  assert.deepEqual(kindsOf(report, 'gmv'), ['null-unsafe-sum'], 'measure 型也要检 —— 原来只检 template 型');

  // 停用的指标不检
  const off = await run([{ ...base, id: 'x', enabled: false, type: 'ratio', source: 't a', numerator: 'a.x', denominator: 'a.y' }]);
  assert.deepEqual(off.unhealthy, [], '停用的不检');

  /* ── 底表要能从各种指标类型里抽出来 ──────────────────────────────────────
     原来只认 template 型(从 queryPlan 读 sourceTables)。可真实目录里一个 template
     都没有 —— 153 个全是 measure/ratio/sql 型,底表写在 source 这个 FROM 子句里。
     体检于是报「0 张底表」,那套「表还在不在」的检查从来没跑过,
     而它正是这个功能当初要解决的问题(底表被删了、指标还挂在上面)。 */
  const joined = 'shop_ads.ads_outlet_daily a JOIN shop_ads.ads_outlet_dim d ON a.store_id = d.outlet_uuid';
  assert.deepEqual(sourceTablesOf({ ...base, type: 'measure', source: joined, expression: 'SUM(a.x)' }),
    ['shop_ads.ads_outlet_daily', 'shop_ads.ads_outlet_dim'], 'FROM 子句里的主表和 JOIN 表都要抽出来');
  assert.deepEqual(sourceTablesOf({ ...base, type: 'ratio', source: joined, numerator: 'SUM(a.x)', denominator: 'SUM(a.y)' }),
    ['shop_ads.ads_outlet_daily', 'shop_ads.ads_outlet_dim'], '比率型同理');
  assert.deepEqual(sourceTablesOf({ ...base, type: 'sql', sql: 'SELECT COUNT(*) FROM db1.t1 JOIN db2.t2 ON 1=1' }),
    ['db1.t1', 'db2.t2'], 'sql 型从 SQL 正文里抽');
  assert.deepEqual(sourceTablesOf({ ...base, type: 'derived', numeratorMetricId: 'a', denominatorMetricId: 'b' }),
    [], '派生指标引用的是别的指标,不直接碰表');

  // 底表被删要报出来,而且是对着所有用到它的指标报
  const deleted = await checkMetrics([
    { ...base, id: 'a', name: '销售额', type: 'measure', source: joined, expression: 'SUM(a.gmv)' },
    { ...base, id: 'b', name: '会员数', type: 'measure', source: 'shop_dws.dws_user a', expression: 'COUNT(a.uid)' },
  ], async (_c, db, table) => (table === 'ads_outlet_dim' ? null : ['gmv', 'uid']));
  assert.deepEqual(kindsOf(deleted, 'a'), ['table-missing'], '用到被删表的指标要报');
  assert.deepEqual(kindsOf(deleted, 'b'), [], '没用到的别误伤');

  // 列不存在也要报 —— 但有表没问到时就别判列,否则并集缺一块会报出假的「列不存在」
  const badColumn = await checkMetrics(
    [{ ...base, id: 'c', name: 'x', type: 'measure', source: 'db.t a', expression: 'SUM(a.gone)' }],
    async () => ['kept']);
  assert.deepEqual(kindsOf(badColumn, 'c'), ['column-missing'], '引用了库里没有的列');
  const cannotAsk = await checkMetrics(
    [{ ...base, id: 'c', name: 'x', type: 'measure', source: 'db.t a', expression: 'SUM(a.gone)' }],
    async () => []);
  assert.deepEqual(kindsOf(cannotAsk, 'c'), [], '问不到列清单时不判列 —— 宁可少报也不瞎报');

  /* 没绑连接 = 一行都没查,必须明说。真机上就是这么过去的:重新导入目录把连接绑定
     冲掉了,131 个指标全成了未绑定,体检照样显示「0 张底表」,看着像检查过了没问题。 */
  const unbound = await checkMetrics(
    [{ ...base, id: 'u', name: '销售额', connId: '', type: 'measure', source: 'db.t a', expression: 'SUM(a.gmv)' }],
    async () => { throw new Error('不该去查库'); });
  assert.deepEqual(kindsOf(unbound, 'u'), ['not-bound'], '没绑连接要报出来,不能静悄悄显示 0 张底表');
  assert.equal(unbound.tables, 0, '确实一张表都没查');

  // 没绑连接的指标问不了库,别拿它报「表不存在」
  const noConn = await checkMetrics(
    [{ ...base, id: 'd', connId: '', type: 'measure', source: joined, expression: 'SUM(a.x)' }],
    async () => { throw new Error('不该被调用'); });
  assert.deepEqual(kindsOf(noConn, 'd'), ['not-bound'], '不去查库,但要说清为什么没查');

  console.log('metric health: 28 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
