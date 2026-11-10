import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { loadPayPalConfig, NO_PAYPAL, paypalReady, type PayPalConfig } from '../src/config';
import { approvalUrl, createPayPalClient, PayPalClient, PayPalError, sameMoney, toCents, type PayPalFetch } from '../src/payments/paypal';

const CFG: PayPalConfig = { ...NO_PAYPAL, clientId: 'cid-TEST', clientSecret: 'secret-SECRET-VALUE', timeoutMs: 30 };
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('no json'); return body; } });
const TOKEN = res(200, { access_token: 'tok-SECRET', expires_in: 3600 });
const ORDER = { id: 'ORD123', status: 'CREATED', purchase_units: [{ reference_id: 'bk-1' }] };
// A scripted fake of PayPal's HTTP API: token calls get a token, everything else gets the next scripted reply.
function script(...replies: ({ ok: boolean; status: number; json(): Promise<unknown> } | Error | 'hang')[]) {
  const calls: Call[] = []; const queue = [...replies];
  const fetchImpl: PayPalFetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url.endsWith('/v1/oauth2/token') && queue[0] !== undefined && !(queue[0] instanceof Error) && queue[0] !== 'hang' && (queue[0] as { status: number }).status === 200 && (await (queue[0] as ReturnType<typeof res>).json() as { access_token?: string }).access_token) return queue.shift() as ReturnType<typeof res>;
    const next = queue.shift(); if (next === undefined) throw new Error('unscripted call ' + url);
    if (next === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

describe('PayPal configuration', () => {
  it('is off (not an error) when credentials are absent, and ready when both are set', () => {
    assert.equal(paypalReady(loadPayPalConfig({})), false); assert.equal(loadPayPalConfig({}).problem, null);
    assert.equal(paypalReady(loadPayPalConfig({ PAYPAL_CLIENT_ID: 'a' })), false);
    const c = loadPayPalConfig({ PAYPAL_CLIENT_ID: ' id ', PAYPAL_CLIENT_SECRET: ' sec ', PAYPAL_MODE: 'SANDBOX' });
    assert.equal(paypalReady(c), true); assert.equal(c.clientId, 'id'); assert.equal(c.clientSecret, 'sec'); assert.equal(c.baseUrl, 'https://api-m.sandbox.paypal.com'); assert.equal(c.mode, 'sandbox');
  });
  it('refuses live mode and any unknown mode: payments switch off, secrets are dropped and not echoed', () => {
    for (const mode of ['live', 'production', 'x']) { const c = loadPayPalConfig({ PAYPAL_CLIENT_ID: 'a', PAYPAL_CLIENT_SECRET: 'TOPSECRET', PAYPAL_MODE: mode }); assert.equal(paypalReady(c), false); assert.equal(c.clientSecret, null); assert.match(c.problem ?? '', /sandbox/); assert.ok(!JSON.stringify(c).includes('TOPSECRET')); }
  });
  it('bounds the PayPal timeout', () => {
    assert.equal(loadPayPalConfig({}).timeoutMs, 15000); assert.equal(loadPayPalConfig({ PAYPAL_TIMEOUT_MS: '5000' }).timeoutMs, 5000);
    for (const bad of ['5', '999999', 'abc']) assert.throws(() => loadPayPalConfig({ PAYPAL_TIMEOUT_MS: bad }), /PAYPAL_TIMEOUT_MS/); // same fail-fast rule as the AI settings
  });
  it('keeps credentials server-side: placeholders only in .env.example, nothing in frontend code or VITE_ variables', () => {
    const env = readFileSync('.env.example', 'utf8');
    for (const k of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']) assert.match(env, new RegExp(`^${k}=$`, 'm'));
    assert.match(env, /^PAYPAL_MODE=sandbox$/m); assert.ok(!/VITE_PAYPAL/.test(env));
    assert.equal(createPayPalClient({ ...NO_PAYPAL }), null);
  });
});

describe('money helpers', () => {
  it('compares decimal text as whole cents, never as floats', () => {
    assert.equal(toCents('25.00'), 2500); assert.equal(toCents('25'), 2500); assert.equal(toCents('25.5'), 2550); assert.equal(toCents('0.07'), 7);
    for (const bad of ['', '-1', '1e3', '25.001', 'abc', 25, null, '1,000.00']) assert.equal(toCents(bad), null, String(bad));
    assert.ok(sameMoney('25.00', '25')); assert.ok(!sameMoney('25.00', '25.01')); assert.ok(!sameMoney('x', 'x'));
  });
  it('builds the approval link from the order id only, on the Sandbox host', () => {
    assert.equal(approvalUrl('ORD123'), 'https://www.sandbox.paypal.com/checkoutnow?token=ORD123'); assert.ok(!approvalUrl('a b&c').includes(' '));
  });
});

describe('PayPal REST client (HTTP is mocked)', () => {
  it('gets an OAuth token with Basic auth, then creates an order with a Bearer token, request id and the trusted amount', async () => {
    const s = script(TOKEN, res(201, ORDER)); const c = new PayPalClient(CFG, s.fetchImpl);
    assert.deepEqual(await c.createOrder({ bookingId: 'bk-1', amount: '25.00', currency: 'USD', requestId: 'req-1', returnUrl: 'http://app.test/bookings/payment/return?bookingId=bk-1', cancelUrl: 'http://app.test/bookings/payment/cancel?bookingId=bk-1' }), { orderId: 'ORD123' });
    const [tok, ord] = s.calls;
    assert.equal(tok.url, 'https://api-m.sandbox.paypal.com/v1/oauth2/token'); assert.equal(tok.body, 'grant_type=client_credentials');
    assert.equal(tok.headers.Authorization, `Basic ${Buffer.from('cid-TEST:secret-SECRET-VALUE').toString('base64')}`);
    assert.equal(ord.url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders'); assert.equal(ord.method, 'POST');
    assert.equal(ord.headers.Authorization, 'Bearer tok-SECRET'); assert.equal(ord.headers['PayPal-Request-Id'], 'req-1');
    const body = JSON.parse(ord.body ?? '{}'); assert.equal(body.intent, 'CAPTURE'); assert.deepEqual(body.purchase_units[0].amount, { currency_code: 'USD', value: '25.00' }); assert.equal(body.purchase_units[0].reference_id, 'bk-1');
    assert.deepEqual(body.payment_source.paypal.experience_context, { return_url: 'http://app.test/bookings/payment/return?bookingId=bk-1', cancel_url: 'http://app.test/bookings/payment/cancel?bookingId=bk-1', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', brand_name: 'CareerGraph' });
    assert.ok(!(ord.body ?? '').includes('secret'));
  });
  it('reuses the token until shortly before it expires, then fetches a new one', async () => {
    let t = 0; const s = script(TOKEN, res(201, ORDER), res(201, ORDER), TOKEN, res(201, ORDER)); const c = new PayPalClient(CFG, s.fetchImpl, () => t);
    const make = () => c.createOrder({ bookingId: 'bk-1', amount: '25.00', currency: 'USD', requestId: 'r', returnUrl: 'http://app.test/r', cancelUrl: 'http://app.test/c' });
    await make(); await make(); assert.equal(s.calls.filter((x) => x.url.endsWith('/token')).length, 1);
    t = 3600 * 1000; await make(); assert.equal(s.calls.filter((x) => x.url.endsWith('/token')).length, 2);
  });
  it('parses a completed capture (id, status, amount, currency, booking reference)', async () => {
    const cap = { id: 'ORD123', status: 'COMPLETED', purchase_units: [{ reference_id: 'bk-1', payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '25.00' } }] } }] };
    const s = script(TOKEN, res(201, cap)); const r = await new PayPalClient(CFG, s.fetchImpl).captureOrder('ORD123', 'cap-req');
    assert.deepEqual(r, { orderId: 'ORD123', status: 'COMPLETED', referenceId: 'bk-1', capture: { id: 'CAP1', status: 'COMPLETED', value: '25.00', currency: 'USD' } });
    assert.equal(s.calls[1].url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD123/capture'); assert.equal(s.calls[1].headers['PayPal-Request-Id'], 'cap-req');
  });
  it('reduces PayPal rejections to a status and a safe issue code, never the body or credentials', async () => {
    const s = script(TOKEN, res(422, { name: 'UNPROCESSABLE', message: 'secret-SECRET-VALUE leak?', details: [{ issue: 'ORDER_NOT_APPROVED', description: 'tok-SECRET' }] }));
    await assert.rejects(new PayPalClient(CFG, s.fetchImpl).captureOrder('ORD123', 'r'), (e: unknown) => { assert.ok(e instanceof PayPalError); assert.equal(e.category, 'rejected'); assert.equal(e.upstreamStatus, 422); assert.equal(e.issue, 'ORDER_NOT_APPROVED'); assert.ok(!/SECRET|tok-/.test(e.message + JSON.stringify(e))); return true; });
    const odd = script(TOKEN, res(400, { details: [{ issue: 'not a code <script>' }] }));
    await assert.rejects(new PayPalClient(CFG, odd.fetchImpl).getOrder('X'), (e: unknown) => e instanceof PayPalError && e.issue === undefined);
  });
  it('classifies timeouts, network failures and malformed responses, and rejects bad credentials', async () => {
    await assert.rejects(new PayPalClient(CFG, script(TOKEN, 'hang').fetchImpl).getOrder('X'), (e: unknown) => e instanceof PayPalError && e.category === 'timeout');
    await assert.rejects(new PayPalClient(CFG, script(TOKEN, new Error('ECONNRESET')).fetchImpl).getOrder('X'), (e: unknown) => e instanceof PayPalError && e.category === 'network');
    for (const bad of [res(200, 'nope'), res(200, {}), res(200, { id: 'has space', status: 'CREATED' }), res(200, undefined)]) await assert.rejects(new PayPalClient(CFG, script(TOKEN, bad).fetchImpl).getOrder('X'), (e: unknown) => e instanceof PayPalError && e.category === 'invalid_response');
    await assert.rejects(new PayPalClient(CFG, script(res(401, { error: 'invalid_client' })).fetchImpl).getOrder('X'), (e: unknown) => e instanceof PayPalError && e.category === 'rejected' && e.upstreamStatus === 401);
    await assert.rejects(new PayPalClient(CFG, script(res(200, { access_token: '', expires_in: 5 })).fetchImpl).getOrder('X'), (e: unknown) => e instanceof PayPalError && e.category === 'invalid_response');
  });
  it('drops a token PayPal rejects with 401 so the next call authenticates again', async () => {
    const s = script(TOKEN, res(401, {}), TOKEN, res(200, ORDER)); const c = new PayPalClient(CFG, s.fetchImpl);
    await assert.rejects(c.getOrder('ORD123')); await c.getOrder('ORD123'); assert.equal(s.calls.filter((x) => x.url.endsWith('/token')).length, 2);
  });
});
