// AI 流式回答的收尾。两件事都会让**回答的结尾凭空少一截**,而且看不出来:
//
// 1) 最后一条 `data:` 不带换行时,它还留在 buffer 里 —— 循环里 `if (done) break`
//    直接跳过,那一段内容就没了。不少端点(LM Studio、自建代理)就是这么结束的。
// 2) 多字节字符正好跨在最后一块的边界上时,不 flush 解码器,那半个汉字就丢了。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-stream-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: { contents: `export { streamChat } from './src/features/ai/aiClient';`,
      resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };

  /** 把若干字节块当成一个 SSE 响应喂给 streamChat,返回它最终拿到的完整文本。 */
  const streamOf = async (chunks) => {
    const body = {
      getReader() {
        let i = 0;
        return { read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) };
      },
    };
    globalThis.fetch = async () => ({ ok: true, status: 200, body });
    const { streamChat } = createRequire(import.meta.url)(outfile);
    return await new Promise((done, fail) => {
      streamChat(
        { provider: 'local', local: { baseUrl: 'http://x', model: 'm' }, builtin: {}, cloud: {} },
        [{ role: 'user', content: 'hi' }],
        { onToken: () => {}, onDone: done, onError: fail });
    });
  };
  const line = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`;
  const bytes = (text) => new TextEncoder().encode(text);

  // 正常收尾:每行都有换行
  assert.equal(await streamOf([bytes(line('你好') + '\n' + line('世界') + '\ndata: [DONE]\n')]), '你好世界');

  // 最后一条不带换行 —— 原来这一段直接丢了
  assert.equal(await streamOf([bytes(line('你好') + '\n' + line('收尾这段'))]), '你好收尾这段',
    '最后一条 data: 不带换行时,那一段内容不能丢');

  // 多字节字符跨块:把「好」的三个字节劈成两块
  const whole = bytes(line('你好') + '\n');
  const cut = whole.length - 2;   // 落在最后一个汉字的字节中间
  assert.equal(await streamOf([whole.slice(0, cut), whole.slice(cut)]), '你好',
    '汉字被切在块边界上时不能丢');

  // 非法 JSON 只跳过那一行,不能把整个回答掐断
  assert.equal(await streamOf([bytes('data: {坏的\n' + line('后面还有') + '\n')]), '后面还有',
    '一行解析不了就跳过它,别让整个流断在这儿');

  console.log('stream: 4 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
