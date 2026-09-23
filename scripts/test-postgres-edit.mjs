import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
const dir = mkdtempSync(join(tmpdir(), 'sonde-pg-edit-'));
const pg = new PGlite();
try {
  const output = join(dir, 'query.json');
  execFileSync('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', 'postgres_edit_query_fixture'],
    { env: { ...process.env, SONDE_TEST_PG_QUERY: output }, stdio: 'pipe' });
  const { sql, params } = JSON.parse(readFileSync(output, 'utf8'));
  await pg.exec("CREATE TABLE items(id bigint PRIMARY KEY, name text); INSERT INTO items VALUES (9007199254740992,'before'),(9007199254740993,'before');");
  assert.equal((await pg.query(sql, params)).affectedRows, 1);
  assert.deepEqual((await pg.query('SELECT id::text id, name FROM items ORDER BY id')).rows,
    [{id:'9007199254740992',name:'before'},{id:'9007199254740993',name:'after'}]);
  assert.equal((await pg.query(sql, params)).affectedRows, 0, 'stale old value refuses overwrite');
  params[0] = JSON.stringify({ name: null }); params[2] = JSON.stringify({ name: 'after' });
  assert.equal((await pg.query(sql, params)).affectedRows, 1);
  params[0] = JSON.stringify({ name: 'restored' }); params[2] = JSON.stringify({ name: null });
  assert.equal((await pg.query(sql, params)).affectedRows, 1, 'SQL NULL optimistic guard works');
  console.log('PostgreSQL edit: actual Rust-generated SQL executes; exact bigint identity, stale value and NULL guards verified.');
} finally { await pg.close(); rmSync(dir, { recursive: true, force: true }); }
