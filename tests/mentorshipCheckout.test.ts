import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NO_PAYPAL } from '../server/src/config';
import { DEMO_MENTORS } from '../server/src/domain/demoMentors';
import { FakePayPal, SECRET, type Mode } from '../server/tests/fakePayPal';
import { makeApp } from '../server/tests/helpers';
import { ApiError, api } from '../src/services/api';
import { cancelCheckout, completeCheckout, startCheckout } from '../src/services/checkout';
import { formatPrice, friendlyPaymentError, mentorshipApi } from '../src/services/mentorship';
import { forgetCheckout, isPayPalApprovalUrl, parseReturnParams, recallCheckout, rememberCheckout, resolveCheckout } from '../src/utils/checkout';
import { resetStorage } from './helpers';

// REAL route/controller/service/auth/PayPal-verification pipeline from the backend, driven through the real frontend client code.
// Only PayPal's HTTP API is faked (FakePayPal); no real PayPal credentials or network are used.
const S1 = DEMO_MENTORS[0].sessions[0]; // 25.00 USD
const ORIGIN = 'http://localhost:5173';
let backend: ReturnType<typeof makeApp>, fake: FakePayPal, real: typeof fetch, seen: { url: string; method: string; body?: string }[];

const boot = (configured = true) => {
  fake = new FakePayPal();
  backend = makeApp({ config: { clientOrigins: [ORIGIN], paypal: configured ? { ...NO_PAYPAL, clientId: 'cid-TEST', clientSecret: SECRET, timeoutMs: 30 } : { ...NO_PAYPAL } }, paypalFetch: fake.fetch });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? String(init.body) : undefined });
    const r = await backend.call(init?.method ?? 'GET', String(url).replace('http://api.test', ''), { body: init?.body ? JSON.parse(String(init.body)) : undefined, token: h.Authorization?.replace('Bearer ', ''), headers: {} });
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
};
const signIn = async (email = 'a@x.com') => { const r = await backend.call('POST', '/api/auth/register', { body: { name: 'Ada', email, password: 'Passw0rdOK1' } }); api.setToken(r.body.token as string, false); return r.body.token as string; };
const book = async (sessionId = S1.id) => (await mentorshipApi.createBooking(sessionId)).id;
// What PayPal's redirect looks like: our own return link plus the order id in `token`.
const returnTo = (bookingId: string, orderId: string) => parseReturnParams(`?bookingId=${bookingId}&token=${orderId}&PayerID=BUYER1`);
const statusOf = async (id: string) => (await mentorshipApi.listBookings()).find((b) => b.id === id)?.status;
const rejects = (p: Promise<unknown>, code: string, status?: number) => assert.rejects(p, (e: unknown) => e instanceof ApiError && e.code === code && (status === undefined || e.status === status));

beforeEach(() => { resetStorage(); seen = []; real = globalThis.fetch; api.setBase('http://api.test/api'); });
afterEach(() => { globalThis.fetch = real; api.setToken(null); api.setBase(''); });

describe('mentor listing, session selection and booking', () => {
  it('lists the demo mentors with their expertise, descriptions and demo label, and shows a mentor with its sessions', async () => {
    boot(); await signIn();
    const { mentors, career } = await mentorshipApi.listMentors(); // no career = the explicit "all mentors" list
    assert.equal(career, null); assert.equal(mentors.length, DEMO_MENTORS.length);
    for (const m of mentors) { assert.equal(m.isDemo, true); assert.ok(m.expertise.length > 0 && m.headline && m.bio); }
    const d = await mentorshipApi.getMentor(DEMO_MENTORS[0].id);
    assert.deepEqual(d.sessions.map((s) => formatPrice(s.price, s.currency)), ['$25.00', '$45.00']);
    await assert.rejects(mentorshipApi.getMentor('00000000-0000-4000-8000-0000000fffff'), (e: unknown) => e instanceof ApiError && /isn't available/.test(friendlyPaymentError(e)));
  });
  it('books a selected session by sending only its id, and the booking carries the server price and a pending status', async () => {
    boot(); await signIn();
    const b = await mentorshipApi.createBooking(S1.id);
    assert.equal(b.status, 'pending_payment'); assert.equal(formatPrice(b.amount, b.currency), '$25.00'); assert.equal(b.mentor.isDemo, true);
    assert.deepEqual(JSON.parse(seen[seen.length - 1].body ?? '{}'), { sessionId: S1.id });
    assert.deepEqual((await mentorshipApi.listBookings()).map((x) => x.id), [b.id]);
  });
  it('explains a duplicate unpaid booking and an unavailable session in plain language, and creates nothing extra', async () => {
    boot(); await signIn(); await book();
    await assert.rejects(mentorshipApi.createBooking(S1.id), (e: unknown) => e instanceof ApiError && e.status === 409 && /unpaid booking/.test(friendlyPaymentError(e)));
    backend.repos.sessions.get(DEMO_MENTORS[1].sessions[0].id)!.isActive = false;
    await assert.rejects(mentorshipApi.createBooking(DEMO_MENTORS[1].sessions[0].id), (e: unknown) => e instanceof ApiError && /no longer available/.test(friendlyPaymentError(e)));
    assert.equal((await mentorshipApi.listBookings()).length, 1);
  });
  it("shows only the signed-in student's own bookings", async () => {
    boot(); await signIn('a@x.com'); await book(); await signIn('b@x.com');
    assert.deepEqual(await mentorshipApi.listBookings(), []);
  });
});

describe('PayPal checkout redirect', () => {
  it('asks the server for the order (booking id only), receives the approval link, and remembers the booking for the return', async () => {
    boot(); await signIn(); const id = await book();
    const url = await startCheckout(id);
    assert.match(url, /^https:\/\/www\.sandbox\.paypal\.com\/checkoutnow\?token=ORDER\d+$/);
    const orderId = url.split('token=')[1];
    const req = seen.filter((s) => s.url.endsWith('/payments/create-order')); assert.equal(req.length, 1);
    assert.deepEqual(JSON.parse(req[0].body ?? '{}'), { bookingId: id }); // no amount, currency, user or status from the browser
    assert.equal(recallCheckout(orderId), id);
    const sent = JSON.parse(fake.calls.find((c) => /orders$/.test(c.url) && c.method === 'POST')?.body ?? '{}');
    assert.equal(sent.purchase_units[0].amount.value, '25.00'); assert.equal(sent.payment_source.paypal.experience_context.return_url, `${ORIGIN}/bookings/payment/return?bookingId=${id}`);
    assert.equal(await statusOf(id), 'pending_payment'); // going to PayPal changes nothing
  });
  it('clicking pay twice reuses the same PayPal order and never adds a booking', async () => {
    boot(); await signIn(); const id = await book();
    assert.equal(await startCheckout(id), await startCheckout(id)); assert.equal((await mentorshipApi.listBookings()).length, 1); assert.equal(fake.count(/POST .*\/v2\/checkout\/orders$/), 1);
  });
  it('only ever follows an https PayPal address', () => {
    for (const ok of ['https://www.sandbox.paypal.com/checkoutnow?token=A', 'https://www.paypal.com/checkoutnow?token=A', 'https://paypal.com/x']) assert.equal(isPayPalApprovalUrl(ok), true, ok);
    for (const bad of ['http://www.sandbox.paypal.com/x', 'https://evil.example/paypal.com', 'https://paypal.com.evil.example/x', 'https://notpaypal.com/x', 'javascript:alert(1)', 'not a url', '', null, undefined]) assert.equal(isPayPalApprovalUrl(bad), false, String(bad));
  });
  it('reports a clear error when payments are not configured on the server, without sending anyone to PayPal', async () => {
    boot(false); await signIn(); const id = await book();
    await assert.rejects(startCheckout(id), (e: unknown) => e instanceof ApiError && e.status === 503 && /not set up/.test(friendlyPaymentError(e)));
    assert.equal(fake.calls.length, 0);
  });
});

describe('PayPal return handling', () => {
  it('reads the order id from the return URL and recovers the booking safely', () => {
    const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
    assert.deepEqual(parseReturnParams(`?token=ORDER1&PayerID=X&bookingId=${id.toUpperCase()}`), { orderId: 'ORDER1', bookingId: id });
    assert.deepEqual(parseReturnParams('?token=bad token!&bookingId=nope'), { orderId: null, bookingId: null }); assert.deepEqual(parseReturnParams(''), { orderId: null, bookingId: null });
    resetStorage(); assert.deepEqual(resolveCheckout(parseReturnParams(`?token=ORDER1&bookingId=${id}`)), { ok: true, bookingId: id, orderId: 'ORDER1' }); // URL fallback
    assert.deepEqual(resolveCheckout(parseReturnParams('?token=ORDER1')), { ok: false, reason: 'no_booking' }); assert.deepEqual(resolveCheckout(parseReturnParams(`?bookingId=${id}`)), { ok: false, reason: 'no_order' });
    rememberCheckout(id, 'ORDER1'); assert.deepEqual(resolveCheckout(parseReturnParams('?token=ORDER1')), { ok: true, bookingId: id, orderId: 'ORDER1' }); // remembered
    assert.deepEqual(resolveCheckout(parseReturnParams(`?token=ORDER1&bookingId=${other}`)), { ok: false, reason: 'conflict' }); // disagreement captures nothing
  });
  it('shows success only after the server confirms the capture, and the booking is then confirmed', async () => {
    boot(); await signIn(); const id = await book(); const orderId = (await startCheckout(id)).split('token=')[1];
    const out = await completeCheckout(returnTo(id, orderId));
    assert.equal(out.kind, 'confirmed'); if (out.kind !== 'confirmed') return;
    assert.equal(out.booking.status, 'confirmed'); assert.equal(out.payment.status, 'completed'); assert.equal(formatPrice(out.payment.amount, out.payment.currency), '$25.00'); assert.ok(out.payment.captureId);
    assert.equal(await statusOf(id), 'confirmed'); assert.equal(recallCheckout(orderId), null);
    assert.deepEqual(JSON.parse(seen.filter((s) => s.url.endsWith('/payments/capture')).pop()?.body ?? '{}'), { bookingId: id, orderId }); // ids only
  });
  it('treats a refresh or repeated return visit as the same confirmed payment: one capture, one booking, no duplicates', async () => {
    boot(); await signIn(); const id = await book(); const orderId = (await startCheckout(id)).split('token=')[1]; const params = returnTo(id, orderId);
    const first = await completeCheckout(params), second = await completeCheckout(params), third = await completeCheckout(parseReturnParams(`?bookingId=${id}&token=${orderId}`));
    for (const o of [first, second, third]) assert.equal(o.kind, 'confirmed');
    assert.equal(fake.count(/POST .*\/capture$/), 1); assert.equal((await mentorshipApi.listBookings()).length, 1); assert.equal(await statusOf(id), 'confirmed');
  });
  it('does not treat approval at PayPal as payment: an approved-but-not-captured order stays pending until the server confirms', async () => {
    boot(); await signIn(); const id = await book(); const orderId = (await startCheckout(id)).split('token=')[1]; fake.mode = 'not_approved';
    assert.equal((await completeCheckout(returnTo(id, orderId))).kind, 'waiting'); assert.equal(await statusOf(id), 'pending_payment');
    fake.mode = 'pending'; const pending = await completeCheckout(returnTo(id, orderId)); assert.equal(pending.kind, 'waiting'); assert.equal(await statusOf(id), 'pending_payment');
    fake.mode = 'ok'; assert.equal((await completeCheckout(returnTo(id, orderId))).kind, 'confirmed');
  });
  it('reports capture failures clearly, never as success, and lets transient ones be retried', async () => {
    boot(); await signIn(); const id = await book(); const orderId = (await startCheckout(id)).split('token=')[1];
    const cases: [Mode, boolean, RegExp][] = [['server_error', true, /PayPal could not process/], ['network', true, /reach PayPal/], ['hang', true, /too long/], ['declined_rejection', false, /declined/], ['amount', false, /contact support/], ['currency', false, /contact support/], ['reference', false, /contact support/]];
    for (const [mode, canRetry, text] of cases) {
      fake.mode = mode; const o = await completeCheckout(returnTo(id, orderId));
      assert.equal(o.kind, 'failed', mode); if (o.kind === 'failed') { assert.equal(o.canRetry, canRetry, mode); assert.match(o.message, text, mode); assert.ok(!/SECRET|tok-|cid-/.test(o.message)); }
      assert.equal(await statusOf(id), 'pending_payment', mode);
    }
    fake.mode = 'ok'; assert.equal((await completeCheckout(returnTo(id, orderId))).kind, 'confirmed'); // a retry after the outage succeeds
  });
  it('treats a return that cannot be matched to a booking as nothing to confirm, without calling the server', async () => {
    boot(); await signIn(); const before = seen.length;
    assert.equal((await completeCheckout(parseReturnParams('?token=ORDER1'))).kind, 'unmatched'); assert.equal((await completeCheckout(parseReturnParams(''))).kind, 'unmatched'); assert.equal(seen.length, before);
  });
  it("refuses a return for another student's booking or an order that belongs to a different booking", async () => {
    boot(); await signIn('a@x.com'); const idA = await book(); const orderA = (await startCheckout(idA)).split('token=')[1];
    await signIn('b@x.com'); const idB = await book();
    const steal = await completeCheckout(returnTo(idA, orderA)); assert.equal(steal.kind, 'failed'); if (steal.kind === 'failed') assert.match(steal.message, /isn't available/);
    assert.equal((await completeCheckout(returnTo(idB, orderA))).kind, 'unmatched'); // this tab remembers orderA belongs to another booking, so nothing is even sent
    await rejects(mentorshipApi.capture(idB, orderA), 'order_not_found', 404); // and the server refuses it on its own
    assert.equal(await statusOf(idB), 'pending_payment');
  });
});

describe('backend and frontend agree on the PayPal return contract', () => {
  it("parses the exact return and cancel links the server gives PayPal, with PayPal's own parameters added", async () => {
    boot(); await signIn(); const id = await book(); const orderId = (await startCheckout(id)).split('token=')[1];
    const ctx = JSON.parse(fake.calls.find((c) => /orders$/.test(c.url) && c.method === 'POST')?.body ?? '{}').payment_source.paypal.experience_context as { return_url: string; cancel_url: string };
    const ret = new URL(ctx.return_url), cancel = new URL(ctx.cancel_url);
    assert.equal(ret.origin, ORIGIN); assert.equal(ret.pathname, '/bookings/payment/return'); assert.equal(cancel.pathname, '/bookings/payment/cancel');
    // PayPal appends token (the order id) and PayerID to whatever return_url it was given.
    ret.searchParams.set('token', orderId); ret.searchParams.set('PayerID', 'BUYER1'); cancel.searchParams.set('token', orderId);
    assert.deepEqual(parseReturnParams(ret.search), { orderId, bookingId: id }); assert.deepEqual(parseReturnParams(cancel.search), { orderId, bookingId: id });
    forgetCheckout(orderId); // as in a brand-new tab: no remembered mapping, the link alone is enough (the sign-in stays)
    assert.equal((await completeCheckout(parseReturnParams(ret.search))).kind, 'confirmed');
  });
  it('never sends an amount, currency, price, user id or status to the server in a whole booking and payment flow', async () => {
    boot(); await signIn(); const id = await book(); const orderId = (await startCheckout(id)).split('token=')[1]; await completeCheckout(returnTo(id, orderId)); await mentorshipApi.listBookings();
    for (const call of seen.filter((s) => s.body)) assert.deepEqual(Object.keys(JSON.parse(call.body ?? '{}')).filter((k) => /amount|price|currency|status|user/i.test(k)), [], call.url);
    for (const call of seen) assert.ok(!/amount|price|currency/i.test(new URL(call.url).search), call.url); // nor in a query string
  });
});

describe('cancellation and authentication failures', () => {
  it('cancelling at PayPal sends nothing to the server, marks nothing paid, and the same order can be paid later', async () => {
    boot(); await signIn(); const id = await book(); const url = await startCheckout(id); const orderId = url.split('token=')[1]; const before = seen.length;
    cancelCheckout(parseReturnParams(`?bookingId=${id}&token=${orderId}`));
    assert.equal(seen.length, before); assert.equal(recallCheckout(orderId), null); assert.equal(await statusOf(id), 'pending_payment');
    assert.equal(await startCheckout(id), url); // same live order, remembered again
    assert.equal((await completeCheckout(returnTo(id, orderId))).kind, 'confirmed');
  });
  it('signed-out and expired sessions are rejected by the server and shown as a sign-in message', async () => {
    boot(); await signIn(); const id = await book(); const orderId = (await startCheckout(id)).split('token=')[1];
    api.setToken(null);
    await rejects(mentorshipApi.listMentors(), 'token_missing', 401); await rejects(mentorshipApi.createBooking(S1.id), 'token_missing', 401); await rejects(startCheckout(id), 'token_missing', 401);
    assert.equal((await completeCheckout(returnTo(id, orderId))).kind, 'sign_in');
    await signIn('c@x.com'); backend.clock.ms += 3 * 24 * 3600 * 1000; // token lifetime passes
    assert.equal((await completeCheckout(returnTo(id, orderId))).kind, 'sign_in');
    assert.match(friendlyPaymentError(new ApiError(401, 'token_expired', 'x')), /sign in/);
    assert.equal(fake.count(/POST .*\/capture$/), 0); // the server never reached PayPal
  });
  it('never echoes server text or credentials in a friendly message', () => {
    for (const code of ['network_error', 'timeout', 'token_expired', 'rate_limited', 'payments_not_configured', 'mentor_not_found', 'session_unavailable', 'conflict', 'booking_not_found', 'booking_not_payable', 'order_not_found', 'payment_not_approved', 'payment_not_completed', 'payment_mismatch', 'payment_declined', 'payment_failed', 'payment_provider_timeout', 'payment_provider_error', 'unknown_code'])
      for (const status of [0, 400, 401, 404, 409, 500]) assert.ok(!/RAW|SECRET|tok-/.test(friendlyPaymentError(new ApiError(status, code, `RAW ${SECRET}`))), code);
    assert.match(friendlyPaymentError(new Error('x')), /try again/);
  });
});

describe('Pay button failures are specific, not "Something went wrong"', () => {
  const attempt = async () => { boot(); await signIn(); const id = await book(); const before = seen.length; return { id, before, err: await startCheckout(id).then(() => null, (e: unknown) => e) }; };
  it('pressing Pay sends POST /payments/create-order with only the booking id (the request is really made)', async () => {
    boot(); await signIn(); const id = await book(); seen.length = 0;
    await startCheckout(id);
    assert.equal(seen.length, 1); assert.equal(seen[0].method, 'POST'); assert.match(seen[0].url, /\/api\/payments\/create-order$/); assert.deepEqual(JSON.parse(seen[0].body ?? '{}'), { bookingId: id });
  });
  it('a missing payments table tells the developer to run the migration', async () => {
    boot(); await signIn(); const id = await book();
    backend.repos.listPayments = async () => { throw Object.assign(new Error('relation "payments" does not exist'), { code: '42P01' }); };
    await assert.rejects(startCheckout(id), (e: unknown) => e instanceof ApiError && e.code === 'database_not_migrated' && /db:migrate/.test(friendlyPaymentError(e)));
  });
  it('an unexpected server error names its status and code instead of a bare message, and a missing route says to restart the server', async () => {
    const { id } = await attempt();
    backend.repos.listPayments = async () => { throw new Error('boom'); };
    await assert.rejects(startCheckout(id), (e: unknown) => e instanceof ApiError && /500 internal_error/.test(friendlyPaymentError(e)) && !/boom/.test(friendlyPaymentError(e)));
    assert.match(friendlyPaymentError(new ApiError(404, 'not_found', 'No such endpoint.')), /Restart the server/);
    assert.match(friendlyPaymentError(new ApiError(503, 'payments_not_configured', 'x')), /server\/\.env/);
    assert.match(friendlyPaymentError(new ApiError(502, 'payment_provider_auth', 'x')), /Sandbox keys in server\/\.env/);
    assert.match(friendlyPaymentError(new ApiError(502, 'payment_provider_unreachable', 'x')), /reach PayPal/);
    assert.match(friendlyPaymentError(new ApiError(502, 'payment_provider_rejected', 'x')), /server log/);
  });
});

describe('the selected career is carried through mentors, booking, payment and confirmation', () => {
  const LAW = DEMO_MENTORS.find((m) => m.fields.includes('law'))!, SWE = DEMO_MENTORS.find((m) => m.fields.includes('technology'))!;
  const lawyer = async () => (await api.post<{ career: { id: string } }>('/careers', { name: 'Corporate Lawyer', category: 'Law', description: 'x', evidenceExpectations: [], capabilities: [{ name: 'Basics', description: 'x', skills: [{ name: 'Legal research', requiredLevel: 3, importance: 3 }] }] })).career.id;
  it('Lawyer shows only the legal mentor and its legal sessions; Software Engineer shows only the technology mentor; switching updates the list', async () => {
    boot(); await signIn(); const law = await lawyer();
    const ids = async (c: string) => (await mentorshipApi.listMentors(c)).mentors.map((m) => m.id);
    assert.deepEqual(await ids(law), [LAW.id]); assert.deepEqual(await ids('swe'), [SWE.id]); assert.deepEqual(await ids(law), [LAW.id]);
    assert.ok(seen.some((r) => r.url.endsWith(`/mentors?careerId=${law}`)), 'the career id is what the client sends; the server does the filtering');
    const sessions = (await mentorshipApi.getMentor(LAW.id)).sessions.map((x) => x.title);
    assert.ok(sessions.every((t) => LAW.sessions.some((x) => x.title === t)) && !sessions.some((t) => SWE.sessions.some((x) => x.title === t)));
  });
  it('a career with no mentors returns an empty list with the career, not other mentors', async () => {
    boot(); await signIn();
    const chef = (await api.post<{ career: { id: string } }>('/careers', { name: 'Chef', category: 'Culinary', description: 'x', evidenceExpectations: [], capabilities: [{ name: 'Basics', description: 'x', skills: [{ name: 'Knife skills', requiredLevel: 3, importance: 3 }] }] })).career.id;
    const r = await mentorshipApi.listMentors(chef); assert.deepEqual(r.mentors, []); assert.equal(r.career?.name, 'Chef');
  });
  it('booking an unrelated session is refused with a plain message; a matching one keeps the career through payment and confirmation', async () => {
    boot(); await signIn(); const law = await lawyer();
    await assert.rejects(mentorshipApi.createBooking(SWE.sessions[0].id, law), (e: unknown) => e instanceof ApiError && e.code === 'session_not_for_career' && /selected career/.test(friendlyPaymentError(e)));
    assert.equal((await mentorshipApi.listBookings()).length, 0);
    const b = await mentorshipApi.createBooking(LAW.sessions[0].id, law); assert.equal(b.career?.name, 'Corporate Lawyer');
    const orderId = (await startCheckout(b.id)).split('token=')[1];
    const done = await completeCheckout(returnTo(b.id, orderId)); assert.equal(done.kind, 'confirmed');
    if (done.kind === 'confirmed') { assert.equal(done.booking.career?.name, 'Corporate Lawyer'); assert.equal(done.booking.mentor.id, LAW.id); }
  });
  it('the pages use the selected career: Mentors asks the server by career id, links keep it, the detail page books with it, and no link points at a missing route', () => {
    const list = readFileSync('src/pages/Mentors.tsx', 'utf8'), detail = readFileSync('src/pages/MentorDetail.tsx', 'utf8'), app = readFileSync('src/App.tsx', 'utf8');
    assert.match(list, /targetCareerId/); assert.match(list, /listMentors\(browseAll \? undefined : careerId\)/); assert.match(list, /\?career=\$\{encodeURIComponent\(career\.id\)\}/);
    assert.match(list, /No mentors for \$\{career\.name\} yet/); assert.match(list, /Browse all sample mentors/);
    assert.match(detail, /createBooking\(sessionId, careerId\)`?/);
    for (const to of [...list.matchAll(/to="(\/[a-z/]+)(?:\?[^"]*)?"/g)].map((m) => m[1])) assert.ok(app.includes(`path="${to}"`), `${to} must be a real route`);
  });
});

describe('career directory (ideas to start from)', () => {
  it('holds only names under fields: no skills or levels are invented, names are unique, and none repeats the ready-made catalogue', async () => {
    const { CAREER_DIRECTORY } = await import('../src/data/careerDirectory'); const { CAREER_DATASETS } = await import('../src/data/careers');
    const names = Object.values(CAREER_DIRECTORY).flat();
    assert.ok(names.length >= 15); assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
    for (const n of ['Lawyer', 'Corporate Lawyer', 'Doctor', 'Data Analyst', 'Chartered Accountant', 'Researcher']) assert.ok(names.includes(n), n);
    for (const d of CAREER_DATASETS) assert.ok(!names.some((n) => n.toLowerCase() === d.career.name.toLowerCase()), d.career.name);
    for (const v of Object.values(CAREER_DIRECTORY)) assert.ok(v.every((x) => typeof x === 'string'));
  });
  it('the Law idea uses the same field spelling as the Law mentor, so a Lawyer sees the legal mentor', async () => {
    const { CAREER_DIRECTORY } = await import('../src/data/careerDirectory');
    assert.ok(Object.keys(CAREER_DIRECTORY).some((f) => DEMO_MENTORS.some((m) => m.fields.includes(f.toLowerCase()))));
    assert.ok(CAREER_DIRECTORY.Law.includes('Lawyer'));
  });
  it('the Explorer lists ideas by field, hides ones already in the catalogue, and starting one fills the form instead of inventing a model', () => {
    const page = readFileSync('src/pages/CareerExplorer.tsx', 'utf8');
    assert.match(page, /CAREER_DIRECTORY/); assert.match(page, /!known\.has\(n\.toLowerCase\(\)\)/); assert.match(page, /setForm\(\{ name, field: f, description: '' \}\)/); assert.match(page, /no skills model yet/);
  });
});

describe('frontend source guards', () => {
  const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
  it('never builds a PayPal checkout URL and never holds PayPal credentials or a PayPal variable', () => {
    for (const f of files('src')) { const s = readFileSync(f, 'utf8'); assert.ok(!/checkoutnow|api-m\.|PAYPAL_|VITE_PAYPAL|client_secret|clientSecret|\/v2\/checkout/i.test(s), f); }
    assert.ok(!/PAYPAL/i.test(readFileSync('vite.config.ts', 'utf8')));
  });
  it('sends only ids to the payment endpoints and keeps success in one place, never in a catch block', () => {
    const client = readFileSync('src/services/mentorship.ts', 'utf8');
    assert.match(client, /post<\{ orderId: string; approvalUrl: string \}>\('\/payments\/create-order', \{ bookingId \}\)/); assert.match(client, /'\/payments\/capture', \{ bookingId, orderId \}/); assert.match(client, /'\/bookings', careerId \? \{ sessionId, careerId \} : \{ sessionId \}/);
    const svc = readFileSync('src/services/checkout.ts', 'utf8'), fn = svc.slice(svc.indexOf('export async function completeCheckout'), svc.indexOf('// The buyer cancelled'));
    assert.equal((fn.match(/kind: 'confirmed'/g) ?? []).length, 1); assert.ok(fn.indexOf("kind: 'confirmed'") < fn.indexOf('catch'), 'success must come from the try path only');
    assert.match(fn, /booking\.status !== 'confirmed' \|\| payment\.status !== 'completed'/);
    const page = readFileSync('src/pages/PaymentResult.tsx', 'utf8'); assert.ok(!/kind: 'confirmed'/.test(page), 'the page only displays the service outcome');
  });
  it('re-enables the Pay buttons when the browser restores the bookings page after the PayPal redirect', () => {
    const src = readFileSync('src/pages/Bookings.tsx', 'utf8'); assert.match(src, /addEventListener\('pageshow'/); assert.match(src, /e\.persisted\) setBusy\(null\)/); assert.match(src, /removeEventListener\('pageshow'/);
  });
  it('labels sample data as demo and wires the pages into the router and navigation', () => {
    assert.match(readFileSync('src/components/mentorship/Badges.tsx', 'utf8'), /not real or verified professionals/i);
    const app = readFileSync('src/App.tsx', 'utf8'); for (const p of ['/mentors"', '/mentors/:id', '/bookings"', '/bookings/payment/return', '/bookings/payment/cancel']) assert.ok(app.includes(`path="${p.replace(/"$/, '')}`), p);
    const shell = readFileSync('src/components/layout/AppShell.tsx', 'utf8'); assert.ok(shell.includes("to: '/mentors'") && shell.includes("also: ['/bookings']"), 'Bookings is reached from Mentorship and highlights it');
    assert.match(readFileSync('src/pages/Mentors.tsx', 'utf8'), /to="\/bookings"/);
  });
  it('the evidence dialog scrolls instead of clipping its top on small screens', () => {
    const f = readFileSync('src/components/evidence/EvidenceForm.tsx', 'utf8');
    assert.ok(!/grid place-items-center overflow-y-auto/.test(f)); assert.match(f, /fixed inset-0 z-40 overflow-y-auto/); assert.match(f, /flex min-h-full items-start justify-center/);
  });
  it('uses plain booking labels, offers Pay only while payment is pending, and shows "confirmed" only from a verified result', () => {
    const badges = readFileSync('src/components/mentorship/Badges.tsx', 'utf8'); assert.match(badges, /pending_payment: \{ label: 'Payment pending'/); assert.match(badges, /confirmed: \{ label: 'Confirmed'/);
    const bookings = readFileSync('src/pages/Bookings.tsx', 'utf8'); assert.match(bookings, /b\.status === 'pending_payment' && <button/); assert.ok(!/Booking confirmed|is paid/.test(bookings));
    assert.match(readFileSync('src/pages/PaymentResult.tsx', 'utf8'), /state\.kind === 'confirmed' && \(/);
  });
});
