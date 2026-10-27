import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeApp } from '../server/tests/helpers';
import { ApiError, api } from '../src/services/api';
import { authService } from '../src/services/auth';
import { careerService } from '../src/services/career';
import { careerIntelligenceService } from '../src/services/careerIntelligence';
import { coreApi, toApiCareerInput } from '../src/services/coreApi';
import { loadRemoteAnalysis } from '../src/services/analysisApi';
import { resetStorage } from './helpers';

// IN-MEMORY integration (real backend pipeline over in-memory repositories; not PostgreSQL, not a browser).
let backend: ReturnType<typeof makeApp>, real: typeof fetch;
beforeEach(() => {
  resetStorage(); backend = makeApp({ now: () => new Date() }); real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    const r = await backend.call(init?.method ?? 'GET', String(url).replace('http://api.test', ''), { body: init?.body ? JSON.parse(String(init.body)) : undefined, token: h.Authorization?.replace('Bearer ', '') });
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  api.setBase('http://api.test/api');
});
afterEach(() => { globalThis.fetch = real; api.setToken(null); api.setBase(''); });
const signUp = (email: string) => authService.signUp('Test', email, 'Passw0rdOK1');
const careers = ['Corporate Lawyer', 'Primary School Teacher', 'UPSC Civil Services', 'Fashion Designer', 'Architect'];

describe('any profession through the same server-side model', () => {
  for (const name of careers) it(`${name}: generated model is saved to the account, analysed by the engine, and private to the owner`, async () => {
    await signUp('a@example.com');
    const generated = await careerIntelligenceService.generateCareerModel({ name });
    const saved = await careerService.saveCustomCareer(generated);
    assert.match(saved.id, /^cx-/); assert.equal(saved.origin?.source, 'custom'); assert.ok(saved.capabilities.length >= 2);
    assert.ok((await careerService.list()).some((c) => c.id === saved.id));
    const r = await coreApi.getReadiness(saved.id); assert.equal(r.state, 'not_assessed'); assert.equal(r.score, null);
    assert.ok((await loadRemoteAnalysis(saved.id, [])).skills.length > 0);
    await authService.logout(); await signUp('b@example.com');
    assert.ok(!(await careerService.list()).some((c) => c.id === saved.id));
    await assert.rejects(() => coreApi.getCareer(saved.id), (e: unknown) => e instanceof ApiError && e.status === 404);
    await assert.rejects(() => careerService.deleteCustomCareer(saved.id), (e: unknown) => e instanceof ApiError && e.status === 404);
  });
});

describe('regenerate, edit and delete', () => {
  it('saving a career with an existing name updates it in place and keeps ratings for unchanged skills', async () => {
    await signUp('a@example.com');
    const first = await careerService.saveCustomCareer(await careerIntelligenceService.generateCareerModel({ name: 'Corporate Lawyer' }));
    const kept = first.capabilities[0].skills[0]; await coreApi.setSkillAssessment(kept.id, 4);
    const again = await careerService.saveCustomCareer(await careerIntelligenceService.generateCareerModel({ name: 'Corporate Lawyer' }));
    assert.equal(again.id, first.id); assert.equal((await careerService.list()).filter((c) => c.name === 'Corporate Lawyer').length, 1);
    assert.equal((await coreApi.listSkillAssessments()).find((a) => a.skillId === kept.id)?.level, 4);
  });
  it('delete removes the career and its ratings; a failed delete leaves everything in place', async () => {
    await signUp('a@example.com');
    const c = await careerService.saveCustomCareer(await careerIntelligenceService.generateCareerModel({ name: 'Architect' }));
    await coreApi.setSkillAssessment(c.capabilities[0].skills[0].id, 3);
    const up = globalThis.fetch; globalThis.fetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    await assert.rejects(() => careerService.deleteCustomCareer(c.id), (e: unknown) => e instanceof ApiError && e.status === 0); globalThis.fetch = up;
    assert.ok((await careerService.list()).some((x) => x.id === c.id));
    await careerService.deleteCustomCareer(c.id);
    assert.ok(!(await careerService.list()).some((x) => x.id === c.id)); assert.equal((await coreApi.listSkillAssessments()).length, 0);
  });
  it('seeded careers cannot be removed through the service', async () => {
    await signUp('a@example.com'); const seed = (await careerService.list()).find((c) => c.source === 'seed')!;
    await assert.rejects(() => careerService.deleteCustomCareer(seed.id), (e: unknown) => e instanceof ApiError && e.status === 404);
    assert.ok((await careerService.list()).some((c) => c.id === seed.id));
  });
});

describe('request mapping', () => {
  it('never sends ids for new items, clamps levels, and reuses existing ids by name only once', () => {
    const body = toApiCareerInput({ id: 'x', name: ' Teacher ', category: '', description: '', capabilities: [{ id: 'c', name: 'Pedagogy', skills: [{ id: 's1', name: 'Lesson planning', currentLevel: 0, requiredLevel: 9, evidenceIds: [] }, { id: 's2', name: 'Lesson planning', currentLevel: 0, requiredLevel: 0, evidenceIds: [] }] }] });
    assert.equal(body.name, 'Teacher'); assert.equal(body.category, 'Other');
    assert.deepEqual(body.capabilities[0].skills.map((s) => [s.id, s.requiredLevel]), [[undefined, 5], [undefined, 1]]);
    const existing = { career: { id: 'cx-1', name: 'T', category: 'E', description: '', source: 'custom' as const, evidenceExpectations: [] }, capabilities: [{ id: 'cx-1:c1', careerId: 'cx-1', name: 'pedagogy', description: '', position: 0 }], skills: [{ id: 'cx-1:s1', name: 'LESSON PLANNING', description: '', category: null }], requirements: [] };
    const re = toApiCareerInput({ id: 'x', name: 'T', category: 'E', description: '', capabilities: [{ id: 'c', name: 'Pedagogy', skills: [{ id: 'a', name: 'Lesson planning', currentLevel: 0, requiredLevel: 3, evidenceIds: [] }, { id: 'b', name: 'Lesson planning', currentLevel: 0, requiredLevel: 3, evidenceIds: [] }] }] }, existing);
    assert.deepEqual(re.capabilities[0].skills.map((s) => s.id), ['cx-1:s1', undefined]); assert.equal(re.capabilities[0].id, 'cx-1:c1');
  });
});

import { findPending, importBrowserData } from '../src/services/browserData';
describe('copying browser-only custom careers (explicit import)', () => {
  it('copies the career structure once, keeps the browser copy, and never duplicates on re-run', async () => {
    const u = await signUp('a@example.com');
    const legacy = await careerIntelligenceService.generateCareerModel({ name: 'Fashion Designer' });
    const store = (globalThis as unknown as { localStorage: Storage }).localStorage; const key = `careergraph:user:${u.id}:custom-careers`;
    store.setItem(key, JSON.stringify([legacy]));
    const before = store.getItem(key); const pending = await findPending(u.id); assert.deepEqual(pending.careers.map((c) => c.name), ['Fashion Designer']);
    const r = await importBrowserData(u.id); assert.equal(r.careersCopied, 1); assert.equal(store.getItem(key), before);
    assert.equal((await coreApi.listCareers()).filter((c) => c.name === 'Fashion Designer').length, 1);
    assert.equal((await findPending(u.id)).careers.length, 0); assert.equal((await importBrowserData(u.id)).careersCopied, 0);
    assert.equal((await coreApi.listCareers()).filter((c) => c.name === 'Fashion Designer').length, 1);
  });
});
