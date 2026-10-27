import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeApiMode, formatModeLine } from '../src/services/diagnostics';
import { addNote, getDiagState, recordRequest, resetDiag } from '../src/services/diagStore';
import { coreApi } from '../src/services/coreApi';
import { api } from '../src/services/api';
import { makeApp } from '../server/tests/helpers';
import { resetStorage } from './helpers';

describe('data-source indicator', () => {
  it('explains why the app is local, per env state', () => {
    assert.match(describeApiMode('', 'unset').reason, /not loaded at all.*\.env\.txt/s);
    assert.match(describeApiMode('', 'empty').reason, /blank/);
    assert.match(formatModeLine(describeApiMode('')), /LOCAL DEMO DATA/);
  });
  it('flags a missing or doubled /api and accepts the right URL', () => {
    assert.deepEqual(describeApiMode('http://localhost:4000/api').problems, []);
    assert.equal(describeApiMode('http://localhost:4000').problems.length, 1);
    assert.match(describeApiMode('http://localhost:4000/api/api').problems[0], /twice/);
    assert.match(formatModeLine(describeApiMode('http://localhost:4000/api')), /^Data source: BACKEND \(http:\/\/localhost:4000\/api\)$/);
  });
  it('store keeps only method, path, status, code, timing', () => {
    resetDiag(); recordRequest({ method: 'GET', path: '/x', status: 401, code: 'invalid_token', ms: 3 }); addNote('n'); addNote('n');
    const s = getDiagState(); assert.equal(s.failures, 1); assert.deepEqual(s.notes, ['n']);
    assert.deepEqual(Object.keys(s.last as object).sort(), ['code', 'method', 'ms', 'path', 'status']);
  });
});

describe('frontend paths match the backend routes', () => {
  it('every endpoint coreApi uses answers (not 404) on the real backend pipeline, with exactly one /api', async () => {
    resetStorage(); const backend = makeApp({ now: () => new Date() }); const seen: string[] = []; const real = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).replace('http://api.test', ''); seen.push(path);
      const h = (init?.headers ?? {}) as Record<string, string>;
      const r = await backend.call(init?.method ?? 'GET', path, { body: init?.body ? JSON.parse(String(init.body)) : undefined, token: h.Authorization?.replace('Bearer ', '') });
      return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      api.setBase('http://api.test/api/'); // trailing slash is tolerated
      const { authService } = await import('../src/services/auth');
      await authService.signUp('Ada', 'ada@example.com', 'Passw0rdOK1');
      await coreApi.listCareers(); await coreApi.listSkillAssessments(); await coreApi.listEvidence();
    } finally { globalThis.fetch = real; api.setBase(''); }
    assert.ok(seen.every((p) => p.startsWith('/api/') && !p.includes('/api/api') && !p.includes('//')), seen.join(','));
  });
});

describe('backend mode does not use or imitate local mock auth', () => {
  it('ignores a local mock session, rejects the demo account, and reports password reset honestly', async () => {
    resetStorage(); const { authService } = await import('../src/services/auth');
    const store = (globalThis as unknown as { localStorage: Storage }).localStorage;
    api.setBase(''); await authService.login('alex@example.com', 'Password1', true); // local demo session exists
    assert.ok(authService.getCurrentUser());
    api.setBase('http://api.test/api');
    assert.equal(authService.getCurrentUser(), null); // backend mode: the mock session is not trusted
    assert.ok(store.getItem('careergraph:session')); // ...but it is left untouched
    const real = globalThis.fetch; globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 'invalid_credentials', message: 'Incorrect email or password.' } }), { status: 401 })) as typeof fetch;
    try { await assert.rejects(() => authService.login('alex@example.com', 'Password1', true)); } finally { globalThis.fetch = real; api.setBase(''); }
    api.setBase('http://api.test/api'); await assert.rejects(() => authService.requestPasswordReset('a@b.co'), /not available/); api.setBase('');
  });
});
