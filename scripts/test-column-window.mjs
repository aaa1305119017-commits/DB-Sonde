// 横向虚拟化的取窗口计算。一千多列的交叉表全塞进 DOM 会让整个应用卡死,但列数不该被限制
// —— 那是人家的数据。所以只画视口里那些,两边垫占位把滚动条顶住。
// 这里的不变量:无论画哪一段,padLeft + 窗口内各列宽 + padRight 必须等于全量宽度,
// 不然滚动条长度会变、位置会跳。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-colwin-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: { contents: `export { columnWindow } from './src/features/dashboard/columnWindow';`, resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  const { columnWindow } = createRequire(import.meta.url)(outfile);

  // 3 个冻结的维度列(150) + 1347 个指标列(130) —— 就是用户那张表。
  const widths = [150, 150, 150, ...Array.from({ length: 1347 }, () => 130)];
  const frozen = 3;
  const totalWidth = widths.reduce((t, w) => t + w, 0);
  const viewport = 1200;

  const intact = (win, frozenCount = frozen) => {
    let inner = 0;
    for (let i = win.from; i < win.to; i += 1) inner += widths[i];
    const frozenWidth = widths.slice(0, frozenCount).reduce((t, w) => t + w, 0);
    assert.equal(win.padLeft + inner + win.padRight + frozenWidth, totalWidth,
      '两边的占位加上画出来的列必须凑够全量宽度,否则滚动条会变长变短');
  };

  // 开头:只画视口 + overscan 那一段,不是一千多列。
  const head = columnWindow(widths, frozen, 0, viewport);
  assert.equal(head.from, frozen, '从第一个非冻结列开始');
  assert(head.to - head.from < 40, `开头只画十几列,实际 ${head.to - head.from}`);
  assert.equal(head.padLeft, 0);
  assert(head.padRight > 100000, '右边要垫上剩下的宽度');
  intact(head);

  // 滚到中间:左右都有占位,画的还是那么几列。
  const mid = columnWindow(widths, frozen, 80000, viewport);
  assert(mid.from > frozen, '前面的列跳过了');
  assert(mid.to - mid.from < 40, `中间也只画十几列,实际 ${mid.to - mid.from}`);
  assert(mid.padLeft > 0 && mid.padRight > 0);
  intact(mid);

  // 滚到底:右边没有多余占位。
  const tail = columnWindow(widths, frozen, totalWidth - viewport, viewport);
  assert.equal(tail.to, widths.length, '最后一列要画出来');
  assert.equal(tail.padRight, 0);
  intact(tail);

  // 列少的时候不该有任何窗口行为 —— 普通明细表就该整张画。
  const few = [150, 150, 130, 130];
  const all = columnWindow(few, 2, 0, viewport);
  assert.deepEqual(all, { from: 2, to: 4, padLeft: 0, padRight: 0 }, '装得下就全画');

  // 还没量到可视宽度时(首帧)不能瞎猜:猜小了会先画几列再补,看着就是闪一下。
  const unmeasured = columnWindow(widths, frozen, 0, 0);
  assert.equal(unmeasured.to, widths.length, '量不到宽度就先全画,别闪');

  // 冻结列浮在左边挡着内容,可视区要从它们右边算起,否则一开始就少画一屏。
  const noFrozen = columnWindow(widths, 0, 0, viewport);
  assert.equal(noFrozen.from, 0);
  intact(noFrozen, 0);

  console.log('column window: 15 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
