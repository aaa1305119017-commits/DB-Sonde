// DDL 美化。三件必须守住的事:
//   1) 视图头原样 —— 格式化器会把 DEFINER=`app`@`%` 拆成 `app` @`%`;
//   2) 只改空白和关键字大小写 —— 美化不能改 DDL 的意思;
//   3) 出意外就退回原文 —— 宁可难看,不能看到的不是真 DDL。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-ddl-'));
let n = 0;
const ok = (name) => { n += 1; console.log(`  ✓ ${name}`); };
try {
  const outfile = join(dir, 't.cjs');
  await build({ entryPoints: [resolve('src/lib/formatDdl.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  const { formatDdl } = createRequire(import.meta.url)(outfile);
  const squash = (s) => s.replace(/\s+/g, '').toLowerCase();

  // ── MySQL 视图:SHOW CREATE VIEW 的原样输出是一整行 ─────────────────────
  const view = "CREATE ALGORITHM=UNDEFINED DEFINER=`app`@`%` SQL SECURITY DEFINER VIEW `review_tag_v` AS select `e`.`id` AS `id`,(case when ((`e`.`content` like '%slow%') or (`e`.`content` like '%late%')) then 'delivery' else 'other' end) AS `tag` from `ods`.`reviews` `e` where (`e`.`score` <= 2)";
  const v = formatDdl(view, 'mysql');
  assert(v.formatted, '一行的视图 DDL 应该被格式化');
  assert(v.text.includes('\n'), '格式化后要分行');
  assert(v.text.startsWith('CREATE ALGORITHM=UNDEFINED DEFINER=`app`@`%` SQL SECURITY DEFINER VIEW `review_tag_v` AS'),
    '视图头必须原样 —— `app`@`%` 中间不能插空格');
  assert(!v.text.includes('`app` @'), '账号写法被拆开了');
  assert(/\n\s*SELECT\b/.test(v.text) && /\n\s*FROM\b/.test(v.text), 'SELECT / FROM 应各起一行');
  assert(/\n\s+CASE\b/.test(v.text) || /\n\s+WHEN\b/.test(v.text), 'CASE WHEN 应分行缩进');
  assert.equal(squash(v.text), squash(view), '去掉空白后必须和原文逐字一致');
  ok('MySQL 视图:查询体分行缩进,视图头原样,语义不变');

  // ── 带列清单的视图:列清单里没有 AS,头部不能截错 ───────────────────────
  const withCols = "CREATE VIEW `v` (`a`,`b`) AS select 1 AS `a`,2 AS `b`";
  const c = formatDdl(withCols, 'mysql');
  assert(c.text.startsWith('CREATE VIEW `v` (`a`,`b`) AS'), '列清单要跟在头部里原样保留');
  assert.equal(squash(c.text), squash(withCols));
  ok('带列清单的视图:头部截到第一个 AS');

  // ── MySQL 表:已经多行,格式化后仍然只改空白 ────────────────────────────
  const table = "CREATE TABLE `orders` (\n  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',\n  `amount` decimal(18,2) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单'";
  const t = formatDdl(table, 'mysql');
  assert.equal(squash(t.text), squash(table), '表 DDL 格式化后语义必须不变');
  assert(t.text.includes("COMMENT '主键'") && t.text.includes("'订单'"), '中文注释原样保留');
  ok('MySQL 表:只改空白,注释原样');

  // ── 表名/注释里出现 VIEW 字样,不能被当成视图头 ──────────────────────
  const tricky = "CREATE TABLE `t` (`id` int COMMENT 'view count AS total') ENGINE=InnoDB";
  const k = formatDdl(tricky, 'mysql');
  assert.equal(squash(k.text), squash(tricky), '注释里的 VIEW ... AS 不能触发视图头截断');
  ok('注释里的 VIEW/AS 不会被误认成视图头');

  // ── 各方言都能走通 ─────────────────────────────────────────────────────
  const simple = 'create view v as select a, b from t where a > 1';
  for (const kind of ['mysql', 'mariadb', 'postgres', 'sqlite', 'oracle', 'clickhouse', undefined]) {
    const r = formatDdl(simple, kind);
    assert(r.formatted, `${kind ?? '未知'} 方言应能格式化`);
    assert.equal(squash(r.text), squash(simple), `${kind ?? '未知'} 方言改了语义`);
  }
  ok('六种方言 + 未知方言都能格式化,且语义不变');

  // ── 回退 ───────────────────────────────────────────────────────────────
  assert.deepEqual(formatDdl('', 'mysql'), { text: '', formatted: false }, '空 DDL 原样返回');
  assert.deepEqual(formatDdl('   ', 'mysql'), { text: '   ', formatted: false });
  const garbage = 'CREATE TABLE ((( ))) ``` ;;; )))';
  const g = formatDdl(garbage, 'mysql');
  assert.equal(squash(g.text), squash(garbage), '格式化器出意外时必须退回原文,不能给出改过的东西');
  ok('空 / 畸形 DDL 退回原文');

  console.log(`DDL format: ${n} 项通过`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
