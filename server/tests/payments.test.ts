import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NO_PAYPAL, type Config } from '../src/config';
import { DEMO_MENTORS } from '../src/domain/demoMentors';
import type { Logger } from '../src/logger';
import { makeApp } from './helpers';

import { FakePayPal, SECRET, TOKEN, type Mode } from './fakePayPal';
const S1 = DEMO_MENTORS[0].sessions[0]; // 25.00 USD

const capturingLogger = () => { const lines: string[] = []; const l: Logger = { info: (m, x) => lines.push(JSON.stringify({ m, ...x })), warn: (m, x) => lines.push(JSON.stringify({ m, ...x })), error: (m, x) => lines.push(JSON.stringify({ m, ...x })) }; return { l, lines }; };
const PAYPAL_ON = { ...NO_PAYPAL, clientId: 'cid-TEST', clientSecret: SECRET, timeoutMs: 30 };
const ORIGIN = 'http://localhost:5173';

async function setup(config: Partial<Config> = {}) {
  const fake = new FakePayPal(), log = capturingLogger();
  const app = makeApp({ config: { paypal: PAYPAL_ON, clientOrigins: [ORIGIN], ...config }, paypalFetch: fake.fetch, logger: log.l });
  const reg = async (email: string) => (await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email, password: 'Passw0rdOK1' } })).body as { token: string; user: { id: string } };
  const a = await reg('a@x.com'), b = await reg('b@x.com');
  const book = async (u: { token: string }, sessionId = S1.id) => (await app.call('POST', '/api/bookings', { token: u.token, body: { sessionId } })).body.booking.id as string;
  const createOrder = (u: { token?: string }, body: unknown) => app.call('POST', '/api/payments/create-order', { token: u.token, body });
  const capture = (u: { token?: string }, body: unknown) => app.call('POST', '/api/payments/capture', { token: u.token, body });
  const bookingOf = async (u: { token: string }, id: string) => ((await app.call('GET', '/api/bookings', { token: u.token })).body.bookings as { id: string; status: string }[]).find((x) => x.id === id);
  return { app, fake, log, a, b, book, createOrder, capture, bookingOf };
}
const noLeak = (...parts: unknown[]) => { const s = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('\n'); assert.ok(!s.includes(SECRET) && !s.includes(TOKEN) && !s.includes('cid-TEST'), 'credentials or token leaked'); };

describe('payments: access control, configuration and validation', () => {
  it('requires authentication on both endpoints and never calls PayPal', async () => {
    const t = await setup(); const id = await t.book(t.a);
    assert.equal((await t.createOrder({}, { bookingId: id })).status, 401); assert.equal((await t.capture({}, { bookingId: id, orderId: 'ORDER1' })).status, 401);
    assert.equal(t.fake.calls.length, 0);
  });
  it('answers 503 payments_not_configured when PayPal is not configured, while the rest of the app keeps working', async () => {
    const t = await setup({ paypal: { ...NO_PAYPAL } }); const id = await t.book(t.a);
    for (const r of [await t.createOrder(t.a, { bookingId: id }), await t.capture(t.a, { bookingId: id, orderId: 'ORDER1' })]) { assert.equal(r.status, 503); assert.equal(r.body.error.code, 'payments_not_configured'); }
    assert.equal((await t.app.call('GET', '/api/mentors', { token: t.a.token })).status, 200); assert.equal((await t.bookingOf(t.a, id))?.status, 'pending_payment'); assert.equal(t.fake.calls.length, 0);
  });
  it('treats a configuration problem (for example live mode) the same as not configured', async () => {
    const t = await setup({ paypal: { ...PAYPAL_ON, problem: 'PAYPAL_MODE must be "sandbox".' } }); const id = await t.book(t.a);
    assert.equal((await t.createOrder(t.a, { bookingId: id })).status, 503); assert.equal(t.fake.calls.length, 0);
  });
  it('validates input: a booking id (and for capture a PayPal order id) must be well formed', async () => {
    const t = await setup();
    for (const body of [{}, { bookingId: '' }, { bookingId: 5 }, { bookingId: 'nope' }, { bookingId: "' OR 1=1 --" }, [], undefined]) assert.equal((await t.createOrder(t.a, body)).status, 400, JSON.stringify(body));
    const id = await t.book(t.a);
    for (const body of [{ bookingId: id }, { bookingId: id, orderId: '' }, { bookingId: id, orderId: 'a b' }, { bookingId: id, orderId: 'x'.repeat(65) }, { bookingId: id, orderId: '../etc' }, { orderId: 'ORDER1' }, { bookingId: 'nope', orderId: 'ORDER1' }]) assert.equal((await t.capture(t.a, body)).status, 400, JSON.stringify(body));
    assert.equal(t.fake.calls.length, 0);
  });
});

describe('payments: create order', () => {
  it('creates a PayPal order from the booking snapshot, ignores browser-supplied price/user/status, and returns only the order id and approval link', async () => {
    const t = await setup(); const id = await t.book(t.a);
    const r = await t.createOrder(t.a, { bookingId: id, amount: '0.01', price: 0.01, currency: 'JPY', userId: 'x', status: 'completed' });
    assert.equal(r.status, 201, JSON.stringify(r.body)); assert.deepEqual(Object.keys(r.body).sort(), ['approvalUrl', 'orderId']);
    assert.equal(r.body.approvalUrl, `https://www.sandbox.paypal.com/checkoutnow?token=${r.body.orderId}`);
    const sent = JSON.parse(t.fake.calls.find((c) => /POST .*\/v2\/checkout\/orders$/.test(c.method + ' ' + c.url))?.body ?? '{}');
    assert.deepEqual(sent.purchase_units[0].amount, { currency_code: 'USD', value: '25.00' }); assert.equal(sent.purchase_units[0].reference_id, id);
    assert.deepEqual(sent.payment_source.paypal.experience_context, { return_url: `${ORIGIN}/bookings/payment/return?bookingId=${id}`, cancel_url: `${ORIGIN}/bookings/payment/cancel?bookingId=${id}`, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', brand_name: 'CareerGraph' }); // PayPal sends the buyer back to the app only
    const p = [...t.app.repos.payments.values()]; assert.equal(p.length, 1);
    assert.deepEqual({ userId: p[0].userId, bookingId: p[0].bookingId, orderId: p[0].orderId, amount: p[0].amount, currency: p[0].currency, status: p[0].status, captureId: p[0].captureId }, { userId: t.a.user.id, bookingId: id, orderId: r.body.orderId, amount: '25.00', currency: 'USD', status: 'created', captureId: null });
    assert.equal((await t.bookingOf(t.a, id))?.status, 'pending_payment'); noLeak(r.body, t.log.lines);
  });
  it('reuses the live order instead of creating a second one', async () => {
    const t = await setup(); const id = await t.book(t.a);
    const first = await t.createOrder(t.a, { bookingId: id }), second = await t.createOrder(t.a, { bookingId: id });
    assert.equal(second.status, 200); assert.equal(second.body.orderId, first.body.orderId);
    assert.equal(t.fake.count(/POST .*\/v2\/checkout\/orders$/), 1); assert.equal(t.app.repos.payments.size, 1);
  });
  it('two simultaneous requests end with one order and one payment row', async () => {
    const t = await setup(); const id = await t.book(t.a);
    const [x, y] = await Promise.all([t.createOrder(t.a, { bookingId: id }), t.createOrder(t.a, { bookingId: id })]);
    assert.ok([200, 201].includes(x.status) && [200, 201].includes(y.status)); assert.equal(x.body.orderId, y.body.orderId); assert.equal(t.app.repos.payments.size, 1);
  });
  it("refuses another user's booking and an unknown booking (404) without calling PayPal", async () => {
    const t = await setup(); const id = await t.book(t.a);
    const other = await t.createOrder(t.b, { bookingId: id }), unknown = await t.createOrder(t.a, { bookingId: '00000000-0000-4000-8000-0000000fffff' });
    for (const r of [other, unknown]) { assert.equal(r.status, 404); assert.equal(r.body.error.code, 'booking_not_found'); }
    assert.equal(t.fake.calls.length, 0); assert.equal(t.app.repos.payments.size, 0);
  });
  it('refuses bookings that are already confirmed or cancelled (409)', async () => {
    const t = await setup(); const id = await t.book(t.a); const stored = t.app.repos.bookings.get(id)!;
    for (const status of ['confirmed', 'cancelled'] as const) { stored.status = status; const r = await t.createOrder(t.a, { bookingId: id }); assert.equal(r.status, 409); assert.equal(r.body.error.code, 'booking_not_payable'); }
    assert.equal(t.fake.calls.length, 0);
  });
  it('turns a PayPal failure into a clear error, stores nothing and leaks nothing', async () => {
    const t = await setup(); const id = await t.book(t.a); t.fake.failCreate = 'reject';
    const r = await t.createOrder(t.a, { bookingId: id });
    assert.equal(r.status, 502); assert.equal(r.body.error.code, 'payment_provider_error'); assert.equal(t.app.repos.payments.size, 0); assert.equal((await t.bookingOf(t.a, id))?.status, 'pending_payment'); noLeak(r.body, t.log.lines);
    t.fake.failCreate = 'hang'; const slow = await t.createOrder(t.a, { bookingId: id });
    assert.equal(slow.status, 504); assert.equal(slow.body.error.code, 'payment_provider_timeout');
    t.fake.failCreate = null; assert.equal((await t.createOrder(t.a, { bookingId: id })).status, 201); // recovers
  });
});

describe('payments: capture', () => {
  const paid = async () => { const t = await setup(); const id = await t.book(t.a); const o = (await t.createOrder(t.a, { bookingId: id })).body.orderId as string; return { t, id, o }; };
  it('confirms the booking only after PayPal reports a COMPLETED capture that matches booking, amount and currency', async () => {
    const { t, id, o } = await paid(); assert.equal((await t.bookingOf(t.a, id))?.status, 'pending_payment');
    const r = await t.capture(t.a, { bookingId: id, orderId: o });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.booking.status, 'confirmed'); assert.deepEqual(r.body.payment, { orderId: o, status: 'completed', amount: '25.00', currency: 'USD', captureId: `CAP-${o}` });
    assert.equal((await t.bookingOf(t.a, id))?.status, 'confirmed'); assert.equal([...t.app.repos.payments.values()][0].status, 'completed');
    assert.equal(t.fake.calls.find((c) => c.url.endsWith('/capture'))?.headers['PayPal-Request-Id'], `cg-capture-${o}`); noLeak(r.body, t.log.lines);
  });
  it('is idempotent: a repeated capture returns the same result without calling PayPal again', async () => {
    const { t, id, o } = await paid(); const first = await t.capture(t.a, { bookingId: id, orderId: o }); const again = await t.capture(t.a, { bookingId: id, orderId: o });
    assert.equal(again.status, 200); assert.deepEqual(again.body.payment, first.body.payment); assert.equal(t.fake.count(/POST .*\/capture$/), 1); assert.equal([...t.app.repos.payments.values()].filter((p) => p.status === 'completed').length, 1);
  });
  it('two simultaneous capture requests confirm the booking exactly once', async () => {
    const { t, id, o } = await paid(); const [x, y] = await Promise.all([t.capture(t.a, { bookingId: id, orderId: o }), t.capture(t.a, { bookingId: id, orderId: o })]);
    assert.equal(x.status, 200); assert.equal(y.status, 200); assert.equal(x.body.payment.captureId, y.body.payment.captureId); assert.equal([...t.app.repos.payments.values()].filter((p) => p.status === 'completed').length, 1);
  });
  it('rejects an order id that is not the one stored for this booking, without calling PayPal', async () => {
    const t = await setup(); const id1 = await t.book(t.a), id2 = await t.book(t.a, DEMO_MENTORS[1].sessions[0].id);
    const o1 = (await t.createOrder(t.a, { bookingId: id1 })).body.orderId, o2 = (await t.createOrder(t.a, { bookingId: id2 })).body.orderId; const before = t.fake.calls.length;
    for (const orderId of ['NOTMINE', o2]) { const r = await t.capture(t.a, { bookingId: id1, orderId }); assert.equal(r.status, 404); assert.equal(r.body.error.code, 'order_not_found'); }
    assert.equal(t.fake.calls.length, before); assert.equal((await t.bookingOf(t.a, id1))?.status, 'pending_payment'); assert.ok(o1 !== o2);
  });
  it("keeps users apart: nobody can capture another user's booking or reuse another user's order", async () => {
    const t = await setup(); const idA = await t.book(t.a), idB = await t.book(t.b); const oA = (await t.createOrder(t.a, { bookingId: idA })).body.orderId; await t.createOrder(t.b, { bookingId: idB }); const before = t.fake.calls.length;
    const steal = await t.capture(t.b, { bookingId: idA, orderId: oA }), cross = await t.capture(t.b, { bookingId: idB, orderId: oA });
    assert.equal(steal.status, 404); assert.equal(steal.body.error.code, 'booking_not_found'); assert.equal(cross.status, 404); assert.equal(cross.body.error.code, 'order_not_found');
    assert.equal(t.fake.calls.length, before); assert.equal((await t.bookingOf(t.a, idA))?.status, 'pending_payment');
    assert.equal((await t.capture(t.a, { bookingId: idA, orderId: oA })).status, 200); assert.equal((await t.bookingOf(t.b, idB))?.status, 'pending_payment');
  });
  it('does not confirm when the payer has not approved the order, whatever the browser claims', async () => {
    const { t, id, o } = await paid(); t.fake.mode = 'not_approved';
    const r = await t.capture(t.a, { bookingId: id, orderId: o, status: 'COMPLETED', amount: '0.01', approved: true });
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'payment_not_approved'); assert.equal((await t.bookingOf(t.a, id))?.status, 'pending_payment');
    t.fake.mode = 'ok'; assert.equal((await t.capture(t.a, { bookingId: id, orderId: o })).status, 200); // the same order works once approved
  });
  it('keeps the booking pending for an incomplete (PENDING) capture', async () => {
    const { t, id, o } = await paid(); t.fake.mode = 'pending';
    const r = await t.capture(t.a, { bookingId: id, orderId: o }); assert.equal(r.status, 409); assert.equal(r.body.error.code, 'payment_not_completed');
    assert.equal((await t.bookingOf(t.a, id))?.status, 'pending_payment'); assert.equal([...t.app.repos.payments.values()][0].status, 'created');
  });
  it('does not confirm when the captured amount, currency or booking reference differs, and logs it for review', async () => {
    for (const mode of ['amount', 'currency', 'reference'] as const) {
      const { t, id, o } = await paid(); t.fake.mode = mode;
      const r = await t.capture(t.a, { bookingId: id, orderId: o });
      assert.equal(r.status, 409, mode); assert.equal(r.body.error.code, 'payment_mismatch'); assert.equal((await t.bookingOf(t.a, id))?.status, 'pending_payment', mode);
      assert.ok([...t.app.repos.payments.values()].every((p) => p.status !== 'completed')); assert.ok(t.log.lines.some((l) => l.includes('payment_mismatch')));
      assert.equal((await t.createOrder(t.a, { bookingId: id })).body.orderId, o); // no second order is raised while this one is unresolved
    }
  });
  it('handles a declined payment: rejection keeps the order retryable, a DECLINED capture marks it failed and a new payment can start', async () => {
    const { t, id, o } = await paid(); t.fake.mode = 'declined_rejection';
    const r = await t.capture(t.a, { bookingId: id, orderId: o }); assert.equal(r.status, 402); assert.equal(r.body.error.code, 'payment_declined'); assert.equal([...t.app.repos.payments.values()][0].status, 'created');
    t.fake.mode = 'declined_capture'; assert.equal((await t.capture(t.a, { bookingId: id, orderId: o })).status, 402);
    assert.equal([...t.app.repos.payments.values()][0].status, 'failed'); assert.equal((await t.bookingOf(t.a, id))?.status, 'pending_payment');
    const again = await t.capture(t.a, { bookingId: id, orderId: o }); assert.equal(again.status, 409); assert.equal(again.body.error.code, 'payment_failed');
    const fresh = await t.createOrder(t.a, { bookingId: id }); assert.equal(fresh.status, 201); assert.notEqual(fresh.body.orderId, o);
    t.fake.mode = 'ok'; assert.equal((await t.capture(t.a, { bookingId: id, orderId: fresh.body.orderId })).status, 200); assert.equal((await t.bookingOf(t.a, id))?.status, 'confirmed');
  });
  it('turns PayPal outages and timeouts into clear errors, leaves the booking pending and leaks nothing', async () => {
    const { t, id, o } = await paid(); const want: [Mode, number, string][] = [['server_error', 502, 'payment_provider_error'], ['network', 502, 'payment_provider_unreachable'], ['hang', 504, 'payment_provider_timeout']];
    for (const [mode, status, code] of want) { t.fake.mode = mode; const r = await t.capture(t.a, { bookingId: id, orderId: o }); assert.equal(r.status, status, mode); assert.equal(r.body.error.code, code); noLeak(r.body); assert.equal((await t.bookingOf(t.a, id))?.status, 'pending_payment'); }
    noLeak(t.log.lines); t.fake.mode = 'ok'; assert.equal((await t.capture(t.a, { bookingId: id, orderId: o })).status, 200);
  });
  it('recovers an order PayPal already captured earlier by reading it back, then verifies it like any capture', async () => {
    const { t, id, o } = await paid(); t.fake.mode = 'already';
    const r = await t.capture(t.a, { bookingId: id, orderId: o }); assert.equal(r.status, 200); assert.equal(r.body.booking.status, 'confirmed'); assert.equal(t.fake.count(/GET .*\/v2\/checkout\/orders\/[^/]+$/), 1);
  });
  it('refuses to capture a booking that is no longer payable', async () => {
    const { t, id, o } = await paid(); t.app.repos.bookings.get(id)!.status = 'cancelled'; const before = t.fake.calls.length;
    const r = await t.capture(t.a, { bookingId: id, orderId: o }); assert.equal(r.status, 409); assert.equal(r.body.error.code, 'booking_not_payable'); assert.equal(t.fake.calls.length, before);
  });
  it('never writes credentials or tokens to the logs or any response across a full payment', async () => {
    const { t, id, o } = await paid(); const r = await t.capture(t.a, { bookingId: id, orderId: o }); noLeak(r.body, t.log.lines, JSON.stringify(t.app.repos.payments.get([...t.app.repos.payments.keys()][0])));
  });
});
