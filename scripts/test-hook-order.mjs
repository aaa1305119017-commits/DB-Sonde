// React 的 hook 必须每次渲染都按同样的顺序调用。写在提前 return 之后的话,走那条
// 分支时就少调几个,React 报「Rendered more hooks than during the previous render」
// 并把整块组件换成错误页 —— 白屏,而且只在某个分支下才复现。
//
// 这个项目里已经栽过两次(一次是数据集面板的 useMemo,一次是组件渲染器的),
// 都是改完当场白屏才发现的。没装 eslint,就自己扫一遍 AST。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve('src');
const files = [];
(function walk(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.tsx$/.test(path)) files.push(path);
  }
})(root);

const isHook = (node) =>
  ts.isCallExpression(node)
  && ts.isIdentifier(node.expression)
  && /^use[A-Z]/.test(node.expression.text);

/** 组件函数体里:先出现 return,之后又出现 hook 调用 —— 那就是条件调用。 */
function offendersIn(body, source) {
  const found = [];
  let returnedAt = -1;
  const visitTop = (statements) => {
    for (const statement of statements) {
      // 只看顶层语句:嵌套在 if/for 里的 return 也算提前退出,所以一并记。
      let hasReturn = false;
      const scan = (node) => {
        if (ts.isReturnStatement(node)) hasReturn = true;
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return; // 回调里的不算
        ts.forEachChild(node, scan);
      };
      scan(statement);

      if (returnedAt >= 0) {
        const hooks = [];
        const look = (node) => {
          if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
          if (isHook(node)) hooks.push(node.expression.text);
          ts.forEachChild(node, look);
        };
        look(statement);
        for (const name of hooks) {
          found.push({ name, line: source.getLineAndCharacterOfPosition(statement.pos).line + 1 });
        }
      }
      if (hasReturn && returnedAt < 0) returnedAt = statement.pos;
    }
  };
  visitTop(body.statements);
  return found;
}

const problems = [];
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    const isComponent = (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node))
      && node.name && /^[A-Z]/.test(node.name.text) && node.body;
    if (isComponent) {
      for (const hit of offendersIn(node.body, source)) {
        problems.push(`${relative(root, file)}:${hit.line} ${node.name.text} 在提前 return 之后调用了 ${hit.name}()`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

assert.deepEqual(problems, [], `hook 调用顺序会变:\n  ${problems.join('\n  ')}\n把这些 hook 挪到所有 return 之前。`);
console.log(`hook order: ${files.length} 个组件文件,没有条件调用的 hook`);
