import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readMigrations, runMigrations, type MigrationFile } from '../src/db/migrations';
import { FakeDb } from './helpers';

const mk = (name: string, sql: string): MigrationFile => ({ name, sql, checksum: `sum:${sql}` });
describe('migration runner', () => {
  it('reads real migration files in order with checksums', () => {
    const real = readMigrations(join(import.meta.dirname, '..', 'migrations'));
    assert.ok(real.length >= 1); assert.equal(real[0].name, '001_initial_schema.sql'); assert.match(real[0].checksum, /^[0-9a-f]{64}$/);
  });
  it('rejects badly named files and sorts the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    writeFileSync(join(dir, '002_b.sql'), 'SELECT 2;'); writeFileSync(join(dir, '001_a.sql'), 'SELECT 1;');
    assert.deepEqual(readMigrations(dir).map((m) => m.name), ['001_a.sql', '002_b.sql']);
    writeFileSync(join(dir, 'oops.sql'), 'SELECT 3;');
    assert.throws(() => readMigrations(dir), /must be named like/);
  });
  it('applies pending migrations in order, in one transaction, under an advisory lock', async () => {
    const db = new FakeDb();
    const r = await runMigrations(db, [mk('001_a.sql', 'CREATE TABLE a ();'), mk('002_b.sql', 'CREATE TABLE b ();')]);
    assert.deepEqual(r.applied, ['001_a.sql', '002_b.sql']); assert.equal(db.committed, 1);
    assert.match(db.queries[0].text, /pg_advisory_xact_lock/);
    const order = db.queries.map((q) => q.text).filter((t) => /CREATE TABLE [ab] /.test(t));
    assert.deepEqual(order, ['CREATE TABLE a ();', 'CREATE TABLE b ();']);
  });
  it('is idempotent: a second run applies nothing', async () => {
    const db = new FakeDb(); const m = [mk('001_a.sql', 'CREATE TABLE a ();')];
    await runMigrations(db, m); const again = await runMigrations(db, m);
    assert.deepEqual(again.applied, []); assert.deepEqual(again.skipped, ['001_a.sql']);
    assert.equal(db.queries.filter((q) => q.text === 'CREATE TABLE a ();').length, 1);
  });
  it('applies only the new migration on a later run', async () => {
    const db = new FakeDb(); await runMigrations(db, [mk('001_a.sql', 'A;')]);
    const r = await runMigrations(db, [mk('001_a.sql', 'A;'), mk('002_b.sql', 'B;')]);
    assert.deepEqual(r.applied, ['002_b.sql']);
  });
  it('refuses to continue if an applied migration was edited', async () => {
    const db = new FakeDb(); await runMigrations(db, [mk('001_a.sql', 'A;')]);
    await assert.rejects(() => runMigrations(db, [mk('001_a.sql', 'A edited;')]), /changed after it was applied/);
  });
  it('rolls everything back when a migration fails', async () => {
    const db = new FakeDb(); db.failOn = /FAIL/;
    await assert.rejects(() => runMigrations(db, [mk('001_a.sql', 'OK;'), mk('002_b.sql', 'FAIL;')]), /simulated/);
    assert.equal(db.rolledBack, 1); assert.equal(db.applied.size, 0, 'nothing recorded as applied');
  });
});
