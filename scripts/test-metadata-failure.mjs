import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-metadata-failure-'));
try {
  const outfile = join(dir, 'tests.cjs');
  buildSync({ stdin: { contents: `export * from './src/lib/metadataFailure';`, resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const m = createRequire(import.meta.url)(outfile);

  /* 真机:打开一个视图,整页只剩一行驱动原话
     `1267 (HY000): Illegal mix of collations (utf8mb4_unicode_ci,COERCIBLE) ...`。
     那不是工具坏了,是**那个视图自己的定义**有问题 —— 查列时 MySQL 要先解析视图体。
     分不清这点的人会以为客户端坏了,去重装、去换工具。 */
  const collation = "error returned from database: 1267 (HY000): Illegal mix of collations "
    + "(utf8mb4_unicode_ci,COERCIBLE) and (utf8mb4_0900_ai_ci,COERCIBLE) for operation '='";

  const view = m.explainMetadataFailure([0, 1], collation, 'view');
  assert.ok(view.includes('列、索引'), '要说清是哪几块没取到:' + view);
  assert.ok(view.includes('其余照常显示'), '得让人知道别的还在 —— 这正是这次修复的重点');
  assert.ok(view.includes('视图定义本身的问题'), '要点明责任在视图,不是在工具:' + view);
  assert.ok(view.includes('COLLATE'), '要给能动手的做法');
  assert.ok(view.includes('DDL'), '要指路:DDL 还在,去那儿看是哪个比较');
  assert.ok(view.includes(collation), '数据库原话要保留 —— 转述不能替代原文');

  // 表(不是视图)不该说"视图定义有问题"
  const table = m.explainMetadataFailure([0], collation, 'table');
  assert.ok(!table.includes('视图'), '普通表别扯视图:' + table);
  assert.ok(table.includes('COLLATE'));

  // 不认识的错误照样要说清哪块没取到,并原样附上原话
  const unknown = m.explainMetadataFailure([2], 'connection reset', 'view');
  assert.ok(unknown.includes('DDL没能取到') && unknown.includes('connection reset'), unknown);
  assert.ok(!unknown.includes('COLLATE'), '别给不相干的建议');

  console.log('Metadata failure messages passed: partial loss is named, blame is placed correctly, driver text is kept.');
} finally { rmSync(dir, { recursive: true, force: true }); }
