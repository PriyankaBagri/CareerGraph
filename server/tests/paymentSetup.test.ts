import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NO_PAYPAL } from '../src/config';
import { DEMO_MENTORS } from '../src/domain/demoMentors';
import { missingTables } from '../src/db/setupCheck';
import { FakePayPal, SECRET } from './fakePayPal';
import { makeApp } from './helpers';

// Regression: a missing payments table used to surface only as an opaque 500 ("Something went wrong") when the buyer pressed Pay.
const S1 = DEMO_MENTORS[0].sessions[0];
async function setup() {
  const fake = new FakePayPal();
  const app = makeApp({ config: { paypal: { ...NO_PAYPAL, clientId: 'cid-TEST', clientSecret: SECRET, timeoutMs: 30 }, clientOrigins: ['http://localhost:5173'] }, paypalFetch: fake.fetch });
  const u = (await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email: 'a@x.com', password: 'Passw0rdOK1' } })).body as { token: string };
  const id = (await app.call('POST', '/api/bookings', { token: u.token, body: { sessionId: S1.id } })).body.booking.id as string;
  return { app, fake, u, id };
}
const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe('payment setup problems are reported clearly', () => {
  it('answers 503 database_not_migrated (with the fix) when the payments table does not exist, and never calls PayPal', async () => {
    const t = await setup();
    t.app.repos.listPayments = async () => { throw pgError('42P01', 'relation "payments" does not exist'); };
    const r = await t.app.call('POST', '/api/payments/create-order', { token: t.u.token, body: { bookingId: t.id } });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'database_not_migrated');
    assert.match(r.body.error.message, /db:migrate/); assert.ok(!/relation|payments"/.test(r.body.error.message), 'driver text must not reach the browser');
    assert.equal(t.fake.calls.length, 0);
  });
  it('still hides any other unexpected error behind a generic 500', async () => {
    const t = await setup();
    t.app.repos.listPayments = async () => { throw pgError('XX000', 'secret driver detail'); };
    const r = await t.app.call('POST', '/api/payments/create-order', { token: t.u.token, body: { bookingId: t.id } });
    assert.equal(r.status, 500); assert.equal(r.body.error.code, 'internal_error'); assert.ok(!JSON.stringify(r.body).includes('secret driver detail'));
  });
  it('startup check lists exactly the missing feature tables', async () => {
    const present = new Set(['mentors', 'mentor_sessions', 'bookings']);
    const db = { query: async (_s: string, p?: unknown[]) => ({ rows: (p?.[0] as string[]).map((name) => ({ name, found: present.has(name) ? name : null })), rowCount: 0 }) };
    assert.deepEqual(await missingTables(db as never), ['payments']);
    present.add('payments'); assert.deepEqual(await missingTables(db as never), []);
  });
});
