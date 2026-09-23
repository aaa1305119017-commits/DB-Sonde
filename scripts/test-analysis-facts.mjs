// 分析链路上「算得对不对、说得全不全」的几条。都是自查时真发现的问题:
//
// 1) 一组没数据,整个维度的结论全没了。`总计算不出来` 有两种情形,原来混成一种:
//    「这一组整列是空的」和「这个指标本来就不能跨行合并(比率/均值)」。后者确实排不了名,
//    前者只该丢掉那一组 —— 六百家店里有一家当天没数,排名、占比、最低项就全不生成,
//    而且不声不响,报告里只剩一个总量。
// 2) 对比期没数据,整个分析被判死。同比期空(去年这店还没开)本该是「这次没有同比」,
//    而不是「数据检查没有通过,不做了」。
// 3) 模型在正文里写带花括号的话,JSON 就抠不出来了。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-facts-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: { contents: `
      export { computeFacts } from './src/features/agent/factCalculator';
      export { createDataNodes } from './src/features/agent/nodes/dataNodes';
      export { extractJson } from './src/features/agent/model/structured';
      export { metricRollup, isDistinctCount } from './src/features/dashboard/semantic';
      export { checkTotals } from './src/features/agent/validation/dataChecks';
      export { createConclusionReviewer } from './src/features/agent/evidenceExploration';`,
      resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { computeFacts, createDataNodes, extractJson, metricRollup, isDistinctCount, checkTotals, createConclusionReviewer } = createRequire(import.meta.url)(outfile);

  const table = (cols, rows) => ({ columns: cols.map((name) => ({ name })), rows, rowsAffected: null, truncated: false });
  const scope = { label: '2026年1月', dateRange: { start: '2026-01-01', end: '2026-01-31' } };
  const factsOf = (plan) => computeFacts(
    { plans: [{ planId: 'p1', role: 'primary', dateRange: scope.dateRange }], scope },
    () => plan, (k) => k);

  // ── 1. 空分组 ───────────────────────────────────────────────────────────
  const sumMetric = [{ field: 'gmv', name: 'GMV', unit: '元', rollup: 'sum' }];
  const withBlank = factsOf({
    shape: { dimensions: ['region'], metrics: sumMetric },
    result: table(['region', 'gmv'], [['北京', 300], ['华东', null], ['山东', 200]]),
  });
  const ranking = withBlank.find((f) => f.kind === 'topn');
  assert(ranking, '一组没数据不该让整个维度的排名消失');
  assert.deepEqual(ranking.rows, [['北京', 300], ['山东', 200]], '没数据的那组丢掉,其余照常排');
  assert(/1 组没有数据/.test(ranking.text), '丢了几组要说出来,不能不声不响');
  assert(withBlank.some((f) => f.kind === 'contribution'), '占比也要照常算');
  const share = withBlank.find((f) => f.kind === 'contribution');
  assert.equal(share.rows[0][2], 60, '占比的分母是有数据的那几组之和(300/500)');

  // 不可加的指标仍然整个维度都不排名 —— 混粒度平均不是证据
  const ratio = factsOf({
    shape: { dimensions: ['region'], metrics: [{ field: 'rate', name: '差评率', unit: '%', rollup: 'avg' }] },
    result: table(['region', 'rate'], [['北京', 3.2], ['北京', 4.0], ['华东', 5.1], ['华东', 5.5]]),
  });
  assert.equal(ratio.filter((f) => f.kind === 'topn').length, 0, '比率型指标一组多行时不能排名(那是平均的平均)');

  // 时间轴上个别日期没数,只丢那个点
  const gappy = factsOf({
    shape: { dimensions: ['day'], metrics: sumMetric },
    result: table(['day', 'gmv'], [['2026-01-01', 100], ['2026-01-02', null], ['2026-01-03', 300]]),
  });
  const trend = gappy.find((f) => f.computedBy?.startsWith('first_vs_last'));
  assert(trend, '个别日期没数不该让趋势消失');
  assert(/1 个时间点没有数据/.test(trend.text), '缺了几个点要说出来');

  /* ── 同环比要拆到分组 ──────────────────────────────────────────────────
     「整体涨了 6%,到底哪几个分组在涨、有没有在跌的」是最常被追问的一件事。
     对比期的查询本来就是按同一组维度取的,数据在手里 —— 以前只算整体那一个数。
     真机上模型自己在「证据仍有局限」里写过:「各大区环比未按大区拆分,
     无法判断整体增长具体集中在哪些大区」。那不是数据不够,是这里漏了。 */
  const sumShape = { dimensions: ['region'], metrics: sumMetric };
  const twoPeriods = {
    now: { shape: sumShape, result: table(['region', 'gmv'], [['北京', 120], ['华东', 80], ['山东', 300], ['新店', 50]]) },
    prev: { shape: sumShape, result: table(['region', 'gmv'], [['北京', 100], ['华东', 100], ['山东', 200], ['关了的店', 40]]) },
  };
  const compared = computeFacts({
    plans: [{ planId: 'now', role: 'primary', dateRange: scope.dateRange },
            { planId: 'prev', role: 'mom', dateRange: { start: '2026-07-01', end: '2026-07-31' } }],
    scope,
  }, (id) => twoPeriods[id], (k) => k);
  const byGroup = compared.find((f) => f.computedBy === 'group_mom(gmv by region)');
  assert(byGroup, '同环比要拆到分组,不能只给一个整体数');
  assert.deepEqual(byGroup.rows.map((r) => r[0]), ['山东', '北京', '华东'], '按变化幅度排序');
  assert.equal(byGroup.rows[0][3], 50, '山东 200→300 是 +50%');
  assert.equal(byGroup.rows[2][3], -20, '跌的也要出来 —— 整体在涨不代表没有在跌的');
  assert(/新增/.test(byGroup.text) && /消失/.test(byGroup.text), '只在一期出现的分组要点出来,那本身就是发现');
  // 整体那条还在,两者互为参照
  assert(compared.some((f) => f.computedBy === '环比((now-then)/|then|)'), '整体环比照旧');

  // 不可加的指标整个维度都比不了,别拿一半分组冒充「各分组的变化」
  const ratioShape = { dimensions: ['region'], metrics: [{ field: 'rate', name: '差评率', unit: '%', rollup: 'avg' }] };
  const ratioPeriods = {
    now: { shape: ratioShape, result: table(['region', 'rate'], [['北京', 3], ['北京', 4], ['华东', 5], ['华东', 6]]) },
    prev: { shape: ratioShape, result: table(['region', 'rate'], [['北京', 2], ['北京', 3], ['华东', 4], ['华东', 5]]) },
  };
  const ratioCompared = computeFacts({
    plans: [{ planId: 'now', role: 'primary', dateRange: scope.dateRange },
            { planId: 'prev', role: 'yoy', dateRange: { start: '2025-01-01', end: '2025-01-31' } }],
    scope,
  }, (id) => ratioPeriods[id], (k) => k);
  assert(!ratioCompared.some((f) => f.computedBy?.startsWith('group_yoy')),
    '一组多行的比率指标不能跨行合并,分组同比也就无从谈起');

  // ── 2. 对比期没数据,不该拖死整个分析 ────────────────────────────────────
  const issuesByPlan = {
    p1: [],
    pYoy: [{ level: 'fail', code: 'EMPTY', message: '查询没有返回任何数据。' }],
    pSup: [{ level: 'fail', code: 'DUPLICATE_DIMENSIONS', message: '同一个维度组合出现了多行。' }],
  };
  const { dataValidator } = createDataNodes({
    callTool: async (name, args) => name === 'validate_dataset'
      ? { ok: true, data: { issues: issuesByPlan[args.planId] ?? [] } }
      : { ok: true, data: {} },
    getPlan: () => undefined, dimensionLabel: (k) => k,
  });
  const out = await dataValidator({
    workflowId: 'w', errors: [], usage: [], trace: [], retry: {},
    scope: { ...scope, comparisonRanges: [{ kind: 'mom', start: '2025-12-01', end: '2025-12-31' }, { kind: 'yoy', start: '2025-01-01', end: '2025-01-31' }] },
    plans: [{ role: 'primary', planId: 'p1', dateRange: scope.dateRange },
            { role: 'yoy', planId: 'pYoy', dateRange: { start: '2025-01-01', end: '2025-01-31' } }],
    supportingPlans: [{ planId: 'pSup', dimensions: ['region'] }],
  });
  assert.notEqual(out.validation.status, 'fail', '本期数据没问题,不该因为同比期是空的就整个不做');
  assert.equal(out.validation.status, 'warn', '摘掉的查询要留个提醒');
  assert.deepEqual(out.plans.map((p) => p.planId), ['p1'], '没通过体检的对比期要摘掉,别拿它算同比');
  assert.deepEqual(out.supportingPlans, [], '补充查询同理');
  assert(out.dropped?.some((d) => /同比期/.test(d)), '摘掉了什么必须写进结论');
  /* 摘掉的对比期也要从 scope 里拿掉:生成的看板上 KPI 卡是照 scope.comparisonRanges
     决定开不开同比徽标的 —— 报告说「这次没做同比」、看板上却有,就自相矛盾了。 */
  assert.deepEqual(out.scope.comparisonRanges.map((r) => r.kind), ['mom'], '被摘掉的同比要从 scope 里去掉');

  // 主查询 fail 仍然要停 —— 没数就没有分析
  const stopped = await dataValidator({
    workflowId: 'w', errors: [], usage: [], trace: [], retry: {},
    plans: [{ role: 'primary', planId: 'pYoy', dateRange: scope.dateRange }],
  });
  assert.equal(stopped.validation.status, 'fail', '主查询没通过体检还是要停');

  /* ── 去重计数不是可加指标 ──────────────────────────────────────────────
     measure 型指标原来只看 AVG/MIN/MAX 三个前缀,别的一律当可加 —— 于是
     「有效天数」= COUNT(DISTINCT 日期) 被判成求和,按网点分组一加,31 天变成 310。
     真机上是「总分对齐」体检拦下来的,而且因为拦在主查询上,整个分析直接停了。 */
  const measure = (expression) => metricRollup({ id: 'm', name: 'm', type: 'measure', enabled: true, unit: '', expression });
  assert.equal(measure('COUNT(DISTINCT stat_date)'), 'count_distinct', '去重计数不能当求和');
  assert.equal(measure('count(distinct  store_id)'), 'count_distinct', '大小写和空格都得认');
  assert.equal(measure('SUM(gmv) / SUM(orders)'), 'avg', '顶层除法是比率');
  assert.equal(measure('SUM(amount)'), 'sum', '求和还是求和');
  assert.equal(measure('COUNT(*)'), 'sum', '普通计数是可加的,别误伤');
  assert.equal(measure('SUM(a / b)'), 'sum', '除法在括号里不影响可加性');

  // 事实计算也得拒绝跨组合并去重计数 —— 同一家店在两个组里会被数两遍
  const distinctFacts = factsOf({
    shape: { dimensions: ['region'], metrics: [{ field: 'days', name: '有效天数', unit: '天', rollup: 'count_distinct' }] },
    result: table(['region', 'days'], [['北京', 31], ['北京', 30], ['华东', 31]]),
  });
  assert.equal(distinctFacts.filter((f) => f.kind === 'topn').length, 0, '一组多行的去重计数不能排名');
  assert(!distinctFacts.some((f) => f.kind === 'contribution'), '更不能算占总量的比例');

  /* ── 「有效天数」:两个数都对,只有定义指标的人知道要哪个 ──────────────────
     COUNT(DISTINCT 日期) 按网点分组后各店天数**加起来**是网点有效天数(算日均时的
     分母,10 家店 × 31 天 = 310);不分组直接查出来是日历天数(31)。
     真机上这被「总分对齐」判成硬问题 —— 说「这个指标根本不能跨行相加」并把整个分析
     停掉。可要算日均,要的正是相加的那个。 */
  const days = { id: 'd', name: '有效天数', type: 'measure', enabled: true, unit: '天', expression: 'COUNT(DISTINCT stat_date)' };
  assert.equal(isDistinctCount(days), true, '算式是去重计数 —— 跟「跨组怎么合并」是两回事');
  assert.equal(metricRollup({ ...days, rollup: 'sum' }), 'sum', '人填了求和就按求和');

  const groupedDays = { columns: [{ name: 'store' }, { name: 'days' }], rows: Array.from({ length: 10 }, (_, i) => [`店${i}`, 31]), truncated: false };
  const wholeDays = { columns: [{ name: 'days' }], rows: [[31]], truncated: false };
  const distinctIssues = checkTotals(groupedDays, wholeDays,
    [{ field: 'days', name: '有效天数', rollup: 'sum', unit: '天', distinctCount: true }]);
  assert(!distinctIssues.some((i) => i.level === 'fail'),
    '去重计数的分组之和跟整体去重本来就不是一个量,差多少都不该判成硬问题');
  assert(distinctIssues.some((i) => i.code === 'DISTINCT_COUNT_SCOPE' && /310/.test(i.message) && /31/.test(i.message)),
    '但要把两个数都摆出来,说清各自是什么');
  // 不是去重计数的照旧硬拦 —— 那才是 JOIN 放大/不可加指标的信号
  assert(checkTotals(groupedDays, wholeDays, [{ field: 'days', name: 'x', rollup: 'sum', unit: '' }])
    .some((i) => i.level === 'fail'), '普通可加指标对不上还是硬问题');

  // 总量要跟排名对得上:声明成求和就用各组之和,不能用不分组那次的结果
  const consistent = computeFacts(
    { plans: [{ planId: 'p1', role: 'primary', dateRange: scope.dateRange }], scope },
    () => ({
      shape: { dimensions: ['store'], metrics: [{ field: 'days', name: '有效天数', unit: '天', rollup: 'sum' }] },
      result: { columns: [{ name: 'store' }, { name: 'days' }], rows: [['甲', 31], ['乙', 31]], truncated: false },
      totalResult: wholeDays,
    }), (k) => k);
  const totalFact = consistent.find((f) => f.computedBy === 'sum(days)');
  assert(totalFact, '声明成求和就该按各组之和算总量');
  assert.equal(totalFact.rows[0][1], 62, '总量 62 要跟排名加起来对得上,不能写成不分组查到的 31');

  /* ── 复核必须看得到数据体检的结论 ──────────────────────────────────────
     写报告那个节点被明确要求「体检有提醒就在结论里交代」,而复核原来只拿到事实清单,
     于是报告里那句「数据体检提示 2 处 MANY_NULLS」在它眼里成了「无证据支持的说法」。
     只要体检是 warn,报告就必然被判不通过,两轮之后整个分析作废 —— 而它交代得完全正确。
     真机上就是这么废掉一次的。 */
  let seenPrompt = '';
  const reviewer = createConclusionReviewer({
    readCatalog: () => [],
    getPlan: () => undefined,
    callStructured: async (call) => {
      seenPrompt = call.system;
      return { ok: true, data: { verdict: 'pass', issues: [] }, ms: 1, promptTokens: 0, completionTokens: 0 };
    },
  });
  await reviewer({
    workflowId: 'w', errors: [], usage: [], trace: [], retry: {}, userRequest: '八月怎么样', scope,
    report: '数据体检提示存在 2 处 MANY_NULLS。',
    validation: { status: 'warn', summary: '数据可用,但有 2 处需要在结论里交代:MANY_NULLS、MANY_NULLS',
      issues: [{ level: 'warn', code: 'MANY_NULLS', message: '指标「笔均金额」有 20% 的空值,结论里要说明。' }] },
  });
  assert(/MANY_NULLS/.test(seenPrompt), '复核要能看到体检报了什么,否则报告如实交代反而被判无证据');
  assert(/笔均金额.*20%/.test(seenPrompt), '体检的具体明细也要给,不能只给一句汇总');

  /* issues 只装必须改的。复核一次列了八条,六条自己写着「此项可接受」「不构成错误」,
     全被当成「逐项修正」回灌给写作节点 —— 改一轮,下一轮再列一遍。 */
  assert(/issues 里只写\*\*必须修改\*\*的/.test(seenPrompt), '要明确区分「必须改」和「核对过没问题」');
  assert(/checked/.test(seenPrompt), '给它一个放「核对过没问题」的地方');
  // 提示词里不该混进源码注释
  assert(!/\/\*/.test(seenPrompt), '模板字符串里别写块注释 —— 那会原样发给模型');

  // ── 3. 正文里带花括号也要能抠出 JSON ────────────────────────────────────
  assert.deepEqual(extractJson('按 {日期范围} 汇总如下\n{"a":1}'), { a: 1 }, '前面的话里有花括号');
  assert.deepEqual(extractJson('{"a":1}\n详见 {附录}'), { a: 1 }, '后面的话里有花括号');
  assert.deepEqual(extractJson('{"note":"见 {附录}","a":2}'), { note: '见 {附录}', a: 2 }, '字符串里的花括号不能当结构');
  assert.deepEqual(extractJson('```json\n{"a":{"b":1}}\n```'), { a: { b: 1 } }, '嵌套对象');
  assert.equal(extractJson('完全没有 JSON'), null, '真没有就返回 null');

  console.log('analysis facts: 46 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
