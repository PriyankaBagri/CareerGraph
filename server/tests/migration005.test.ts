import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { DEMO_MENTORS } from '../src/domain/demoMentors';
import { readMigrations, runMigrations } from '../src/db/migrations';
import { buildMentorshipSeedStatements, runMentorshipSeed } from '../src/db/seedMentorship';
import { BOOKING_STATUSES } from '../src/repositories/mentorship-types';
import { FakeDb } from './helpers';

const dir = fileURLToPath(new URL('../migrations', import.meta.url));
const withFkActions = readFileSync(join(dir, '005_mentorship.sql'), 'utf8').replace(/--.*$/gm, ''); // comments removed, so only real statements are checked
const code = withFkActions.replace(/ON DELETE (CASCADE|RESTRICT)/g, ''); // FK actions are not data deletes

describe('migration 005 (static review)', () => {
  it('is ordered after 001-004, which are still present under their original names', () => {
    const names = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    assert.deepEqual(names.slice(0, 5), ['001_initial_schema.sql', '002_auth_profile.sql', '003_career_core.sql', '004_evaluation_rules.sql', '005_mentorship.sql']);
  });
  it('is additive and re-runnable: it creates only new objects, with IF NOT EXISTS, and never drops, rewrites or alters', () => {
    for (const bad of [/DROP\s/i, /TRUNCATE/i, /\bDELETE\b/i, /\bUPDATE\b/i, /RENAME/i, /ALTER\s/i]) assert.ok(!bad.test(code), String(bad));
    for (const stmt of code.split(';').map((s) => s.trim()).filter(Boolean)) assert.match(stmt, /IF NOT EXISTS/i, stmt.slice(0, 60));
    assert.deepEqual([...code.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]), ['mentors', 'mentor_sessions', 'bookings']);
  });
  it('stores money as numeric, never floating point or the money type', () => {
    assert.equal([...code.matchAll(/numeric\(10, 2\)/g)].length, 2); // mentor_sessions.price and bookings.amount
    assert.ok(!/\b(real|double precision|float\w*|money)\b/i.test(code));
  });
  it('keeps statuses, ownership, price checks and the one-pending-booking rule in the database', () => {
    assert.match(code, new RegExp(`status IN \\(${BOOKING_STATUSES.map((s) => `'${s}'`).join(', ')}\\)`));
    assert.match(withFkActions, /user_id\s+uuid NOT NULL REFERENCES users \(id\) ON DELETE CASCADE/); assert.match(withFkActions, /session_id uuid NOT NULL REFERENCES mentor_sessions \(id\) ON DELETE RESTRICT/);
    assert.match(code, /CHECK \(price > 0\)/); assert.match(code, /CHECK \(amount > 0\)/); assert.match(code, /is_demo\s+boolean NOT NULL DEFAULT false/);
    assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_pending_idx ON bookings \(user_id, session_id\) WHERE status = 'pending_payment'/);
    assert.match(code, /bookings_user_idx ON bookings \(user_id, created_at DESC\)/);
  });
  it('is picked up by the migration runner in order, once, and skipped on a second run', async () => {
    const db = new FakeDb(); const all = readMigrations(dir);
    const first = await runMigrations(db, all); assert.ok(first.applied.includes('005_mentorship.sql')); assert.deepEqual(first.applied, all.map((m) => m.name));
    assert.deepEqual((await runMigrations(db, all)).applied, []);
    assert.ok(db.queries.some((q) => /CREATE TABLE IF NOT EXISTS bookings/.test(q.text)));
  });
});

describe('demo mentor seed', () => {
  const stmts = buildMentorshipSeedStatements();
  it('is clearly demo data: every mentor is flagged is_demo and says it is not a real or verified professional', () => {
    assert.ok(DEMO_MENTORS.length >= 3);
    for (const m of DEMO_MENTORS) { assert.match(m.displayName, /^Demo Mentor/); assert.match(m.bio, /not a real or verified professional/); }
    assert.ok(stmts.filter((s) => /INTO mentors /.test(s.text)).every((s) => /VALUES \(\$1, \$2, \$3, \$4, \$5, true\)/.test(s.text)));
  });
  it('has valid, unique ids and sane illustrative prices', () => {
    const sessions = DEMO_MENTORS.flatMap((m) => m.sessions), ids = [...DEMO_MENTORS.map((m) => m.id), ...sessions.map((s) => s.id)];
    assert.equal(new Set(ids).size, ids.length);
    for (const s of sessions) { assert.match(s.price, /^\d{1,6}\.\d{2}$/); assert.ok(Number(s.price) > 0 && Number(s.price) <= 200); assert.match(s.currency, /^[A-Z]{3}$/); assert.ok(s.durationMinutes >= 15 && s.durationMinutes <= 240); }
  });
  it('is idempotent, fully parameterized, parents before children, and never touches bookings or users', async () => {
    // Every statement is an upsert, or a link row that is simply skipped when it already exists.
    for (const s of stmts) { assert.match(s.text, /ON CONFLICT (\(id\) DO UPDATE|DO NOTHING)/); assert.match(s.text, /\$1/); }
    const order = stmts.map((s) => /INSERT INTO (\w+)/.exec(s.text)?.[1]);
    assert.ok(order.lastIndexOf('mentors') < order.indexOf('mentor_sessions')); assert.ok(order.lastIndexOf('mentors') < order.indexOf('mentor_fields'));
    assert.equal(stmts.filter((s) => /INTO (bookings|users)\b/.test(s.text)).length, 0);
    const db = new FakeDb(); const r = await runMentorshipSeed(db); await runMentorshipSeed(db);
    assert.equal(r.mentors, DEMO_MENTORS.length); assert.equal(db.committed, 2); assert.equal(db.queries.length, stmts.length * 2);
  });
});
