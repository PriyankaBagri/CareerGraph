import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// Static lint of the SQL. It does NOT replace running the migration on PostgreSQL, but it catches ordering and typo mistakes.
const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '001_initial_schema.sql'), 'utf8').replace(/--.*$/gm, '');
const tables = new Map<string, { body: string; index: number }>();
for (const m of sql.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) tables.set(m[1], { body: m[2], index: m.index ?? 0 });

describe('initial schema (static checks)', () => {
  it('defines every table the domain needs', () => {
    for (const t of ['users', 'profiles', 'careers', 'career_capabilities', 'skills', 'career_skills', 'custom_careers', 'skill_assessments', 'evidence', 'evidence_skills', 'readiness_snapshots', 'gaps', 'actions', 'roadmap_items', 'user_settings'])
      assert.ok(tables.has(t), `missing table ${t}`);
  });
  it('creates referenced tables before the tables that reference them', () => {
    for (const [name, { body, index }] of tables) for (const r of body.matchAll(/REFERENCES (\w+) \((\w+)\)/g)) {
      const target = tables.get(r[1]); assert.ok(target, `${name} references unknown table ${r[1]}`);
      assert.ok(r[1] === name || target.index < index, `${name} is created before ${r[1]}`);
      assert.match(target.body, new RegExp(`\\b${r[2]}\\b`), `${r[1]} has no column ${r[2]}`);
    }
  });
  it('every index targets an existing table and existing columns', () => {
    const indexes = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX (\w+) ON (\w+) \((.*)\);/g)];
    assert.ok(indexes.length >= 10);
    for (const m of indexes) {
      const t = tables.get(m[2]); assert.ok(t, `index ${m[1]} on unknown table ${m[2]}`);
      for (const col of m[3].replace(/lower\((\w+)\)/g, '$1').split(',').map((c) => c.trim().split(/\s+/)[0])) assert.ok(new RegExp(`\\b${col}\\b`).test(t.body), `${m[1]}: ${m[2]} has no column ${col}`);
    }
  });
  it('is well-formed: balanced parentheses, statements end with semicolons', () => {
    assert.equal((sql.match(/\(/g) ?? []).length, (sql.match(/\)/g) ?? []).length);
    assert.equal(sql.trim().endsWith(';'), true);
  });
  it('isolates per-user data and keeps assessments honest', () => {
    for (const t of ['profiles', 'skill_assessments', 'evidence', 'readiness_snapshots', 'actions', 'roadmap_items', 'user_settings', 'custom_careers'])
      assert.match(tables.get(t)?.body ?? '', /user_id\s+uuid[^,]*REFERENCES users \(id\) ON DELETE CASCADE/, `${t} must belong to a user`);
    assert.match(tables.get('skill_assessments')?.body ?? '', /BETWEEN 0 AND 5/);
    assert.match(tables.get('readiness_snapshots')?.body ?? '', /'not_assessed', 'partial', 'assessed'/);
    assert.match(tables.get('actions')?.body ?? '', /UNIQUE \(user_id, career_id, action_key\)/);
    assert.ok(!/password\s+text/i.test(sql), 'only a hash column may exist');
  });
});
