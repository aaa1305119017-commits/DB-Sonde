import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

// Every fixture runs against isolated in-memory storage, never user files or a database.
const dir = mkdtempSync(join(tmpdir(), 'sonde-resilience-'));
const require = createRequire(import.meta.url);
try {
  const bundle = join(dir, 'tests.cjs');
  buildSync({ stdin: { contents: [
    'lib/jsonStorage', 'lib/workspaceSession', 'store/workspacePersistence', 'store/treePreferences',
  ].map(path => `export * from './src/${path}';`).join('\n') + "\nexport { useApp } from './src/store/appStore';", resolveDir: resolve('.'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
  function fixture(initial = [], denied = false) {
    const values = new Map(initial);
    const storage = { getItem: key => { if (denied) throw Error('Access denied'); return values.get(key) ?? null; },
      setItem: (key, value) => values.set(key, value) };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    delete require.cache[require.resolve(bundle)];
    return { m: require(bundle), values, storage };
  }

  const query = { kind: 'query', id: 'q', savedId: 's', title: 'Saved query', sql: 'SELECT 1',
    connId: 'fixture', connName: 'Fixture', running: false, executions: [], activeExecutionIndex: 0, view: 'grid' };
  const saved = { id: 's', name: query.title, sql: query.sql, updatedAt: 0 };
  const savedKey = 'sonde.savedQueries.v1';
  const workspaceKey = 'sonde.workspace.v1';
  const snapshot = { version: 1, tabs: [{ ...query, sql: undefined }], activeTabId: 'q' };

  // Unknown formats cannot be silently converted to an empty workspace on the next save.
  {
    const bad = '{broken';
    const newer = JSON.stringify({ ...snapshot, version: 2 });
    const { m, values } = fixture([[savedKey, bad], [workspaceKey, newer],
      ['sonde.connOrder.v1', '{}'], ['sonde.nodeOrder.v1', '{"parent":17}'], ['sonde.hiddenNodes.v1', 'null']]);
    assert.deepEqual(m.useApp.getState().tabs, []);
    assert.deepEqual(m.useApp.getState().savedQueries, []);
    assert.deepEqual(m.loadConnOrder(), []);
    assert.deepEqual(m.loadNodeOrder(), {});
    assert.deepEqual(m.loadHidden(), []);
    assert.throws(() => m.persistSavedQueries([saved]), /阻止覆盖/);
    assert.throws(() => m.persistWorkspace(m.useApp.getState()), /阻止覆盖/);
    assert.equal(values.get(savedKey), bad);
    assert.equal(values.get(workspaceKey), newer);
    assert.equal(m.getStorageProblems().length, 5);
    values.delete(savedKey);
    assert.deepEqual(m.loadSavedQueries(), []);
    m.persistSavedQueries([saved]);
    assert.equal(m.getStorageProblems().some(issue => issue.key === savedKey), false, 'repair by removal clears blocked state');
    assert.throws(() => m.persistWorkspace(m.useApp.getState()), /阻止覆盖/, 'workspace version still protected');
  }
  // A valid workspace referring to unreadable saved scripts is also preserved.
  {
    const raw = JSON.stringify(snapshot);
    const { m, values } = fixture([[savedKey, 'null'], [workspaceKey, raw]]);
    assert.throws(() => m.persistWorkspace(m.useApp.getState()));
    assert.equal(values.get(workspaceKey), raw);
  }
  {
    const { m } = fixture([], true);
    assert.equal(m.useApp.getState().theme, 'dark');
    assert.equal(m.useApp.getState().language, 'zh-CN');
    assert.deepEqual(m.useApp.getState().tabs, []);
    assert(m.getStorageProblems().length > 0, 'storage access failure is visible without crashing startup');
  }
  // Failed writes never present success or mutate persisted-facing application state.
  {
    const { m, values, storage } = fixture([[savedKey, JSON.stringify([saved])]]);
    const notices = [];
    const app = m.useApp;
    app.setState({ tabs: [query], savedQueries: [saved], dirtyTabs: {}, activeTabId: 'q',
      connections: [{id:'a'}, {id:'b'}], rootKeys: ['conn:a', 'conn:b'], hiddenKeys: [],
      nodeOrder: {}, nodes: { parent: { key: 'parent', childKeys: ['first', 'second'] } }, showToast: notice => notices.push(notice) });
    const setItem = storage.setItem;
    storage.setItem = () => { throw Error('QuotaExceededError'); };
    const before = app.getState();
    app.getState().renameTab('q', 'Changed');
    assert.strictEqual(app.getState().tabs, before.tabs);
    assert.strictEqual(app.getState().savedQueries, before.savedQueries);
    app.getState().deleteSavedQuery('s');
    assert.strictEqual(app.getState().savedQueries, before.savedQueries);
    assert.equal(app.getState().tabs[0].savedId, 's');
    app.getState().setNodeHidden('first', true);
    app.getState().reorderConnections('a', 'b');
    app.getState().reorderChild('parent', 'first', 'second');
    assert.strictEqual(app.getState().hiddenKeys, before.hiddenKeys);
    assert.strictEqual(app.getState().connections, before.connections);
    assert.strictEqual(app.getState().nodeOrder, before.nodeOrder);
    assert.strictEqual(app.getState().nodes, before.nodes);
    app.setState({ tabs: [{ ...query, sql: 'SELECT 2' }] });
    app.getState().saveTab('q');
    assert.equal(app.getState().savedQueries[0].sql, 'SELECT 1');
    assert(m.isUnsavedTab(app.getState().tabs[0], app.getState()));
    assert(notices.every(notice => notice.kind === 'error'));
    assert.equal(JSON.parse(values.get(savedKey))[0].name, 'Saved query');
    m.loadSavedQueries();
    assert(m.getStorageProblems().some(issue => issue.key === savedKey && issue.kind === 'write'), 'reading old data must not claim the failed edit was saved');
    const pending = m.getStorageProblems();
    assert.strictEqual(m.getStorageProblems(), pending, 'external-store snapshot is stable without changes');
    let changes = 0;
    const unsubscribe = m.subscribeStorageProblems(() => changes++);
    storage.setItem = setItem;
    app.getState().saveTab('q');
    assert.equal(app.getState().savedQueries[0].sql, 'SELECT 2');
    assert.equal(JSON.parse(values.get(savedKey))[0].sql, 'SELECT 2');
    assert(!m.getStorageProblems().some(issue => issue.key === savedKey));
    assert(changes > 0, 'successful retry clears persistent error notice');
    unsubscribe();
    m.writeStoredJson('serialization', [1]);
    assert.throws(() => m.writeStoredJson('serialization', undefined));
    assert.equal(values.get('serialization'), '[1]');
  }
  {
    const { m } = fixture();
    assert(m.isSavedQueries([{ id: 'old', name: 'Legacy', sql: 'SELECT 1' }]));
    assert(!m.isSavedQueries([saved, saved]), 'duplicate identities are rejected');
    assert(!m.isSavedQueries([{ ...saved, sql: null }]));
    assert(m.isWorkspaceSnapshot(snapshot));
    assert(!m.isWorkspaceSnapshot({ ...snapshot, tabs: [snapshot.tabs[0], snapshot.tabs[0]] }));
    assert(!m.isWorkspaceSnapshot({ ...snapshot, tabs: [{ ...query, kind: 'future-feature' }] }));
    assert(!m.isWorkspaceSnapshot({ ...snapshot, tabs: [{ ...query, kind: 'table' }] }));
    assert.deepEqual(m.orderChildKeys('toString', ['a', 'b'], {}), ['a', 'b']);
  }
  console.log('Resilience checks passed: corrupted/newer storage preservation, dependent workspace protection, denied access, atomic save/rename/delete/reorder, legacy compatibility, persistent failure recovery.');
} finally { rmSync(dir, { recursive: true, force: true }); }
