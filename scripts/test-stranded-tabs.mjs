// A tab whose connection is gone can neither open nor close itself, and the
// workspace is persisted, so restarting brings it back. These cover the cleanup
// and the feedback that replaced a silent no-op.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-stranded-'));
try {
  const outfile = join(dir, 'tests.cjs');
  buildSync({ stdin: { contents: "export {useApp} from './src/store/appStore'; export {api} from './src/lib/api';", resolveDir: resolve('.'), loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
  globalThis.document = { documentElement: { setAttribute() {}, lang: '' } };
  const { useApp, api } = createRequire(import.meta.url)(outfile);

  const alive = { id: 'alive', name: 'alive', kind: 'mysql', host: 'fixture.invalid', port: 3306, username: 'fixture' };
  api.listConnections = async () => [alive];

  const toasts = [];
  const tabs = [
    { id: 't1', kind: 'table', connId: 'deleted', connName: 'gone', database: 'db', schema: '', table: 'TEST', title: 'TEST' },
    { id: 't2', kind: 'database', connId: 'deleted', connName: 'gone', database: 'db', title: 'db' },
    { id: 't3', kind: 'query', connId: 'deleted', connName: 'gone', database: 'db', title: 'draft', sql: 'select 1' },
    { id: 't4', kind: 'table', connId: 'alive', connName: 'alive', database: 'db', schema: '', table: 'keep', title: 'keep' },
    { id: 't5', kind: 'python', connId: '', title: 'script.py' },
  ];
  useApp.setState({ language: 'zh-CN', tabs, activeTabId: 't1', connections: [], meta: {}, showToast: t => toasts.push(t) });

  await useApp.getState().refreshConnections();

  const ids = useApp.getState().tabs.map(t => t.id);
  assert.deepEqual(ids, ['t3', 't4', 't5'], 'object browsers for a deleted connection are closed; drafts and live tabs stay');
  assert(!ids.includes('t1') && !ids.includes('t2'), 'the stranded table and database tabs are gone');
  assert(ids.includes('t3'), 'a query tab keeps the SQL the user wrote, as when a database is dropped');
  assert(ids.includes('t5'), 'a python tab has no connection and must not be swept up');
  assert(useApp.getState().activeTabId !== 't1', 'the active tab moves off the one that was closed');

  // Clicking "connect and open" on a connection that no longer exists used to
  // return silently, so the button looked broken.
  await useApp.getState().connect('deleted');
  assert.equal(toasts.length, 1, 'connecting to a deleted connection reports why');
  assert.equal(toasts[0].kind, 'error');
  assert(toasts[0].text.includes('删除'), `unexpected message: ${toasts[0].text}`);

  // Auto-connect runs without a user waiting on a click and must stay quiet.
  await useApp.getState().connect('deleted', null, { automatic: true });
  assert.equal(toasts.length, 1, 'automatic connection attempts do not raise a toast');

  console.log('stranded tabs: 7 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
