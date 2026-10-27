import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { api } from '../src/services/api';
import { AuthError, authService } from '../src/services/auth';
import { resetStorage } from './helpers';

// Frontend-only tests of the real-backend auth client, against scripted fake responses (no server needed).
// The server side of the same contract is exercised in server/tests/frontend-contract.test.ts.
interface Call { method: string; url: string; headers: Record<string, string>; body?: unknown }
let calls: Call[], queue: (() => Response)[], realFetch: typeof fetch;
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const jwt = (exp: number) => ['h', Buffer.from(JSON.stringify({ sub: 'u1', exp })).toString('base64url'), 's'].join('.');
const future = () => Math.floor(Date.now() / 1000) + 3600, past = () => Math.floor(Date.now() / 1000) - 10;
const session = (name = 'Ada Lovelace', exp = future()) => ({ token: jwt(exp), tokenType: 'Bearer', expiresIn: 3600, user: { id: 'u1', email: 'ada@example.com', name }, profile: {} });
const ls = () => (globalThis as unknown as { localStorage: Storage }).localStorage, ss = () => (globalThis as unknown as { sessionStorage: Storage }).sessionStorage;
const failure = async (p: Promise<unknown>) => { try { await p; } catch (e) { assert.ok(e instanceof AuthError); return e; } throw new Error('expected a rejection'); };

beforeEach(() => {
  resetStorage(); calls = []; queue = []; realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = queue.shift(); if (!next) throw new Error('unexpected fetch'); return next();
  }) as typeof fetch;
  api.setBase('http://api.test/api');
});
afterEach(() => { globalThis.fetch = realFetch; api.setBase(''); });

describe('request contract', () => {
  it('register sends {name,email,password} to /auth/register, without a token, and stores the session', async () => {
    queue.push(json(201, session()));
    const u = await authService.signUp('Ada Lovelace', 'ada@example.com', 'Password1');
    assert.deepEqual([calls[0].method, calls[0].url], ['POST', 'http://api.test/api/auth/register']);
    assert.deepEqual(calls[0].body, { name: 'Ada Lovelace', email: 'ada@example.com', password: 'Password1' }); assert.equal(calls[0].headers.Authorization, undefined);
    assert.deepEqual([u.id, u.email, u.name, u.initials], ['u1', 'ada@example.com', 'Ada Lovelace', 'AL']);
    // Sign-up opens a TAB-SCOPED session: the token is not written to persistent storage unless the user later chooses "keep me signed in" at login.
    assert.equal(ls().getItem('careergraph:token'), null); assert.ok((globalThis as unknown as { sessionStorage: Storage }).sessionStorage.getItem('careergraph:token')); assert.equal(authService.getCurrentUser()?.id, 'u1');
  });
  it('login sends only {email,password}; "remember me" off keeps the token for the tab session only', async () => {
    queue.push(json(200, session()));
    await authService.login('ada@example.com', 'Password1', false);
    assert.deepEqual(calls[0].body, { email: 'ada@example.com', password: 'Password1' }); assert.equal(calls[0].url, 'http://api.test/api/auth/login');
    assert.ok(ss().getItem('careergraph:token')); assert.equal(ls().getItem('careergraph:token'), null); assert.equal(authService.getCurrentUser()?.email, 'ada@example.com');
  });
  it('authenticated API calls carry the Bearer token', async () => {
    queue.push(json(200, session())); await authService.login('ada@example.com', 'Password1');
    queue.push(json(200, { user: {}, profile: {} })); await api.get('/auth/me');
    assert.match(calls[1].headers.Authorization, /^Bearer h\./);
  });
  it('logout posts to /auth/logout and clears the local session even if the request fails', async () => {
    queue.push(json(200, session())); await authService.login('ada@example.com', 'Password1');
    queue.push(json(204, null)); await authService.logout();
    assert.equal(calls[1].url, 'http://api.test/api/auth/logout'); assert.equal(authService.getCurrentUser(), null); assert.equal(ls().getItem('careergraph:token'), null);
    queue.push(json(200, session())); await authService.login('ada@example.com', 'Password1');
    queue.push(() => { throw new TypeError('offline'); }); await authService.logout();
    assert.equal(authService.getCurrentUser(), null, 'logged out locally although the server was unreachable');
  });
});

describe('session restoration and expiry', () => {
  it('restores a valid session from storage without any network call', () => {
    ls().setItem('careergraph:token', jwt(future())); ls().setItem('careergraph:auth-user', JSON.stringify({ id: 'u1', email: 'ada@example.com', name: 'Ada', initials: 'A' }));
    assert.equal(authService.getCurrentUser()?.id, 'u1'); assert.equal(authService.isAuthenticated(), true); assert.equal(calls.length, 0);
  });
  it('treats an expired or garbage token as logged out and removes it', () => {
    ls().setItem('careergraph:token', jwt(past())); ls().setItem('careergraph:auth-user', JSON.stringify({ id: 'u1' }));
    assert.equal(authService.getCurrentUser(), null); assert.equal(ls().getItem('careergraph:token'), null); assert.equal(ls().getItem('careergraph:auth-user'), null);
    ss().setItem('careergraph:token', 'not-a-jwt'); assert.equal(authService.getCurrentUser(), null);
  });
  it('an authenticated request rejected as expired/invalid ends the local session; a wrong password does not', async () => {
    queue.push(json(200, session())); await authService.login('ada@example.com', 'Password1');
    queue.push(json(401, { error: { code: 'invalid_credentials', message: 'Incorrect email or password.' } }));
    await failure(authService.login('ada@example.com', 'wrong'));
    assert.ok(ls().getItem('careergraph:token'), 'wrong password must not log the user out');
    queue.push(json(401, { error: { code: 'token_expired', message: 'Your session has expired. Please log in again.' } }));
    await assert.rejects(() => api.get('/auth/me'));
    assert.equal(authService.getCurrentUser(), null); assert.equal(ls().getItem('careergraph:token'), null);
  });
});

describe('error mapping for the existing forms', () => {
  it('maps server errors to AuthError fields', async () => {
    const e = (status: number, code: string, message: string, fields?: object) => json(status, { error: { code, message, fields } });
    queue.push(e(401, 'invalid_credentials', 'Incorrect email or password.')); let r = await failure(authService.login('a@b.co', 'x'));
    assert.deepEqual([r.field, r.message], ['form', 'Incorrect email or password.']);
    queue.push(e(409, 'conflict', 'An account with this email already exists.')); r = await failure(authService.signUp('A', 'a@b.co', 'Password1')); assert.equal(r.field, 'email');
    queue.push(e(400, 'validation_failed', 'Some fields are invalid.', { email: 'Enter a valid email address.' })); r = await failure(authService.signUp('A', 'bad', 'Password1')); assert.deepEqual([r.field, r.message], ['email', 'Enter a valid email address.']);
    queue.push(e(400, 'validation_failed', 'Some fields are invalid.', { password: 'Must be at least 8 characters.' })); r = await failure(authService.signUp('A', 'a@b.co', 'short')); assert.equal(r.field, 'password');
    queue.push(e(503, 'auth_not_configured', 'Authentication is not configured on this server.')); r = await failure(authService.login('a@b.co', 'x')); assert.match(r.message, /not configured/);
  });
  it('reports an unreachable backend clearly', async () => {
    queue.push(() => { throw new TypeError('Failed to fetch'); });
    assert.match((await failure(authService.login('a@b.co', 'Password1'))).message, /Could not reach the server/);
  });
});

describe('fallback and feature boundary', () => {
  it('without VITE_API_URL the local demo auth is used and no request is made', async () => {
    api.setBase('');
    const u = await authService.login('alex@example.com', 'Password1', true);
    assert.equal(u.name, 'Alex Morgan'); assert.equal(calls.length, 0); assert.equal(ls().getItem('careergraph:token'), null);
  });
  it('routing: auth, profile, progress, settings, careers, assessments, evidence and analysis all use the backend when VITE_API_URL is set', () => {
    assert.deepEqual(['auth', 'profile', 'progress', 'settings', 'careers', 'assessments', 'evidence', 'analysis'].map((f) => api.useBackend(f as never)), [true, true, true, true, true, true, true, true]);
  });
});
