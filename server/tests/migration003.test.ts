import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { COLUMNS } from '../src/repositories/pg-core';
import { buildSeedStatements } from '../src/db/seeding';
import { CAREER_DATASETS } from '../src/domain/shared';

// Static checks only (no PostgreSQL here). They do NOT prove the migration runs on PostgreSQL.
const dir = join(import.meta.dirname, '..');
const strip = (s: string) => s.replace(/--.*$/gm, '');
const read = (f: string) => strip(readFileSync(join(dir, 'migrations', f), 'utf8'));
const m1 = read('001_initial_schema.sql'), m2 = read('002_auth_profile.sql'), m3 = read('003_career_core.sql');

function cols(table: string): Set<string> {
  const body = new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`).exec(m1)?.[1] ?? '';
  const out = new Set(body.split('\n').map((l) => /^\s{2}(\w+)\s/.exec(l)?.[1]).filter((c): c is string => !!c && !['PRIMARY', 'UNIQUE', 'CHECK'].includes(c)));
  for (const m of (m2 + m3).matchAll(/ALTER TABLE (\w+)([\s\S]*?);/g)) if (m[1] === table) for (const a of m[2].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?(\w+)/g)) out.add(a[1]);
  return out;
}
describe('migration 003 (static)', () => {
  it('never drops tables/columns or deletes data, and is re-runnable', () => {
    assert.ok(!/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i.test(m3));
    for (const m of m3.matchAll(/ADD COLUMN (?!IF NOT EXISTS)/g)) assert.fail(`non-idempotent ADD COLUMN ${m[0]}`);
    for (const m of m3.matchAll(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/g)) assert.fail(`non-idempotent index ${m[0]}`);
    const adds = [...m3.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1]);
    assert.ok(adds.length >= 3);
    for (const c of adds) assert.match(m3, new RegExp(`DROP CONSTRAINT IF EXISTS ${c}`), `${c} is not drop-then-add`);
  });
  it('only adds columns that 001/002 do not already define', () => {
    for (const m of m3.matchAll(/ALTER TABLE (\w+)([\s\S]*?);/g)) for (const a of m[2].matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)) {
      const before = new RegExp(`CREATE TABLE ${m[1]} \\(([\\s\\S]*?)\\n\\);`).exec(m1)?.[1] ?? '';
      assert.ok(!new RegExp(`^\\s{2}${a[1]}\\s`, 'm').test(before), `${m[1]}.${a[1]} already exists in 001`);
    }
  });
  it('gives the PostgreSQL repository only columns that exist after 001-003', () => {
    for (const [table, list] of Object.entries(COLUMNS)) { const have = cols(table); assert.ok(have.size, `unknown table ${table}`); for (const c of list) assert.ok(have.has(c), `${table}.${c} does not exist`); }
  });
  it('keeps the profile.target_career_id foreign key from 001 and 001 unmodified in shape', () => {
    assert.match(m1, /target_career_id\s+text REFERENCES careers \(id\)/);
  });
  it('indexes evidence by user and every migration-003 index targets real columns', () => {
    for (const m of m3.matchAll(/CREATE INDEX IF NOT EXISTS (\w+) ON (\w+) \((.*)\);/g))
      for (const col of m[3].replace(/lower\((\w+)\)/g, '$1').split(',').map((c) => c.trim().split(/\s+/)[0])) assert.ok(cols(m[2]).has(col), `${m[1]}: ${m[2]}.${col}`);
    assert.match(m3, /evidence_user_type_idx ON evidence \(user_id, type\)/);
  });
  it('seed fills the new columns (importance, skill category) with valid values', () => {
    const st = buildSeedStatements(CAREER_DATASETS);
    const req = st.filter((s) => s.text.includes('INSERT INTO career_skills '));
    assert.ok(req.length > 0 && req.every((s) => s.text.includes('importance')));
    assert.ok(st.filter((s) => s.text.includes('INSERT INTO skills ')).every((s) => s.text.includes('category') && typeof s.params[2] === 'string'));
  });
});

// SQL-shape checks for the PostgreSQL repository using a recording Db. They prove user scoping in the SQL text, not real execution.
import { createPgCoreRepos } from '../src/repositories/pg-core';
import { FakeDb } from './helpers';
describe('pg core repository SQL (recorded, not executed)', () => {
  it('scopes every user-owned query by the authenticated user id in $1 and never interpolates values', async () => {
    const db = new FakeDb(); const r = createPgCoreRepos(db); const U = 'user-1', E = '11111111-1111-4111-8111-111111111111';
    await r.listAssessments(U); await r.getAssessment(U, 's'); await r.upsertAssessment(U, 's', 3, 'self').catch(() => {}); await r.deleteAssessment(U, 's');
    await r.listEvidence(U); await r.getEvidence(U, E); await r.deleteEvidence(U, E); await r.linkEvidenceSkill(U, E, 's'); await r.unlinkEvidenceSkill(U, E, 's');
    await r.updateEvidence(U, E, { title: "x'; DROP TABLE evidence;--" }).catch(() => {});
    assert.ok(db.queries.length >= 9);
    for (const q of db.queries) {
      assert.ok(q.params?.includes(U), `user id not bound: ${q.text}`);
      assert.ok(!/DROP TABLE|user-1/.test(q.text), 'values are never interpolated');
      if (/FROM evidence e|UPDATE evidence|DELETE FROM evidence |INSERT INTO evidence_skills/.test(q.text) && !/INTO evidence_skills.*unnest/.test(q.text)) assert.match(q.text, /user_id\s*=\s*\$(1|2)/, q.text);
    }
  });
});
