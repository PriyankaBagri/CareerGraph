import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// Static checks only (no PostgreSQL here): migration 002 must add only what 001 lacks, and every column the PostgreSQL repository
// uses must exist once 001 + 002 are applied. This guards against column typos that the in-memory tests cannot see.
const dir = join(import.meta.dirname, '..');
const strip = (s: string) => s.replace(/--.*$/gm, '');
const m1 = strip(readFileSync(join(dir, 'migrations', '001_initial_schema.sql'), 'utf8'));
const m2 = strip(readFileSync(join(dir, 'migrations', '002_auth_profile.sql'), 'utf8'));
const pgSrc = readFileSync(join(dir, 'src', 'repositories', 'pg.ts'), 'utf8');

function columns(table: string): Set<string> {
  const body = new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`).exec(m1)?.[1] ?? '';
  const cols = new Set(body.split('\n').map((l) => /^\s{2}(\w+)\s/.exec(l)?.[1]).filter((c): c is string => !!c && !['PRIMARY', 'UNIQUE', 'CHECK'].includes(c)));
  for (const m of m2.matchAll(new RegExp(`ALTER TABLE ${table} ADD COLUMN (\\w+)`, 'g'))) cols.add(m[1]);
  for (const m of m2.matchAll(/ALTER TABLE (\w+) RENAME COLUMN (\w+) TO (\w+)/g)) if (m[1] === table) { cols.delete(m[2]); cols.add(m[3]); }
  return cols;
}
const list = (name: string) => new RegExp(`const ${name} = '([^']+)'`).exec(pgSrc)?.[1].split(',').map((s) => s.trim()) ?? [];

describe('migration 002 (static)', () => {
  it('adds only columns that 001 does not already have', () => {
    const before = (t: string) => new RegExp(`CREATE TABLE ${t} \\(([\\s\\S]*?)\\n\\);`).exec(m1)?.[1] ?? '';
    assert.ok(!/\bupdated_at\b/.test(before('users'))); assert.ok(!/\babout_note\b/.test(before('profiles'))); assert.match(before('profiles'), /\beducation\b/);
    assert.match(m2, /ALTER TABLE users ADD COLUMN updated_at/); assert.match(m2, /ALTER TABLE profiles ADD COLUMN about_note/); assert.match(m2, /RENAME COLUMN education TO education_summary/);
    assert.ok(!/CREATE TABLE (users|profiles)/.test(m2), 'tables are not duplicated');
  });
  it('keeps the database-level guarantees: unique email, one profile per user, cascade', () => {
    assert.match(m1, /CREATE UNIQUE INDEX users_email_lower_idx ON users \(lower\(email\)\)/);
    assert.match(columnsBody('profiles'), /user_id\s+uuid PRIMARY KEY REFERENCES users \(id\) ON DELETE CASCADE/);
    assert.match(m2, /users_email_normalized CHECK \(email = lower\(btrim\(email\)\)/);
    assert.ok(!/password\s+text/i.test(m1 + m2) && /password_hash\s+text NOT NULL/.test(m1));
  });
  it('makes optional profile fields nullable and bounds their length', () => {
    assert.match(m2, /ALTER COLUMN education_summary DROP NOT NULL/); assert.match(m2, /ALTER COLUMN experience_summary DROP NOT NULL/);
    assert.match(m2, /about_note IS NULL OR char_length\(about_note\) <= 500/);
  });
  it('every column the PostgreSQL repository uses exists after 001 + 002', () => {
    const users = columns('users'), profiles = columns('profiles');
    const userCols = list('USER_COLS'), profileCols = list('PROFILE_COLS');
    assert.ok(userCols.length === 6 && profileCols.length === 11);
    for (const c of userCols) assert.ok(users.has(c), `users.${c} missing`);
    for (const c of profileCols) assert.ok(profiles.has(c), `profiles.${c} missing`);
    const patch = [...pgSrc.matchAll(/'(target_career_id|experience_summary|education_summary|about_note)'/g)].map((m) => m[1]);
    for (const c of patch) assert.ok(profiles.has(c), `profiles.${c} missing`);
    for (const c of ['name', 'updated_at']) assert.ok(users.has(c));
  });
  it('the repository only builds SQL from fixed column names and bound parameters', () => {
    assert.match(pgSrc, /PATCH_COLUMNS/); assert.ok(!/\$\{[^}]*(patch|req|body|input)\b[^}]*\}\s*(FROM|WHERE|SET|VALUES)/.test(pgSrc));
    for (const q of pgSrc.matchAll(/query<[^>]*>\(`([^`]*)`/g)) assert.ok(!/\$\{(?!USER_COLS|PROFILE_COLS|\[)/.test(q[1]) || /\$\{\[\.\.\.sets/.test(q[1]), q[1].slice(0, 60));
  });
});
function columnsBody(table: string) { return new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`).exec(m1)?.[1] ?? ''; }
