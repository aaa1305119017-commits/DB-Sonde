// A dataset saved in one place has to be visible in another: the dashboard reads
// the same global list, and it is usually the first thing opened.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-datasets-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: {
      contents: "export {useDatasets} from './src/features/datasets/datasetsStore'; export {api} from './src/lib/api';",
      resolveDir: resolve('.'), loader: 'ts',
    },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
  const { useDatasets, api } = createRequire(import.meta.url)(outfile);

  let reads = 0;
  api.listDatasets = async () => {
    reads += 1;
    return [{
      schemaVersion: 1, id: 'ds1', name: '网点经营日汇总', connectionId: 'c1',
      source: { kind: 'join', base: { table: 'sales', alias: 't1' }, joins: [], columns: [] },
      fields: [{ name: 'amount', role: 'measure' }], updatedAt: '',
    }];
  };

  assert.deepEqual(useDatasets.getState().datasets, [], 'nothing is read until someone asks');
  assert.equal(useDatasets.getState().loaded, false);

  // The dashboard asks without opening the dataset panel.
  useDatasets.getState().ensureLoaded();
  await new Promise(r => setImmediate(r));
  assert.equal(reads, 1);
  assert.equal(useDatasets.getState().datasets.length, 1, 'a saved dataset reaches the dashboard');
  assert.equal(useDatasets.getState().loaded, true, 'an empty list and an unread list must be distinguishable');

  // Asking again is free; every widget inspector mounting must not refetch.
  useDatasets.getState().ensureLoaded();
  useDatasets.getState().ensureLoaded();
  await new Promise(r => setImmediate(r));
  assert.equal(reads, 1, 'ensureLoaded does not refetch once loaded');

  // Opening the panel still refreshes: another window may have changed them.
  useDatasets.getState().setOpen(true);
  await new Promise(r => setImmediate(r));
  assert.equal(reads, 2, 'opening the panel re-reads');

  // A failed read must not look like "loaded and empty", or the dashboard would
  // tell people to go create a dataset they already have.
  useDatasets.setState({ loaded: false, datasets: [] });
  api.listDatasets = async () => { throw new Error('backend down'); };
  await useDatasets.getState().load();
  assert.equal(useDatasets.getState().loaded, false, 'a failure leaves it unread, not empty');
  assert(useDatasets.getState().error);

  console.log('dataset availability: 9 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
