// 两种「代码看着没毛病、数据一多就卡到打字都跟不上」的写法。都是真出过事的:
// 带图例维度的折线图,一万八千行,每次重渲染烧掉一秒多主线程 —— 表现是整个应用一顿一顿,
// 而不是那张图自己慢,所以很难往图表上想。导出的网页同理,首屏一秒多。
//
// 1) 往累加器里塞东西时整体复制一遍:  m.set(k, [...(m.get(k) ?? []), row])
//    每加一行都把该组已有的行抄一遍,一个组两万行就是两亿次复制。push 就行。
// 2) 在排序的比较函数里扫全表:        .sort((a, b) => ... rows.filter(...) ...)
// 4) 流式输出逐行 setState:        setOut(o => [...o, line]) 长在事件监听里
//    比较函数会被调用 O(n log n) 次,里面再扫一遍全表就是平方级。
//    总量先各算一次存起来,再照着排。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

/** 从 `.sort(` 往后配对括号,取出比较函数的函数体。 */
function sortBodies(source) {
  const bodies = [];
  for (let i = source.indexOf('.sort('); i >= 0; i = source.indexOf('.sort(', i + 1)) {
    let depth = 0;
    for (let j = i + 5; j < source.length; j += 1) {
      const ch = source[j];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) { bodies.push(source.slice(i, j + 1)); break; }
      }
    }
  }
  return bodies;
}

export function scanSource(raw) {
  /* 先把注释去掉再扫 —— 守卫该看代码,不该看散文。
     否则「不要写 Math.min(...values)」这句注释本身就会被判成违规(真发生过)。
     顺带会把字符串里的 `//`(比如 http://)也当注释切掉,对这几条规则无所谓。 */
  const blank = (text) => text.replace(/[^\n]/g, " ");   // 换成等长空白,保住行号和列号
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
  const problems = [];
  // 1) 复制式累加
  if (/\.set\(\s*[^,]+,\s*\[\s*\.\.\./.test(source)) problems.push('往 Map 里塞东西时整体复制了一遍(用 push)');
  if (/\[\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*\[\s*\.\.\.\s*\1\s*\[/.test(source)) problems.push('往对象数组里塞东西时整体复制了一遍(用 push)');
  /* 3) Math.min(...values):参数展开有引擎级上限,二十万个数在 Node/WebKit 上都是
        直接 RangeError。数组长度只要是用户数据说了算的(选中一整列、一个分组的行、
        明细表的列合计),迟早撞上。用 lib/numbers.ts 里的 minOf / maxOf(循环版)。 */
  /* 注释是用空白顶掉的(不是删掉),所以行号跟原文件对得上 —— 报一个对不上的行号,
     看的人得自己在文件里翻,守卫就白写了。 */
  for (const m of source.matchAll(/Math\.(min|max)\(\s*\.\.\./g)) {
    const at = source.slice(0, m.index).split("\n").length;
    problems.push(`第 ${at} 行把数组展开进 Math.${m[1]} —— 长数组会 RangeError,改用 lib/numbers 的 ${m[1] === "min" ? "minOf" : "maxOf"}`);
  }
  /* 4) 流式输出逐行 setState:`setX(v => [...v, line])` 长在一个事件监听里。
        每来一行都把整个数组复制一遍、再重绘一次 —— Python 脚本或 pip 打印五万行
        就是五万次全量复制加五万次渲染,界面卡死。用 hooks/useBatchedLines 攒批
        (**不是截断**:一行不少,只是不逐行重绘)。
        只盯"文件里同时有 Tauri 事件监听"的情况 —— 点击处理器里追加一条是正常的。 */
  if (/listen[<(][^)]*:\/\/[a-z]+"/.test(source) || /listen<\{[^}]*runId/.test(source)) {
    for (const m of source.matchAll(/set[A-Z]\w*\(\s*\(?\s*(\w+)\)?\s*=>\s*\[\s*\.\.\.\s*\1\s*,/g)) {
      const at = source.slice(0, m.index).split("\n").length;
      problems.push(`第 ${at} 行:流式输出在逐行 setState 追加(整个数组复制一遍再重绘)—— 用 hooks/useBatchedLines`);
    }
  }
  // 2) 比较函数里扫全表
  for (const body of sortBodies(source)) {
    if (/\.filter\s*\(/.test(body)) problems.push(`排序的比较函数里扫了全表: ${body.replace(/\s+/g, ' ').slice(0, 90)}…`);
  }
  return problems;
}

/* 这两种写法在哪儿都不对 —— 全项目一起盯。原来只扫看板目录,而血缘图给整个边集建邻接表
   时用的正是复制式累加:中心节点(维表那种)度数一高就是平方级,每次渲染血缘视图都跑一遍。
   只盯一个目录的守卫,挡不住同一个毛病换个地方长出来。 */
const roots = ['src'];
const files = roots.flatMap(walk).filter((f) => /\.(ts|tsx|js)$/.test(f) && !f.endsWith('.d.ts'));
let checked = 0;
for (const file of files) {
  const problems = scanSource(readFileSync(file, 'utf8'));
  assert.deepEqual(problems, [], `${file}:\n  - ${problems.join('\n  - ')}`);
  checked += 1;
}

// 守卫自己得管用:把当初那两种写法塞回去,必须被逮住。
assert.equal(scanSource('m.set(k, [...(m.get(k) ?? []), row]);').length, 1, '复制式累加要能认出来');
assert.equal(scanSource('keys.sort((a, b) => total(rows.filter(r => key(r) === b)) - 1);').length, 1, '比较函数里扫全表要能认出来');
assert.deepEqual(scanSource('keys.sort((a, b) => totals[b] - totals[a]);'), [], '正常的排序别误伤');
assert.deepEqual(scanSource('bucket.push(row);'), [], '正常的 push 别误伤');
assert.equal(scanSource('const m = Math.min(...values);').length, 1, '展开进 Math.min 要能认出来');
assert.deepEqual(scanSource('const m = Math.min(a, b);'), [], '两个参数的 Math.min 别误伤');

console.log(`render complexity: ${checked} 个文件(全项目),没有随数据量平方增长的写法`);
