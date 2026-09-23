import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-feature-boundaries-'));
const require = createRequire(import.meta.url);
try {
  const bundle = join(dir, 'tests.cjs');
  buildSync({ stdin: { contents: [
    'lib/jsonStorage', 'lib/storedRepository', 'features/scheduler/connectionRepository',
    'features/lineage/edgeRepository', 'features/lineage/graphModel', 'features/etl/fileProfiles',
    'features/etl/fileScope', 'features/etl/fileCatalog', 'features/scheduler/definitionImport',
  ].map(path => `export * from './src/${path}';`).join('\n') + `
    export { useScheduler } from './src/features/scheduler/schedulerStore';
    export { useLineage } from './src/features/lineage/lineageStore';
    export { useEtl } from './src/features/etl/etlStore';
    export { api } from './src/lib/api';
  `, resolveDir: resolve('.'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
  async function fixture(initial = []) {
    const values = new Map(initial);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    delete require.cache[require.resolve(bundle)];
    const m = require(bundle);
    await m.schedulerConnections.initialize();
    m.useScheduler.setState({ conns: m.schedulerConnections.load() });
    return { m, values, storage };
  }
  const connKey = 'scheduler.conns.v1', edgesKey = 'sonde.lineage.v1', profilesKey = 'sonde.etl-file-profiles.v1';
  const conn = { id: 's1', name: 'Fixture', kind: 'dolphinscheduler', baseUrl: 'https://scheduler-a' };
  const edge = { from: 'erp.stock', to: 'mart.stock', kind: '写入', source: 'etl' };
  const profile = { id: 'a', name: 'Arbitrary directory', root: '/mnt/team-a', schedulerBaseUrl: conn.baseUrl,
    pathMappings: [{ from: '/runtime', to: '/mnt/team-a' }] };

  // Installed keys and records round-trip; one malformed record protects the entire original list.
  for (const [key, name, valid] of [[edgesKey, 'lineageEdges', edge], [profilesKey, 'fileProfileRepository', profile]]) {
    for (const raw of ['{bad', 'null', '{}', JSON.stringify([valid, { id: 'bad' }])]) {
      const { m, values } = await fixture([[key, raw]]);
      assert.deepEqual(m[name].load(), []);
      if (key === profilesKey) assert.throws(() => m.requireFileProfiles(), /阻止覆盖/);
      assert.throws(() => m[name].save([valid]), /阻止覆盖/);
      assert.equal(values.get(key), raw);
      values.set(key, JSON.stringify([valid]));
      assert.deepEqual(m[name].load(), [valid]);
      m[name].save([valid]);
      assert(!m.getStorageProblems().some(problem => problem.key === key));
    }
  }
  {
    const { m } = await fixture();
    assert.equal(m.isSchedulerConnection({ ...conn, token: 123 }), false);
    assert.equal(m.isSchedulerConnection({ ...conn, kind: [conn.kind] }), false);
    assert.equal(m.isLineageEdge({ ...edge, source: [edge.source] }), false);
    assert.equal(m.isFileProfile({ ...profile, pathMappings: [{ from: '', to: '/data' }] }), false);
    assert.equal(m.isFileProfile({ ...profile, port: 65536 }), false);
    assert.throws(() => m.schedulerConnections.save([conn, conn]), /格式无效/);
    // The same repository contract can run with a different persistence adapter.
    let saved;
    const repository = m.storedRepository('test', () => [], Array.isArray, {
      read: (_key, fallback) => saved ?? fallback, write: (_key, value) => { saved = value; },
    });
    repository.save([1]);
    assert.deepEqual(repository.load(), [1]);
  }
  // Disk full must not close the scheduler form, delete a connection, or clear scanned evidence.
  {
    const { m, values, storage } = await fixture([[connKey, JSON.stringify([conn])], [edgesKey, JSON.stringify([edge])]]);
    const scheduler = m.useScheduler, lineage = m.useLineage;
    assert.deepEqual(scheduler.getState().conns, [conn], JSON.stringify(m.getStorageProblems()));
    scheduler.getState().editConn(conn);
    scheduler.setState({ activeId: conn.id });
    lineage.setState({ selected: edge.to });
    const write = storage.setItem;
    const secureSave = m.schedulerConnections.save;
    m.schedulerConnections.save = async () => { throw Error("vault unavailable"); };
    storage.setItem = () => { throw Error('quota'); };
    await scheduler.getState().saveConn({ ...conn, name: 'Changed' });
    assert.equal(scheduler.getState().conns[0].name, conn.name);
    assert(scheduler.getState().form);
    assert.equal(scheduler.getState().toast.tone, 'crit');
    await scheduler.getState().removeConn(conn.id);
    assert.equal(scheduler.getState().activeId, conn.id);
    lineage.getState().clearScanned();
    lineage.getState().forgetNode(edge.to);
    assert.deepEqual(lineage.getState().scanned, [edge]);
    assert.equal(lineage.getState().selected, edge.to);
    assert.match(lineage.getState().lastMsg, /保存失败/);
    assert.equal(values.get(edgesKey), JSON.stringify([edge]));
    storage.setItem = write;
    m.schedulerConnections.save = secureSave;
    await scheduler.getState().saveConn({ ...conn, name: 'Changed' });
    assert.equal(scheduler.getState().conns[0].name, 'Changed');
    assert.equal(scheduler.getState().form, null);
    lineage.getState().clearScanned();
    assert.deepEqual(lineage.getState().scanned, []);
  }
  {
    const { m, storage } = await fixture([[edgesKey, JSON.stringify([edge])]]);
    const job = { id: 'query-reader', name: 'Query reader', kind: 'generic',
      sources: [{ kind: 'db', querySql: 'SELECT * FROM erp.stock' }], targets: [{ kind: 'db', database: 'mart', table: 'stock' }] };
    m.useEtl.setState({ sources: [{ id: 'source', name: 'Source', kind: 'generic', jobs: [job], updatedAt: 0 }] });
    m.api.pySqlLineage = async () => { throw Error('parser unavailable'); };
    await m.useLineage.getState().scanEtl();
    assert.deepEqual(m.useLineage.getState().scanned, [edge]);
    assert.match(m.useLineage.getState().lastMsg, /保留上次/);
    assert.equal(m.useLineage.getState().busy, null);
    const sqlFailure = await m.useLineage.getState().addSqlEdges('bad', undefined, 'target');
    assert.match(sqlFailure.error, /parser unavailable/);
    m.api.pySqlLineage = async () => ({ ok: true, sources: ['erp.new_stock'] });
    storage.setItem = () => { throw Error('quota'); };
    await m.useLineage.getState().scanEtl();
    assert.deepEqual(m.useLineage.getState().scanned, [edge]);
    assert.equal(m.useLineage.getState().busy, null);
    assert.match(m.useLineage.getState().lastMsg, /保存失败/);
  }
  {
    const { m } = await fixture();
    const makeJob = (id, file, database) => ({ id, name: id, kind: 'generic', references: [file],
      sources: [{ kind: 'db', database, table: 'source' }], targets: [{ kind: 'db', database, table: 'target' }],
      flows: [{ sources: [{ kind: 'db', database, table: 'source' }], targets: [{ kind: 'db', database, table: 'target' }] }] });
    const fileA = makeJob('file-a', '/mnt/team-a/job.sql', 'a');
    const fileB = makeJob('file-b', '/mnt/team-b/job.sql', 'b');
    const srcA = { id: 'files:a', name: 'A', kind: 'generic', jobs: [fileA], schedulerBaseUrl: conn.baseUrl + '/', updatedAt: 1 };
    const srcB = { id: 'files:b', name: 'B', kind: 'generic', jobs: [fileB], schedulerBaseUrl: 'https://scheduler-b', updatedAt: 1 };
    const profileB = { ...profile, id: 'b', schedulerBaseUrl: srcB.schedulerBaseUrl, pathMappings: [{ from: '/runtime', to: '/mnt/team-b' }] };
    assert.equal(m.resolveReference('/runtime/job.sql', ['/mnt/team-a/job.sql', '/mnt/team-b/job.sql'],
      [...profile.pathMappings, ...profileB.pathMappings]), undefined);
    assert.equal(m.resolveReference('/mnt/team-a/job.sql', ['/mnt/team-a/job.sql', '/mnt/team-a/job.sql']), undefined);
    assert.equal(m.resolveReference('/runtime/special/job.sql', ['/specific/job.sql'],
      [{ from: '/runtime', to: '/all' }, { from: '/runtime/special', to: '/specific' }]), '/specific/job.sql');
    const scope = m.schedulerFileScope(conn.baseUrl, [srcB, srcA], [profileB, profile]);
    assert.deepEqual(scope.files, [fileA]);
    assert.deepEqual(scope.pathMappings, profile.pathMappings);
    assert.deepEqual(m.schedulerFileScope('', [srcA, srcB], [profile]).files, []);
    const workflow = { code: 'w', name: 'Load', online: false, scheduled: false };
    const definition = { tasks: [
      { code: 'q', name: 'SQL', type: 'SQL', params: { sql: 'bad sql' } },
      { code: 's', name: 'Shell', type: 'SHELL', params: { rawScript: 'run /runtime/job.sql' } },
    ], relations: [{ from: 'q', to: 's' }] };
    const tasks = await m.importWorkflowDefinition(conn, 'p', workflow, definition,
      { ...scope, parseSql: async () => { throw Error('parser unavailable'); } });
    assert.equal(tasks.length, 2, 'optional parser failure preserves other tasks and dependency structure');
    assert.match(tasks[0].note, /无法静态解析/);
    assert.deepEqual(tasks[1].scheduler.upstreamTaskCodes, ['q']);
    assert.equal(tasks[1].sources[0].database, 'a', 'foreign scheduler mapping cannot win by array order');
    const simple = await m.importWorkflowDefinition(conn, 'p', workflow, { tasks: [definition.tasks[0]], relations: [] },
      { files: [], parseSql: async () => ({ ok: true, sources: ['erp.a'], target: 'mart.a' }) });
    assert.equal(simple[0].targets[0].table, 'mart.a', 'parser without optional flows is sufficient');
    const preserved = await m.importWorkflowDefinition(conn, 'p', workflow, { tasks: [definition.tasks[0]], relations: [] },
      { files: [], previousJobs: simple, parseSql: async () => ({ ok: false, sources: [] }) });
    assert.deepEqual(preserved[0].targets, simple[0].targets);
    assert.match(preserved[0].note, /尚未重新验证/);
    const ordinary = { id: 'ordinary', name: 'Ordinary', kind: 'generic', jobs: [fileB], updatedAt: 0 };
    const tasksSource = { id: 'task-source', name: 'Tasks', kind: 'generic', jobs: tasks, updatedAt: 0 };
    const previous = [srcB, ordinary, tasksSource];
    const original = JSON.stringify(previous);
    const unassociated = { ...srcA, schedulerBaseUrl: undefined };
    assert.deepEqual(m.fileScanUpdates(unassociated, previous, [profile]), [unassociated]);
    const updates = m.fileScanUpdates(srcA, previous, [profile, profileB]);
    assert.deepEqual(updates.map(source => source.id), ['files:a', 'task-source']);
    assert.equal(JSON.stringify(previous), original);
    const graph = m.buildLineageGraph([edge], [tasksSource], []);
    assert(graph.edges.some(edge => edge.kind === '任务依赖'));
    assert.deepEqual(m.buildLineageGraph([], [], []).nodes, [], 'one graph cannot inherit another graph global data');
    assert.equal(m.dedup([{ ...edge, from: 'a|b', to: 'c' }, { ...edge, from: 'a', to: 'b|c' }]).length, 2);
    assert.deepEqual(m.mergeScannedEdges([edge], [], 'etl', false), [edge]);
    assert.deepEqual(m.mergeScannedEdges([edge], [], 'etl', true), []);
    m.useEtl.setState({ sources: previous });
    let writes = 0;
    globalThis.localStorage.setItem = () => { writes++; throw Error('quota'); };
    assert.throws(() => m.useEtl.getState().upsertSources(updates), /保存失败/);
    assert.equal(writes, 1, 'linked scan publishes all ETL updates through a single write');
    assert.strictEqual(m.useEtl.getState().sources, previous);
  }
  console.log('Feature boundary checks passed: legacy storage, failed saves, pure graph, injected parser, isolated directories and atomic ETL publication.');
} finally { rmSync(dir, { recursive: true, force: true }); }
