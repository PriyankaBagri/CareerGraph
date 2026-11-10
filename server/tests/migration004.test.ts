import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { COLUMNS_004 } from '../src/repositories/pg-core';
import { readMigrations } from '../src/db/migrations';

const dir = fileURLToPath(new URL('../migrations', import.meta.url));
const sql = readFileSync(join(dir, '004_evaluation_rules.sql'), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('migration 004 (static review)', () => {
  it('is ordered after 001-003 and the first three files are untouched in name and number', () => {
    const names = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    assert.deepEqual(names.slice(0, 4), ['001_initial_schema.sql', '002_auth_profile.sql', '003_career_core.sql', '004_evaluation_rules.sql']); // later migrations are allowed after these
    assert.ok(readMigrations(dir).length >= 4);
  });
  it('is additive: no DROP TABLE/COLUMN, TRUNCATE, DELETE, UPDATE, RENAME or type change', () => {
    for (const bad of [/DROP\s+TABLE/i, /DROP\s+COLUMN/i, /TRUNCATE/i, /\bDELETE\b/i, /\bUPDATE\b/i, /RENAME/i, /ALTER\s+COLUMN/i, /DROP\s+SCHEMA/i, /DROP\s+DATABASE/i]) assert.ok(!bad.test(code), String(bad));
  });
  it('is re-runnable: every ADD COLUMN uses IF NOT EXISTS, and its own constraints are dropped IF EXISTS before being added', () => {
    for (const stmt of code.split(';').map((s) => s.trim()).filter(Boolean)) {
      if (/ADD COLUMN/i.test(stmt)) assert.match(stmt, /IF NOT EXISTS/i, stmt);
      if (/ADD CONSTRAINT/i.test(stmt)) assert.ok(code.includes(`DROP CONSTRAINT IF EXISTS ${/ADD CONSTRAINT\s+(\w+)/i.exec(stmt)?.[1]}`), stmt);
    }
  });
  it('adds exactly the columns the repository optionally reads, both nullable (NULL = built-in defaults)', () => {
    for (const [table, cols] of Object.entries(COLUMNS_004)) for (const c of cols) assert.match(code, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${c} (jsonb|smallint);`), `${table}.${c}`);
    assert.ok(!/NOT NULL/i.test(code));
  });
});
