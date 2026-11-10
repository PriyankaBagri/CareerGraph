import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { readMigrations, runMigrations } from '../src/db/migrations';
import { PAYMENT_STATUSES } from '../src/repositories/payment-types';
import { FakeDb } from './helpers';

const dir = fileURLToPath(new URL('../migrations', import.meta.url));
const raw = readFileSync(join(dir, '006_payments.sql'), 'utf8').replace(/--.*$/gm, ''); // comments removed, so only real statements are checked
const code = raw.replace(/ON DELETE CASCADE/g, ''); // FK actions are not data deletes

describe('migration 006 (static review)', () => {
  it('is ordered after 001-005, which are still present under their original names', () => {
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().slice(0, 6), ['001_initial_schema.sql', '002_auth_profile.sql', '003_career_core.sql', '004_evaluation_rules.sql', '005_mentorship.sql', '006_payments.sql']);
  });
  it('is additive and re-runnable: one new table, IF NOT EXISTS everywhere, nothing dropped, rewritten or altered', () => {
    for (const bad of [/DROP\s/i, /TRUNCATE/i, /\bDELETE\b/i, /\bUPDATE\b/i, /RENAME/i, /ALTER\s/i, /INSERT\s/i]) assert.ok(!bad.test(code), String(bad));
    for (const stmt of code.split(';').map((s) => s.trim()).filter(Boolean)) assert.match(stmt, /IF NOT EXISTS/i, stmt.slice(0, 60));
    assert.deepEqual([...code.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]), ['payments']);
  });
  it('stores money as numeric, never floating point or the money type', () => {
    assert.match(code, /amount\s+numeric\(10, 2\) NOT NULL CHECK \(amount > 0\)/); assert.ok(!/\b(real|double precision|float\w*|money)\b/i.test(code));
  });
  it('ties each payment to a booking and a user, and its statuses match the code', () => {
    assert.match(raw, /booking_id\s+uuid NOT NULL REFERENCES bookings \(id\) ON DELETE CASCADE/); assert.match(raw, /user_id\s+uuid NOT NULL REFERENCES users \(id\) ON DELETE CASCADE/);
    assert.match(code, new RegExp(`status IN \\(${PAYMENT_STATUSES.map((s) => `'${s}'`).join(', ')}\\)`));
    assert.match(code, /payments_completed_has_capture CHECK \(status <> 'completed' OR paypal_capture_id IS NOT NULL\)/);
  });
  it('enforces unique PayPal ids and one live and one completed payment per booking in the database', () => {
    assert.match(code, /UNIQUE INDEX IF NOT EXISTS payments_order_idx ON payments \(paypal_order_id\)/);
    assert.match(code, /UNIQUE INDEX IF NOT EXISTS payments_capture_idx ON payments \(paypal_capture_id\) WHERE paypal_capture_id IS NOT NULL/);
    assert.match(code, /UNIQUE INDEX IF NOT EXISTS payments_one_active_idx ON payments \(booking_id\) WHERE status = 'created'/);
    assert.match(code, /UNIQUE INDEX IF NOT EXISTS payments_one_completed_idx ON payments \(booking_id\) WHERE status = 'completed'/);
    assert.match(code, /payments_booking_idx ON payments \(booking_id, created_at DESC\)/); assert.match(code, /payments_user_idx ON payments \(user_id\)/);
  });
  it('stores no secrets or card data: only order/capture ids, amount, currency and status', () => {
    const cols = [...code.matchAll(/^\s+(\w+)\s+(?:uuid|text|numeric|char|timestamptz)/gm)].map((m) => m[1]);
    assert.deepEqual(cols, ['id', 'booking_id', 'user_id', 'paypal_order_id', 'paypal_capture_id', 'amount', 'currency', 'status', 'created_at', 'updated_at']);
  });
  it('is picked up by the migration runner in order, once, and skipped on a second run', async () => {
    const db = new FakeDb(); const all = readMigrations(dir);
    const first = await runMigrations(db, all); assert.ok(first.applied.includes('006_payments.sql')); assert.deepEqual(first.applied, all.map((m) => m.name));
    assert.deepEqual((await runMigrations(db, all)).applied, []); assert.ok(db.queries.some((q) => /CREATE TABLE IF NOT EXISTS payments/.test(q.text)));
  });
});
