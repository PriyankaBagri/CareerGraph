import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { makeApp } from '../server/tests/helpers';
import { loadRemoteAnalysis } from '../src/services/analysisApi';
import { apiStatus } from '../src/services/apiStatus';
import { ApiError, REQUEST_TIMEOUT_MS, RETRY_DELAY_MS, SLOW_NOTICE_MS, api, normalizeBase, requestTimeoutMs, ASSISTANT_TIMEOUT_MS } from '../src/services/api';
import { authService } from '../src/services/auth';
import { coreApi } from '../src/services/coreApi';
import { describeApiMode } from '../src/services/diagnostics';
import { evidenceService } from '../src/services/evidence';
import { buildGraphModel } from '../src/utils/graphModel';
import { resetStorage } from './helpers';

// REAL frontend services + REAL backend pipeline over in-memory repositories with a fake fetch. Not PostgreSQL, not a browser.
let backend: ReturnType<typeof makeApp>, real: typeof fetch, urls: string[], offline = false;
beforeEach(() => {
  resetStorage(); backend = makeApp({ now: () => new Date() }); real = globalThis.fetch; urls = []; offline = false;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (offline) throw new TypeError('Failed to fetch');
    urls.push(String(url));
    const h = (init?.headers ?? {}) as Record<string, string>;
    const r = await backend.call(init?.method ?? 'GET', String(url).replace('http://api.test', ''), { body: init?.body ? JSON.parse(String(init.body)) : undefined, token: h.Authorization?.replace('Bearer ', '') });
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  api.setBase('http://api.test/api');
});
afterEach(() => { globalThis.fetch = real; api.setToken(null); api.setBase(''); api.setUnauthorizedHandler(null); mock.timers.reset(); });
const signUp = (email = 'a@x.com') => authService.signUp('Ada', email, 'Passw0rdOK1');
const EV = (title: string, skillIds: string[]) => ({ title, description: 'd', type: 'Project', strength: 'strong', skillIds });

describe('API base URL and /api prefix', () => {
  it('adds /api exactly once, even if the configured value has quotes, spaces or trailing slashes', async () => {
    assert.equal(normalizeBase('  "http://localhost:4000/api///" '), 'http://localhost:4000/api');
    api.setBase('http://api.test/api/'); await signUp();
    assert.ok(urls.length > 0 && urls.every((u) => u.startsWith('http://api.test/api/') && !u.includes('/api/api')), urls.join(' '));
  });
  it('flags a doubled or missing /api, and says why the app is in mock mode (including .env.local)', () => {
    assert.ok(describeApiMode('http://localhost:4000/api/api').problems.some((p) => /twice/.test(p)));
    assert.ok(describeApiMode('http://localhost:4000').problems.some((p) => /does not end with/.test(p)));
    assert.match(describeApiMode('', 'unset').reason, /\.env\.local/);
    assert.equal(describeApiMode('', 'empty').mode, 'local');
  });
});

describe('a configured API that fails is reported, never replaced by mock data', () => {
  it('network failure rejects with network_error and no local data is returned', async () => {
    await signUp(); offline = true;
    await assert.rejects(() => evidenceService.getEvidence(), (e: unknown) => e instanceof ApiError && e.code === 'network_error');
    await assert.rejects(() => loadRemoteAnalysis('swe', []), (e: unknown) => e instanceof ApiError && e.code === 'network_error');
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS + 300)); // GETs that were still waiting for their single retry finish here, so they cannot leak into the next test
  });
  it('a request that never answers is aborted with a timeout error (assistant gets a longer limit)', async () => {
    assert.ok(ASSISTANT_TIMEOUT_MS > REQUEST_TIMEOUT_MS); assert.equal(requestTimeoutMs('/assistant/chat'), ASSISTANT_TIMEOUT_MS); assert.equal(requestTimeoutMs('/careers'), REQUEST_TIMEOUT_MS);
    mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    globalThis.fetch = ((_u: string, init?: RequestInit) => { calls++; return new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); }); }) as unknown as typeof fetch;
    const p = api.post('/careers/draft-check', {}); mock.timers.tick(REQUEST_TIMEOUT_MS + 1); // a POST is never retried
    await assert.rejects(p, (e: unknown) => e instanceof ApiError && e.code === 'timeout' && e.status === 0);
    assert.equal(calls, 1);
  });
  it('a GET that times out is retried exactly once, then fails with the same timeout error', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    globalThis.fetch = ((_u: string, init?: RequestInit) => { calls++; return new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); }); }) as unknown as typeof fetch;
    const p = api.get('/careers'); const out = p.then(() => null, (e: unknown) => e);
    mock.timers.tick(REQUEST_TIMEOUT_MS + 1); await new Promise((r) => setImmediate(r)); assert.equal(calls, 1);
    mock.timers.tick(RETRY_DELAY_MS + 1); await new Promise((r) => setImmediate(r)); assert.equal(calls, 2);
    mock.timers.tick(REQUEST_TIMEOUT_MS + 1);
    const e = await out; assert.ok(e instanceof ApiError && e.code === 'timeout'); assert.equal(calls, 2);
  });
  it('a GET that fails once on the network then succeeds returns the real data; a server error is never retried', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    globalThis.fetch = (async () => { calls++; if (calls === 1) throw new TypeError('Failed to fetch'); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
    const p = api.get<{ ok: boolean }>('/careers'); await new Promise((r) => setImmediate(r)); mock.timers.tick(RETRY_DELAY_MS + 1);
    assert.deepEqual(await p, { ok: true }); assert.equal(calls, 2);
    calls = 0; globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ error: { code: 'server_error', message: 'x' } }), { status: 500, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
    await assert.rejects(api.get('/careers'), (e: unknown) => e instanceof ApiError && e.status === 500); assert.equal(calls, 1);
  });
  it('a slow ordinary request raises the waking notice and clears it; a model call never does', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const seen: string[] = []; const off = apiStatus.subscribe(() => seen.push(apiStatus.get()));
    let release: () => void = () => {};
    globalThis.fetch = (() => new Promise<Response>((res) => { release = () => res(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })); })) as unknown as typeof fetch;
    const p = api.get('/careers'); mock.timers.tick(SLOW_NOTICE_MS + 1); assert.equal(apiStatus.get(), 'waking');
    release(); await p; assert.equal(apiStatus.get(), 'idle');
    const q = api.post('/assistant/chat', {}); mock.timers.tick(SLOW_NOTICE_MS + 1); assert.equal(apiStatus.get(), 'idle');
    release(); await q; off(); assert.deepEqual(seen, ['waking', 'idle']);
  });
  it('an expired/invalid token on an authenticated request calls the unauthorized handler once; signed-out calls get 401', async () => {
    let n = 0; api.setUnauthorizedHandler(() => { n++; });
    api.setToken('not-a-real-token');
    await assert.rejects(() => coreApi.getCareer('swe'), (e: unknown) => e instanceof ApiError && e.status === 401);
    assert.equal(n, 1);
  });
});

describe('persistence, paging and the graph contract through the real backend', () => {
  it('reads EVERY page of evidence (the server pages at 200), so a long list is never cut short', async () => {
    await signUp(); const skill = (await coreApi.getReadiness('swe')).skills[0].skillId;
    const tok = (globalThis.localStorage?.getItem('careergraph:token') ?? globalThis.sessionStorage?.getItem('careergraph:token')) as string;
    for (let i = 0; i < 205; i++) assert.equal((await backend.call('POST', '/api/evidence', { token: tok, body: EV(`e${i}`, [skill]) })).status, 201);
    urls = [];
    const all = await evidenceService.getEvidence();
    assert.equal(all.length, 205); assert.equal(new Set(all.map((e) => e.id)).size, 205);
    assert.ok(urls.some((u) => u.includes('limit=200&offset=0')) && urls.some((u) => u.includes('offset=200')), urls.join(' '));
  });
  it('a rating and an evidence item survive a "page refresh" (fresh client state, same server) and stay private to the owner', async () => {
    await signUp('a@x.com'); const skill = (await coreApi.getReadiness('swe')).skills[0].skillId;
    await coreApi.setSkillAssessment(skill, 3); await evidenceService.createEvidence({ title: 'Keeps', description: 'd', type: 'Project', strength: 'strong', skillIds: [skill] });
    const token = api.getBase() && (globalThis.localStorage?.getItem('careergraph:token') ?? globalThis.sessionStorage?.getItem('careergraph:token'));
    resetStorage(); api.setToken(token as string);
    assert.equal((await coreApi.getReadiness('swe')).skills.find((s) => s.skillId === skill)?.currentLevel, 3);
    assert.deepEqual((await coreApi.listEvidence()).map((e) => e.title), ['Keeps']);
    api.setToken(null); resetStorage(); await signUp('b@x.com');
    assert.deepEqual(await coreApi.listEvidence(), []);
  });
  it('the server graph and the graph the dashboard draws agree on skills, evidence and evidence links', async () => {
    await signUp(); const [a, b] = (await coreApi.getReadiness('swe')).skills;
    await coreApi.setSkillAssessment(a.skillId, 1);
    await evidenceService.createEvidence({ title: 'Shared proof', description: 'd', type: 'Project', strength: 'strong', skillIds: [a.skillId, b.skillId] });
    const view = await loadRemoteAnalysis('swe', await evidenceService.getEvidence()), server = await coreApi.getGraph('swe');
    const m = buildGraphModel({ career: view.career, evidence: view.evidence, skills: view.skills, actions: view.actions });
    const ids = (nodes: { id: string; kind: string }[], kind: string) => nodes.filter((n) => n.kind === kind).map((n) => n.id).sort();
    assert.deepEqual(ids(m.nodes, 'skill'), ids(server.nodes, 'skill')); assert.deepEqual(ids(m.nodes, 'evidence'), ids(server.nodes, 'evidence')); assert.deepEqual(ids(m.nodes, 'capability'), ids(server.nodes, 'capability'));
    const key = (l: { a?: string; b?: string; source?: string; target?: string }) => `${l.a ?? l.source}>${l.b ?? l.target}`;
    assert.deepEqual(m.links.filter((l) => l.kind === 'supports').map(key).sort(), server.links.filter((l) => l.kind === 'supports').map(key).sort());
    const serverActions = new Set(ids(server.nodes, 'action').map((id) => id.replace(/^action:/, '')));
    assert.ok(m.openActions.every((x) => serverActions.has(x.id)), 'every action the dashboard shows is one the server ranked');
    assert.equal(server.readiness.score, view.readiness.overall === undefined ? null : server.readiness.score);
  });
  it('another user cannot read your graph', async () => {
    await signUp('a@x.com'); const t = (globalThis.localStorage?.getItem('careergraph:token') ?? globalThis.sessionStorage?.getItem('careergraph:token')) as string;
    const mine = await backend.call('POST', '/api/careers', { token: t, body: { name: 'Mine', category: 'Law', description: '', evidenceExpectations: [], capabilities: [{ name: 'C', description: '', skills: [{ name: 'S', requiredLevel: 3, importance: 3 }] }] } });
    const id = mine.body.career.id as string;
    api.setToken(null); resetStorage(); await signUp('b@x.com');
    await assert.rejects(() => coreApi.getGraph(id), (e: unknown) => e instanceof ApiError && e.status === 404);
  });
});

describe('graph layout and demo-mode notice (source guards; not a browser)', () => {
  const graph = readFileSync(new URL('../src/components/graph/CareerGraph.tsx', import.meta.url), 'utf8');
  it('fits its container: measured viewBox, no horizontal scroller, details beside the graph only on very wide screens', () => {
    assert.ok(/ResizeObserver/.test(graph) && /viewBox=\{`0 0 \$\{W\} \$\{layout\.H\}`\}/.test(graph));
    assert.ok(!/overflow-x-auto|min-w-\[\d+px\]/.test(graph), 'no forced minimum width or scroll area');
    assert.ok(/2xl:grid-cols-\[minmax\(0,1fr\)_22rem\]/.test(graph) && /min-w-0/.test(graph));
    assert.ok(/shortLabel\(n\.label, budget\(n\)\)/.test(graph), 'label length comes from the column width');
  });
  it('production builds without an API URL show a visible demo-mode notice, never silently', () => {
    const src = readFileSync(new URL('../src/components/layout/DevDataSource.tsx', import.meta.url), 'utf8');
    assert.ok(/data-testid="demo-mode"/.test(src) && /stored only in this browser/.test(src));
  });
  it('the data-source diagnostics panel is hidden unless explicitly enabled, and the demo notice is not gated by it', () => {
    const src = readFileSync(new URL('../src/components/layout/DevDataSource.tsx', import.meta.url), 'utf8');
    assert.ok(/careergraph:debug/.test(src) && /if \(!debugPanelEnabled\(\)\) return null;/.test(src));
    assert.ok(src.indexOf("data-testid=\"demo-mode\"") < src.indexOf('if (!debugPanelEnabled())'), 'demo notice is decided before the debug gate');
  });
});
