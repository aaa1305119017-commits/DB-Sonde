/* 血缘:「只看相关」的裁剪,以及图的布局取舍。
 *
 * 前半部分 —— 它自己写着「宁可多留,不可错杀」,那就按这条钉住。
 *
 * ads 层常常是一张几十列的宽表,十几条作业各灌几列。表级血缘会让「销售额」的
 * 上游里冒出供应链、会员、巡检这些压根不相干的表 —— 它们只是恰好写了同一张表的
 * 别的列。这个模块用"入口产出哪些列 vs 指标读哪些列"做近似裁剪。
 *
 * 裁多了比裁少了危险:用户看这张表跟自己无关,改表时就不会去核对它。
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-colfocus-'));
let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: { contents: `
      export { relevantUpstream } from './src/features/lineage/columnFocus';
      export { layout } from './src/features/lineage/LineageGraph';
      export { useEtl } from './src/features/etl/etlStore';
      export { useMetrics } from './src/features/metrics/metricsStore';`,
      resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const { relevantUpstream, layout, useEtl, useMetrics } = createRequire(import.meta.url)(outfile);

  /** 一条把 sources 的 SQL 灌进 target 表的作业。 */
  const flow = (target, sqls) => ({
    targets: [{ database: 'mart', table: target }],
    sources: sqls.map((querySql) => ({ database: 'src', table: 'x', querySql })),
  });
  const seed = (jobs, metric) => {
    useEtl.setState({ sources: [{ id: 's', name: 'datax', jobs }] });
    useMetrics.setState({ metrics: [metric] });
  };
  /** graph.up: 子 → 父边。 */
  const graphOf = (edges) => {
    const up = new Map(), down = new Map();
    for (const [from, to] of edges) {
      if (!up.has(to)) up.set(to, []);
      up.get(to).push({ from, to });
      if (!down.has(from)) down.set(from, []);
      down.get(from).push({ from, to });
    }
    return { up, down };
  };
  const measure = (over) => ({ id: 'm1', key: 'k', name: '指标', type: 'measure', enabled: true,
    connId: 'c', database: 'mart', source: 'wide', ...over });

  // ── 1. 本职工作:不相干的上游要剪掉 ──────────────────────────────────
  {
    seed(
      [flow('wide', ['SELECT a.settle_amt AS settle_amt FROM src.trades a']),
       flow('wide', ['SELECT b.stock_qty AS stock_qty FROM src.inventory b'])],
      measure({ expression: 'SUM(settle_amt)' }),
    );
    const graph = graphOf([['mart.trades', 'mart.wide'], ['mart.inventory', 'mart.wide']]);
    const keep = relevantUpstream(graph, 'metric:m1');
    assert(keep.has('mart.trades'), '读 settle_amt 的那条入口的上游要留');
    assert(!keep.has('mart.inventory'), '只灌 stock_qty 的入口跟这个指标无关,该剪');
    ok('不相干的上游确实剪得掉(否则这个功能等于没有)');
  }

  // ── 2. 名字短的表:判断不出来就得留 ─────────────────────────────────
  {
    /* mentions() 靠 \\b名字\\b 在 SQL 里找。名字只有两个字符时会撞上随便一个别名,
       所以判断不了 —— 原来返回 false,调用方当成"这个上游不相干"直接剪掉,
       正好跟本模块的原则反着来。 */
    seed(
      [flow('wide', ['SELECT t.settle_amt AS settle_amt FROM src.fx t'])],
      measure({ expression: 'SUM(settle_amt)' }),
    );
    const keep = relevantUpstream(graphOf([['mart.fx', 'mart.wide']]), 'metric:m1');
    assert(keep.has('mart.fx'), '表名太短判断不出来,按"宁可多留"就该留着,不能剪');
    ok('名字短到判断不了的表不会被误剪');
  }

  // ── 3. 菱形血缘:同一个节点被两条路径走到,词表要取并集 ───────────────
  {
    /* wide 由两条入口拼出来:一条走 alpha 灌 settle_amt,一条走 beta 灌 stock_qty。
       alpha 和 beta 又都由 mid 灌,而 mid 自己由 trades(settle_amt)和
       inventory(stock_qty)两条入口灌。指标两列都读。

       于是 mid 会被**两次入队**:一次带着 settle_amt 那一路的词表,一次带着
       stock_qty 那一路的。原来 seen 是出队时标记的,第二次直接跳过 ——
       mid 的上游就只按 settle_amt 剪了一遍,inventory 被误剪。 */
    seed(
      [
        flow('wide', ['SELECT a.settle_amt AS settle_amt FROM src.alpha a']),
        flow('wide', ['SELECT b.stock_qty AS stock_qty FROM src.beta b']),
        flow('alpha', ['SELECT m.settle_amt AS settle_amt FROM src.mid m']),
        flow('beta', ['SELECT m.stock_qty AS stock_qty FROM src.mid m']),
        flow('mid', ['SELECT t.settle_amt AS settle_amt FROM src.trades t']),
        flow('mid', ['SELECT i.stock_qty AS stock_qty FROM src.inventory i']),
      ],
      measure({ expression: 'SUM(settle_amt) + SUM(stock_qty)' }),
    );
    const graph = graphOf([
      ['mart.alpha', 'mart.wide'], ['mart.beta', 'mart.wide'],
      ['mart.mid', 'mart.alpha'], ['mart.mid', 'mart.beta'],
      ['mart.trades', 'mart.mid'], ['mart.inventory', 'mart.mid'],
    ]);
    const keep = relevantUpstream(graph, 'metric:m1');
    assert(keep.has('mart.alpha') && keep.has('mart.beta'), '两条支线都要留');
    assert(keep.has('mart.mid'), '汇合的中间表要留');
    assert(keep.has('mart.trades'), 'settle_amt 那一路要留');
    assert(keep.has('mart.inventory'),
      'stock_qty 那一路也要留 —— mid 被两条路径走到,词表要取并集,不能第一条赢');
    ok('菱形血缘:同一节点两条路径的词表取并集,不是先到先得');
  }

  // ── 4. 判断不了的情况一律不剪 ───────────────────────────────────────
  {
    seed([flow('wide', [''])], measure({ expression: 'SUM(settle_amt)' }));
    const keep = relevantUpstream(graphOf([['mart.anything', 'mart.wide']]), 'metric:m1');
    assert(keep.has('mart.anything'), '入口没有 SQL 可参考时退回表级血缘,全留');

    useEtl.setState({ sources: [] });
    assert.equal(relevantUpstream(graphOf([]), 'metric:m1'), null, '没有 ETL 信息就交回 null,让调用方别剪');
    assert.equal(relevantUpstream(graphOf([]), 'mart.wide'), null, '焦点不是指标时也不剪');
    ok('判断不了时一律不剪');
  }

  // ── 5. 下游不剪 ─────────────────────────────────────────────────────
  {
    seed([flow('wide', ['SELECT a.settle_amt AS settle_amt FROM src.trades a'])],
         measure({ expression: 'SUM(settle_amt)' }));
    const graph = graphOf([['mart.trades', 'mart.wide'], ['metric:m1', 'dash:d1'], ['dash:d1', 'report:r1']]);
    const keep = relevantUpstream(graph, 'metric:m1');
    assert(keep.has('dash:d1') && keep.has('report:r1'), '谁用了这个指标要一路留到底');
    ok('下游一条都不剪');
  }

  // ── 6. 图的布局:节点超过上限时,上下游都得有 ─────────────────────────
  {
    /* 原来是 `[...level.keys()].slice(0, cap)` —— 按撞见的顺序截。
       而那个顺序是「焦点 → 上游 1/2/3 层 → 下游 1/2/3 层」,上游一多,
       下游就一个都排不上。界面上只写「80/340 节点」,看的人会以为那是
       有代表性的一部分,不会想到"下游是空的"其实是被截出来的。 */
    const nodes = [{ id: 'focus', label: 'focus', kind: 'table' }];
    const up = new Map(), down = new Map();
    const edges = [];
    const link = (from, to) => {
      edges.push({ from, to });
      if (!up.has(to)) up.set(to, []);
      up.get(to).push({ from, to });
      if (!down.has(from)) down.set(from, []);
      down.get(from).push({ from, to });
    };
    // 上游 200 个、下游 10 个,都挂在焦点的第 1 层
    for (let i = 0; i < 200; i++) { nodes.push({ id: `u${i}`, label: `u${i}`, kind: 'table' }); link(`u${i}`, 'focus'); }
    for (let i = 0; i < 10; i++) { nodes.push({ id: `d${i}`, label: `d${i}`, kind: 'table' }); link('focus', `d${i}`); }
    const graph = { nodes, edges, up, down };

    const out = layout(graph, 'focus');
    assert.equal(out.count, 80, '上限还是 80');
    assert.equal(out.total, 211, '总数照实报');
    const kept = [...out.placed.keys()];
    assert.ok(kept.includes('focus'), '焦点自己当然要在');
    const downKept = kept.filter((id) => id.startsWith('d'));
    const upKept = kept.filter((id) => id.startsWith('u'));
    assert.equal(downKept.length, 10, '下游只有 10 个,应该全留 —— 不能被上游挤光');
    assert.ok(upKept.length > 0, '上游也要有');
    assert.equal(upKept.length + downKept.length + 1, 80, '名额用满');
    ok('节点超上限时上下游按距离分配,下游不会被上游挤光');
  }

  console.log(`\n血缘:${passed} 项通过`);
} finally { rmSync(dir, { recursive: true, force: true }); }
