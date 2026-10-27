import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { makeApp } from './helpers';

const ADA = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'Password1' };
const BEN = { name: 'Ben Carter', email: 'ben@example.com', password: 'Secret123' };
type App = ReturnType<typeof makeApp>;
const register = async (app: App, u = ADA) => { const r = await app.call('POST', '/api/auth/register', { body: u }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body as { token: string; user: { id: string }; profile: { userId: string } }; };
const FORBIDDEN = /scrypt\$|passwordHash|password_hash|Password1|Secret123/;

describe('registration and login', () => {
  it('registers, normalizes the email and creates a profile', async () => {
    const app = makeApp();
    const r = await app.call('POST', '/api/auth/register', { body: { ...ADA, email: '  ADA@Example.COM ' } });
    assert.equal(r.status, 201); assert.equal(r.body.tokenType, 'Bearer'); assert.ok(r.body.token); assert.equal(r.body.user.email, 'ada@example.com');
    assert.equal(r.body.profile.name, 'Ada Lovelace'); assert.equal(r.body.profile.targetCareerId, null); assert.equal(app.repos.profiles.size, 1);
  });
  it('rejects a duplicate email (case-insensitive) without creating a second account', async () => {
    const app = makeApp(); await register(app);
    const r = await app.call('POST', '/api/auth/register', { body: { ...ADA, email: 'ADA@example.com', name: 'Other' } });
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'conflict'); assert.equal(app.repos.users.size, 1);
  });
  it('stores only a salted hash, never the password', async () => {
    const app = makeApp(); await register(app); await register(app, { ...BEN, password: 'Password1' });
    const hashes = [...app.repos.users.values()].map((u) => u.passwordHash);
    assert.ok(hashes.every((h) => h.startsWith('scrypt$') && !h.includes('Password1')));
    assert.notEqual(hashes[0], hashes[1], 'same password, different salt');
  });
  it('logs in with the right password (any email case)', async () => {
    const app = makeApp(); const reg = await register(app);
    const r = await app.call('POST', '/api/auth/login', { body: { email: 'ADA@example.com', password: 'Password1' } });
    assert.equal(r.status, 200); assert.equal(r.body.user.id, reg.user.id); assert.ok(r.body.token);
  });
  it('gives the same answer for a wrong password and an unknown email', async () => {
    const app = makeApp(); await register(app);
    const wrong = await app.call('POST', '/api/auth/login', { body: { email: ADA.email, password: 'Wrong1234' } });
    const unknown = await app.call('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'Password1' } });
    assert.equal(wrong.status, 401); assert.equal(unknown.status, 401);
    assert.deepEqual([wrong.body.error.code, wrong.body.error.message], [unknown.body.error.code, unknown.body.error.message]);
    assert.equal(wrong.body.error.code, 'invalid_credentials');
  });
  it('validates email and password rules', async () => {
    const app = makeApp();
    for (const email of ['', 'nope', 'a@b', 'a b@c.com', 5]) { const r = await app.call('POST', '/api/auth/register', { body: { ...ADA, email } }); assert.equal(r.status, 400, String(email)); assert.ok(r.body.error.fields.email); }
    for (const password of ['short1', 'longpasswordnonumber', '12345678', 'x'.repeat(129) + '1']) { const r = await app.call('POST', '/api/auth/register', { body: { ...ADA, password } }); assert.equal(r.status, 400, password); assert.ok(r.body.error.fields.password); }
    assert.equal((await app.call('POST', '/api/auth/register', { body: { ...ADA, name: '' } })).body.error.fields.name !== undefined, true);
    assert.equal((await app.call('POST', '/api/auth/register', { body: 'nope' })).status, 400);
    assert.equal(app.repos.users.size, 0);
  });
  it('treats SQL-looking input as plain data', async () => {
    const app = makeApp(); await register(app);
    const r = await app.call('POST', '/api/auth/login', { body: { email: "ada@example.com' OR '1'='1", password: "' OR 1=1 --" } });
    assert.equal(r.status, 400); // not even a valid email
    assert.equal((await app.call('POST', '/api/auth/login', { body: { email: ADA.email, password: "' OR 1=1 --" } })).status, 401);
  });
});

describe('authentication middleware', () => {
  it('requires a token', async () => {
    const app = makeApp(); const r = await app.call('GET', '/api/auth/me');
    assert.equal(r.status, 401); assert.equal(r.body.error.code, 'token_missing'); assert.equal(r.headers['WWW-Authenticate'], 'Bearer');
    assert.equal((await app.call('GET', '/api/profile')).status, 401); assert.equal((await app.call('PUT', '/api/profile', { body: { name: 'x' } })).status, 401);
  });
  it('rejects malformed tokens and headers', async () => {
    const app = makeApp(); await register(app);
    for (const token of ['garbage', 'a.b.c', 'x'.repeat(200)]) { const r = await app.call('GET', '/api/auth/me', { token }); assert.equal(r.status, 401, token); assert.equal(r.body.error.code, 'invalid_token'); }
    for (const authorization of ['Token abc', 'Bearer', 'Bearer a b', 'bearer abc']) assert.equal((await app.call('GET', '/api/auth/me', { headers: { authorization } })).status, 401, authorization);
  });
  it('rejects expired, forged and wrong-secret tokens', async () => {
    const app = makeApp(); const { token, user } = await register(app);
    assert.equal((await app.call('GET', '/api/auth/me', { token })).status, 200);
    app.clock.ms += 3601_000;
    const expired = await app.call('GET', '/api/auth/me', { token }); assert.equal(expired.status, 401); assert.equal(expired.body.error.code, 'token_expired');
    app.clock.ms -= 3601_000;
    const [h, p, s] = token.split('.'); const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: 'other', typ: 'access', iat: 1, exp: 9e9 })).toString('base64url')}.${s}`;
    assert.equal((await app.call('GET', '/api/auth/me', { token: tampered })).body.error.code, 'invalid_token');
    const body = `${h}.${Buffer.from(JSON.stringify({ sub: user.id, typ: 'access', iat: 1, exp: 9e9 })).toString('base64url')}`;
    const wrongKey = `${body}.${createHmac('sha256', 'k'.repeat(40)).update(body).digest('base64url')}`;
    assert.equal((await app.call('GET', '/api/auth/me', { token: wrongKey })).status, 401); void p;
  });
  it('rejects a valid token whose account no longer exists', async () => {
    const app = makeApp(); const { token, user } = await register(app); app.repos.users.delete(user.id);
    assert.equal((await app.call('GET', '/api/auth/me', { token })).status, 401);
  });
  it('returns the authenticated user and profile from /auth/me', async () => {
    const app = makeApp(); const { token, user } = await register(app);
    const r = await app.call('GET', '/api/auth/me', { token });
    assert.equal(r.status, 200); assert.equal(r.body.user.id, user.id); assert.equal(r.body.user.email, ADA.email); assert.equal(r.body.profile.userId, user.id);
  });
  it('logout is stateless: it answers 204 but does not revoke the token (documented behaviour)', async () => {
    const app = makeApp(); const { token } = await register(app);
    assert.equal((await app.call('POST', '/api/auth/logout')).status, 204);
    assert.equal((await app.call('GET', '/api/auth/me', { token })).status, 200);
  });
  it('fails safely (503) and creates nothing when JWT_SECRET is not configured', async () => {
    const app = makeApp({ config: { jwtSecret: null } });
    const r = await app.call('POST', '/api/auth/register', { body: ADA });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'auth_not_configured'); assert.equal(app.repos.users.size, 0);
    assert.equal((await app.call('GET', '/api/auth/me', { token: 'a.b.c' })).status, 503);
    assert.equal((await app.call('GET', '/api/health')).status, 200);
  });
});

describe('profile', () => {
  it('reads and updates the authenticated profile, and persists it', async () => {
    const app = makeApp(); const { token } = await register(app);
    assert.equal((await app.call('GET', '/api/profile', { token })).body.aboutNote, null);
    const r = await app.call('PUT', '/api/profile', { token, body: { name: 'Ada L.', targetCareerId: 'ux', experienceSummary: 'Two internships', educationSummary: 'BA Design', aboutNote: 'Switching careers' } });
    assert.equal(r.status, 200); assert.deepEqual([r.body.name, r.body.targetCareerId, r.body.experienceSummary, r.body.educationSummary, r.body.aboutNote], ['Ada L.', 'ux', 'Two internships', 'BA Design', 'Switching careers']);
    const again = (await app.call('GET', '/api/profile', { token })).body; assert.equal(again.targetCareerId, 'ux'); assert.equal(again.name, 'Ada L.');
    assert.equal((await app.call('GET', '/api/auth/me', { token })).body.user.name, 'Ada L.');
  });
  it('supports partial updates and clearing with null or empty text', async () => {
    const app = makeApp(); const { token } = await register(app);
    await app.call('PUT', '/api/profile', { token, body: { aboutNote: 'hello', targetCareerId: 'fin' } });
    const r = await app.call('PUT', '/api/profile', { token, body: { aboutNote: '   ', targetCareerId: null } });
    assert.equal(r.body.aboutNote, null); assert.equal(r.body.targetCareerId, null); assert.equal(r.body.name, ADA.name, 'untouched field stays');
    const keep = await app.call('PUT', '/api/profile', { token, body: { educationSummary: 'MSc' } }); assert.equal(keep.body.educationSummary, 'MSc');
  });
  it('rejects an unknown target career without changing the profile', async () => {
    const app = makeApp(); const { token } = await register(app);
    await app.call('PUT', '/api/profile', { token, body: { targetCareerId: 'ux' } });
    const r = await app.call('PUT', '/api/profile', { token, body: { targetCareerId: 'no-such-career' } });
    assert.equal(r.status, 400); assert.equal(r.body.error.code, 'validation_failed'); assert.ok(r.body.error.fields.targetCareerId);
    assert.equal((await app.call('GET', '/api/profile', { token })).body.targetCareerId, 'ux');
  });
  it('validates fields and requires something to update', async () => {
    const app = makeApp(); const { token } = await register(app);
    for (const body of [{ aboutNote: 'x'.repeat(501) }, { name: '' }, { experienceSummary: 5 }, { educationSummary: 'x'.repeat(501) }, {}, 'nope'])
      assert.equal((await app.call('PUT', '/api/profile', { token, body })).status, 400, JSON.stringify(body).slice(0, 40));
  });
});

describe('user isolation', () => {
  it('each user only ever sees their own profile', async () => {
    const app = makeApp(); const a = await register(app, ADA), b = await register(app, BEN);
    await app.call('PUT', '/api/profile', { token: a.token, body: { aboutNote: 'ADA PRIVATE NOTE' } });
    await app.call('PUT', '/api/profile', { token: b.token, body: { aboutNote: 'BEN PRIVATE NOTE' } });
    const ra = await app.call('GET', '/api/profile', { token: a.token }), rb = await app.call('GET', '/api/profile', { token: b.token });
    assert.equal(ra.body.userId, a.user.id); assert.equal(rb.body.userId, b.user.id);
    assert.ok(!JSON.stringify(ra.body).includes('BEN') && !JSON.stringify(rb.body).includes('ADA'));
  });
  it('ignores any user id supplied by the client (query, body or path)', async () => {
    const app = makeApp(); const a = await register(app, ADA), b = await register(app, BEN);
    assert.equal((await app.call('GET', '/api/profile?userId=' + b.user.id, { token: a.token })).body.userId, a.user.id);
    const r = await app.call('PUT', '/api/profile', { token: a.token, body: { userId: b.user.id, user_id: b.user.id, id: b.user.id, email: 'hacked@example.com', aboutNote: 'written by A' } });
    assert.equal(r.status, 200); assert.equal(r.body.userId, a.user.id);
    const ben = (await app.call('GET', '/api/profile', { token: b.token })).body;
    assert.equal(ben.aboutNote, null); assert.equal(ben.email, BEN.email); assert.equal(app.repos.users.get(a.user.id)?.email, ADA.email, 'email is not editable through the profile');
    assert.equal((await app.call('GET', `/api/profile/${b.user.id}`, { token: a.token })).status, 404, 'there is no by-id profile route');
  });
  it("A's token never grants access to B's data after B changes, and tokens are bound to their user", async () => {
    const app = makeApp(); const a = await register(app, ADA), b = await register(app, BEN);
    await app.call('PUT', '/api/profile', { token: b.token, body: { name: 'Ben Changed' } });
    assert.equal((await app.call('GET', '/api/auth/me', { token: a.token })).body.user.name, 'Ada Lovelace');
  });
});

describe('secret hygiene', () => {
  it('never returns password hashes or passwords, in successes or errors', async () => {
    const app = makeApp(); const out: unknown[] = [];
    const reg = await app.call('POST', '/api/auth/register', { body: ADA }); out.push(reg.body);
    out.push((await app.call('POST', '/api/auth/register', { body: ADA })).body);
    out.push((await app.call('POST', '/api/auth/login', { body: { email: ADA.email, password: 'Password1' } })).body);
    out.push((await app.call('POST', '/api/auth/login', { body: { email: ADA.email, password: 'Nope12345' } })).body);
    out.push((await app.call('GET', '/api/auth/me', { token: reg.body.token })).body);
    out.push((await app.call('GET', '/api/profile', { token: reg.body.token })).body);
    out.push((await app.call('PUT', '/api/profile', { token: reg.body.token, body: { aboutNote: 'x' } })).body);
    out.push((await app.call('POST', '/api/auth/register', { body: { ...ADA, password: 'weak' } })).body);
    for (const o of out) assert.ok(!FORBIDDEN.test(JSON.stringify(o)), JSON.stringify(o).slice(0, 120));
  });
});
