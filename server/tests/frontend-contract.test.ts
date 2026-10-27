import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ApiError, api } from '../../src/services/api';
import { AuthError, authService } from '../../src/services/auth';
import { makeApp } from './helpers';

// The REAL frontend auth client (src/services/auth.ts + api.ts) talking to the REAL backend pipeline (routes, auth middleware,
// services) through a fake `fetch`. No network, no PostgreSQL, no browser: this proves the two sides agree on request/response shapes.
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, has: (k: string) => m.has(k) }; };
let app: ReturnType<typeof makeApp>, calls: string[], realFetch: typeof fetch;
const ls = () => (globalThis as unknown as { localStorage: ReturnType<typeof memory> }).localStorage;
const ss = () => (globalThis as unknown as { sessionStorage: ReturnType<typeof memory> }).sessionStorage;

beforeEach(() => {
  Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory() });
  app = makeApp({ now: () => new Date() }); calls = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url)); calls.push(`${init?.method ?? 'GET'} ${u.pathname}`);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const out = await app.handler({ method: init?.method ?? 'GET', path: u.pathname, query: {}, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(out.body === undefined ? null : JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  api.setBase('http://api.test/api');
});
afterEach(() => { globalThis.fetch = realFetch; api.setBase(''); });

describe('backend feature boundary', () => {
  it('every feature (including profile, progress and settings) uses the backend when an API URL is set, and nothing does without one', () => {
    for (const f of ['auth', 'profile', 'progress', 'settings', 'careers', 'assessments', 'evidence', 'analysis'] as const) assert.equal(api.useBackend(f), true, f);
    api.setBase(''); for (const f of ['auth', 'careers', 'assessments', 'evidence', 'analysis', 'profile', 'progress', 'settings'] as const) assert.equal(api.useBackend(f), false, f);
  });
  it('without an API URL the demo mock still works and makes no network calls', async () => {
    api.setBase('');
    const u = await authService.login('alex@example.com', 'Password1', true);
    assert.equal(u.name, 'Alex Morgan'); assert.equal(calls.length, 0);
  });
});

describe('frontend auth against the real backend', () => {
  it('signs up: backend stores a hash, frontend keeps a tab-scoped token and a typed user', async () => {
    const u = await authService.signUp('Ada Lovelace', 'Ada@Example.com', 'Password1');
    assert.deepEqual([u.name, u.email, u.initials], ['Ada Lovelace', 'ada@example.com', 'AL']); assert.match(u.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(calls, ['POST /api/auth/register']);
    assert.ok([...app.repos.users.values()][0].passwordHash.startsWith('scrypt$'));
    assert.ok(!ls().has('careergraph:token'), 'sign-up opens a tab-scoped session, not a persistent one'); assert.ok(ss().has('careergraph:token')); assert.equal(authService.getCurrentUser()?.id, u.id); assert.equal(authService.isAuthenticated(), true);
  });
  it('logs in (session-only when "remember" is off) and the api client sends the Bearer token', async () => {
    await authService.signUp('Ada Lovelace', 'ada@example.com', 'Password1'); await authService.logout();
    assert.equal(authService.getCurrentUser(), null);
    const u = await authService.login('ADA@example.com', 'Password1', false);
    assert.ok(ss().has('careergraph:token')); assert.ok(!ls().has('careergraph:token')); assert.equal(authService.getCurrentUser()?.email, 'ada@example.com');
    const me = await api.get<{ user: { id: string }; profile: { userId: string } }>('/auth/me');
    assert.equal(me.user.id, u.id); assert.equal(me.profile.userId, u.id);
  });
  it('reads and updates the profile through the same client; field names match the contract', async () => {
    await authService.signUp('Ada Lovelace', 'ada@example.com', 'Password1');
    const put = await api.put<Record<string, unknown>>('/profile', { targetCareerId: 'ux', experienceSummary: 'x', educationSummary: 'y', aboutNote: 'z', name: 'Ada L.' });
    for (const k of ['name', 'email', 'targetCareerId', 'experienceSummary', 'educationSummary', 'aboutNote']) assert.ok(k in put, k);
    assert.equal(put.targetCareerId, 'ux'); assert.equal((await api.get<{ name: string }>('/profile')).name, 'Ada L.');
    await assert.rejects(() => api.put('/profile', { targetCareerId: 'nope' }), (e) => e instanceof ApiError && e.status === 400 && !!e.fields?.targetCareerId);
  });
  it('maps server errors to the AuthError fields the existing forms already show', async () => {
    await authService.signUp('Ada Lovelace', 'ada@example.com', 'Password1'); await authService.logout();
    const field = async (p: Promise<unknown>) => { try { await p; return 'no error'; } catch (e) { assert.ok(e instanceof AuthError); return `${e.field}: ${e.message}`; } };
    assert.equal(await field(authService.login('ada@example.com', 'Wrong1234')), 'form: Incorrect email or password.');
    assert.match(await field(authService.signUp('Dup', 'ada@example.com', 'Password1')), /^email: An account with this email already exists/);
    assert.match(await field(authService.signUp('Weak', 'weak@example.com', 'short')), /^password:/);
    assert.match(await field(authService.signUp('Bad', 'not-an-email', 'Password1')), /^email:/);
    globalThis.fetch = (async () => { throw new TypeError('network down'); }) as typeof fetch;
    assert.match(await field(authService.login('ada@example.com', 'Password1')), /^form: Could not reach the server/);
  });
  it('logout clears the client session; an expired token is treated as logged out', async () => {
    await authService.signUp('Ada Lovelace', 'ada@example.com', 'Password1'); await authService.logout();
    assert.equal(authService.getCurrentUser(), null); assert.ok(!ls().has('careergraph:token') && !ls().has('careergraph:auth-user')); assert.ok(calls.includes('POST /api/auth/logout'));
    app = makeApp({ now: () => new Date(Date.now() - 2 * 86_400_000) }); // tokens issued two days ago with a 1h lifetime
    await authService.signUp('Old Session', 'old@example.com', 'Password1');
    assert.equal(authService.getCurrentUser(), null); assert.ok(!ls().has('careergraph:token'), 'expired token removed');
  });
  it('is user-isolated end to end: two real sessions never see each other', async () => {
    await authService.signUp('Ada Lovelace', 'ada@example.com', 'Password1');
    await api.put('/profile', { aboutNote: 'ADA ONLY' }); await authService.logout();
    await authService.signUp('Ben Carter', 'ben@example.com', 'Secret123');
    const profile = await api.get<{ aboutNote: string | null; email: string }>('/profile');
    assert.equal(profile.aboutNote, null); assert.equal(profile.email, 'ben@example.com');
  });
});
