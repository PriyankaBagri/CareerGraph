import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEMO_MENTORS } from '../src/domain/demoMentors';
import { makeApp } from './helpers';

type App = ReturnType<typeof makeApp>;
const reg = async (app: App, email: string) => (await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email, password: 'Passw0rdOK1' } })).body as { token: string; user: { id: string } };
const S1 = DEMO_MENTORS[0].sessions[0]; // 25.00 USD
const book = (app: App, token: string | undefined, body: unknown) => app.call('POST', '/api/bookings', { token, body });

describe('mentor discovery', () => {
  it('requires authentication on every mentorship endpoint', async () => {
    const app = makeApp();
    for (const [m, p] of [['GET', '/api/mentors'], ['GET', `/api/mentors/${DEMO_MENTORS[0].id}`], ['POST', '/api/bookings'], ['GET', '/api/bookings']]) assert.equal((await app.call(m, p)).status, 401, `${m} ${p}`);
  });
  it('lists active mentors, every one labelled as demo data and not a real professional', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    const r = await app.call('GET', '/api/mentors', { token: a.token });
    assert.equal(r.status, 200); assert.equal(r.body.mentors.length, DEMO_MENTORS.length);
    for (const m of r.body.mentors) { assert.equal(m.isDemo, true); assert.match(m.bio, /demo profile.*not a real or verified professional/); assert.ok(m.displayName.startsWith('Demo Mentor')); }
  });
  it('returns a mentor with only their active sessions, with server prices as exact decimal strings', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'); const [m] = DEMO_MENTORS;
    const r = await app.call('GET', `/api/mentors/${m.id}`, { token: a.token });
    assert.equal(r.status, 200); assert.equal(r.body.mentor.id, m.id); assert.deepEqual(r.body.sessions.map((s: { price: string }) => s.price), ['25.00', '45.00']);
    assert.equal(typeof r.body.sessions[0].price, 'string'); assert.equal(r.body.sessions[0].currency, 'USD');
    app.repos.sessions.get(S1.id)!.isActive = false;
    assert.deepEqual((await app.call('GET', `/api/mentors/${m.id}`, { token: a.token })).body.sessions.map((s: { id: string }) => s.id), [m.sessions[1].id]);
  });
  it('rejects a malformed id (400), reports an unknown id (404), and hides inactive mentors from the list and detail', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    assert.equal((await app.call('GET', '/api/mentors/not-a-uuid', { token: a.token })).status, 400);
    const unknown = await app.call('GET', '/api/mentors/00000000-0000-4000-8000-0000000fffff', { token: a.token });
    assert.equal(unknown.status, 404); assert.equal(unknown.body.error.code, 'mentor_not_found');
    app.repos.mentors.get(DEMO_MENTORS[0].id)!.isActive = false;
    assert.ok(!(await app.call('GET', '/api/mentors', { token: a.token })).body.mentors.some((m: { id: string }) => m.id === DEMO_MENTORS[0].id));
    assert.equal((await app.call('GET', `/api/mentors/${DEMO_MENTORS[0].id}`, { token: a.token })).status, 404);
  });
});

describe('bookings', () => {
  it('creates a pending_payment booking whose price comes from the database', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    const r = await book(app, a.token, { sessionId: S1.id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const b = r.body.booking;
    assert.equal(b.status, 'pending_payment'); assert.equal(b.amount, '25.00'); assert.equal(b.currency, 'USD'); assert.equal(b.sessionId, S1.id);
    assert.equal(b.session.title, S1.title); assert.equal(b.mentor.isDemo, true); assert.ok(!('userId' in b));
    assert.equal(app.repos.bookings.size, 1);
  });
  it('ignores a browser-supplied price, user id or status', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const r = await book(app, a.token, { sessionId: S1.id, amount: '0.01', price: 0.01, currency: 'JPY', userId: b.user.id, status: 'confirmed' });
    assert.equal(r.status, 201); assert.equal(r.body.booking.amount, '25.00'); assert.equal(r.body.booking.currency, 'USD'); assert.equal(r.body.booking.status, 'pending_payment');
    assert.equal([...app.repos.bookings.values()][0].userId, a.user.id);
    assert.equal((await app.call('GET', '/api/bookings', { token: b.token })).body.bookings.length, 0);
  });
  it('validates the request: a session id is required and must be a valid id', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    for (const body of [{}, { sessionId: '' }, { sessionId: 7 }, { sessionId: 'nope' }, { sessionId: "' OR 1=1 --" }, [], undefined]) assert.equal((await book(app, a.token, body)).status, 400, JSON.stringify(body));
    assert.equal(app.repos.bookings.size, 0);
  });
  it('refuses an unknown, inactive or inactive-mentor session with 404 and creates nothing', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    const unknown = await book(app, a.token, { sessionId: '00000000-0000-4000-8000-0000000fffff' });
    assert.equal(unknown.status, 404); assert.equal(unknown.body.error.code, 'session_unavailable');
    app.repos.sessions.get(S1.id)!.isActive = false;
    assert.equal((await book(app, a.token, { sessionId: S1.id })).status, 404);
    app.repos.mentors.get(DEMO_MENTORS[1].id)!.isActive = false;
    assert.equal((await book(app, a.token, { sessionId: DEMO_MENTORS[1].sessions[0].id })).status, 404);
    assert.equal(app.repos.bookings.size, 0);
  });
  it('allows one unpaid booking per student and session (409), but other students may book the same session', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    assert.equal((await book(app, a.token, { sessionId: S1.id })).status, 201);
    const dup = await book(app, a.token, { sessionId: S1.id });
    assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'conflict');
    assert.equal((await book(app, b.token, { sessionId: S1.id })).status, 201);
    assert.equal((await book(app, a.token, { sessionId: DEMO_MENTORS[0].sessions[1].id })).status, 201);
    assert.equal(app.repos.bookings.size, 3);
  });
  it('keeps the price agreed at booking time even if the session price changes later', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    await book(app, a.token, { sessionId: S1.id });
    app.repos.sessions.get(S1.id)!.price = '99.00';
    assert.equal((await app.call('GET', '/api/bookings', { token: a.token })).body.bookings[0].amount, '25.00');
    app.repos.bookings.clear(); // a NEW booking uses the new database price
    assert.equal((await book(app, a.token, { sessionId: S1.id })).body.booking.amount, '99.00');
  });
  it('lists only the signed-in student\'s own bookings, newest first', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    await book(app, a.token, { sessionId: S1.id }); app.clock.ms += 1000; await book(app, a.token, { sessionId: DEMO_MENTORS[1].sessions[0].id }); await book(app, b.token, { sessionId: DEMO_MENTORS[2].sessions[0].id });
    const mine = (await app.call('GET', '/api/bookings', { token: a.token })).body.bookings as { sessionId: string }[];
    assert.deepEqual(mine.map((x) => x.sessionId), [DEMO_MENTORS[1].sessions[0].id, S1.id]);
    assert.deepEqual((await app.call('GET', '/api/bookings', { token: b.token })).body.bookings.map((x: { sessionId: string }) => x.sessionId), [DEMO_MENTORS[2].sessions[0].id]);
  });
});
