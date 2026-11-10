import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NO_PAYPAL } from '../src/config';
import { diagnosePayPal } from '../src/payments/diagnose';
import { FakePayPal, SECRET } from './fakePayPal';
import { DEMO_MENTORS } from '../src/domain/demoMentors';
import { makeApp } from './helpers';

const cfg = { ...NO_PAYPAL, clientId: 'cid-TEST', clientSecret: SECRET, timeoutMs: 30 };
const BASE = 'http://localhost:5173';
const text = (s: { name: string; detail: string }[]) => JSON.stringify(s);

describe('paypal:check names the step that fails and never prints a secret', () => {
  it('passes when PayPal accepts the keys and the order', async () => {
    const f = new FakePayPal(); const steps = await diagnosePayPal(cfg, BASE, { createOrder: true, fetchImpl: f.fetch });
    assert.ok(steps.every((s) => s.ok), text(steps));
  });
  it('reports refused keys as a failed sign-in step', async () => {
    const f = new FakePayPal(); f.authFail = true;
    const steps = await diagnosePayPal(cfg, BASE, { createOrder: true, fetchImpl: f.fetch }); const bad = steps.find((s) => !s.ok);
    assert.match(bad?.name ?? '', /Sign in/); assert.match(bad?.detail ?? '', /rejected \(HTTP 401\)/); assert.ok(!text(steps).includes(SECRET));
  });
  it('reports missing keys and a bad return address without calling PayPal', async () => {
    assert.equal((await diagnosePayPal(NO_PAYPAL, BASE))[0].ok, false);
    const f = new FakePayPal(); const steps = await diagnosePayPal(cfg, 'not a url', { createOrder: false, fetchImpl: f.fetch });
    assert.equal(steps.find((s) => s.name === 'Return address')?.ok, false);
  });
});

describe('each PayPal failure gets its own safe message', () => {
  const S1 = DEMO_MENTORS[0].sessions[0];
  async function run(set: (f: FakePayPal) => void) {
    const f = new FakePayPal(); set(f);
    const app = makeApp({ config: { paypal: cfg, clientOrigins: [BASE] }, paypalFetch: f.fetch });
    const u = (await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email: 'a@x.com', password: 'Passw0rdOK1' } })).body as { token: string };
    const id = (await app.call('POST', '/api/bookings', { token: u.token, body: { sessionId: S1.id } })).body.booking.id as string;
    const r = await app.call('POST', '/api/payments/create-order', { token: u.token, body: { bookingId: id } });
    return { r };
  }
  it('refused keys -> payment_provider_auth (502)', async () => { const { r } = await run((f) => { f.authFail = true; }); assert.equal(r.status, 502); assert.equal(r.body.error.code, 'payment_provider_auth'); assert.ok(!JSON.stringify(r.body).includes(SECRET)); });
  it('an order PayPal rejects -> payment_provider_rejected with PayPal\'s issue code', async () => { const { r } = await run((f) => { f.failCreate = 'invalid'; }); assert.equal(r.body.error.code, 'payment_provider_rejected'); assert.match(r.body.error.message, /INVALID_PARAMETER_VALUE/); });
  it('PayPal unreachable -> payment_provider_unreachable', async () => { const { r } = await run((f) => { f.failCreate = 'network'; }); assert.equal(r.body.error.code, 'payment_provider_unreachable'); });
});
