// "Save the dashboard as HTML, then load it back and keep editing" is the whole
// point of the export — these lock the round trip so a change to either side
// cannot quietly break it.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { esbuildExportAssets } from '../vite/exportAssets.mjs';

// Vite's `?raw` suffix inlines a file as a string; esbuild needs to be taught it.
const rawPlugin = {
  name: 'vite-raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => {
      const spec = args.path.replace(/\?raw$/, '');
      // Relative next to the importer, or a bare package path like
      // "echarts/dist/echarts.min.js" that lives in node_modules.
      const path = spec.startsWith('.')
        ? resolve(args.resolveDir, spec)
        : createRequire(import.meta.url).resolve(spec);
      return { path, namespace: 'vite-raw' };
    });
    build.onLoad({ filter: /.*/, namespace: 'vite-raw' }, args => ({
      contents: `export default ${JSON.stringify(readFileSync(args.path, 'utf8'))}`,
      loader: 'js',
    }));
  },
};

const dir = mkdtempSync(join(tmpdir(), 'sonde-roundtrip-'));
try {
  const outfile = join(dir, 'tests.cjs');
  await build({
    stdin: {
      contents: `
        export { buildDashboardHtml } from './src/features/dashboard/export/htmlExport';
        export { parseDashboardHtml, isDashboardHtml } from './src/features/dashboard/export/htmlImport';
        export { parseDashboardFile } from './src/features/dashboard/transfer';
        export { createDashboard } from './src/features/dashboard/domain';
      `,
      resolveDir: resolve('.'),
      loader: 'ts',
    },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [esbuildExportAssets(resolve('.')), rawPlugin],
  });
  const { buildDashboardHtml, parseDashboardHtml, isDashboardHtml, parseDashboardFile, createDashboard } =
    createRequire(import.meta.url)(outfile);

  // A blank board is what opening the designer should hand you.
  const blank = createDashboard('未命名看板');
  assert.equal(blank.widgets.length, 0, 'a new dashboard starts with no widgets');

  const widget = {
    ...blank,
    id: 'w1', type: 'bar', title: '网点销售',
    layout: { x: 0, y: 0, w: 6, h: 4 },
    datasetId: 'ds1',
    bindings: { dimensions: ['store'], metrics: ['m1'] },
    options: { metrics: {} },
  };
  const baked = {
    title: '销售看板', description: '按网点', generatedAt: new Date().toISOString(),
    scope: { start: '2026-01-01', end: '2026-01-31' },
    widgets: [{
      widget, metrics: { primary: [], secondary: [] }, drillDimensions: [],
      data: { base: { columns: ['store', 'amount'], rows: [['A店', 1], ['B店', 2]] } },
    }],
  };

  const html = await buildDashboardHtml(baked);
  assert(html.includes('<html'), 'export produces a standalone page');
  assert(isDashboardHtml(html), 'an exported page is recognised as importable');

  const back = parseDashboardHtml(html);
  assert(back, 'the exported page parses back into a dashboard');
  assert.equal(back.title, '销售看板', 'the title survives the round trip');
  assert.equal(back.widgets.length, 1, 'widgets survive the round trip');
  assert.equal(back.widgets[0].title, '网点销售');
  assert.equal(back.widgets[0].type, 'bar');
  assert.equal(back.status, 'draft', 'it comes back editable, not published');
  assert.notEqual(back.id, baked.id, 'import lands as a new document and cannot overwrite an existing one');

  // The picker accepts both formats; the file name alone must not decide it.
  const viaFile = parseDashboardFile(html, 'exported.html');
  assert.equal(viaFile.from, 'html');
  assert.equal(viaFile.doc.widgets.length, 1);
  const asJson = parseDashboardFile(JSON.stringify({ ...blank, widgets: [widget] }), 'board.json');
  assert.equal(asJson.from, 'json');
  assert.equal(asJson.doc.widgets.length, 1, 'JSON import still works');

  assert.equal(parseDashboardHtml('<html><body>not ours</body></html>'), null, 'an unrelated page is rejected');

  console.log('dashboard round trip: 13 assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
