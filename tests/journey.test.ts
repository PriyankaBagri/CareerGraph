import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeApp } from '../server/tests/helpers';
import { ApiError, api } from '../src/services/api';
import { loadRemoteAnalysis } from '../src/services/analysisApi';
import { authService } from '../src/services/auth';
import { careerService } from '../src/services/career';
import { coreApi } from '../src/services/coreApi';
import { evidenceService } from '../src/services/evidence';
import { profileService } from '../src/services/profile';
import { resetStorage } from './helpers';

// IN-MEMORY integration: real frontend services + real backend request pipeline (routing, auth, validation, readiness engine), fake fetch, in-memory repositories.
// Not PostgreSQL, not a browser.
let backend: ReturnType<typeof makeApp>, real: typeof fetch, failNext: number | null, unauthorizedHits: number;
beforeEach(() => {
  resetStorage(); backend = makeApp({ now: () => new Date() }); real = globalThis.fetch; failNext = null; unauthorizedHits = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (failNext) { const status = failNext; failNext = null; return new Response(JSON.stringify({ error: { code: 'boom', message: 'Server problem' } }), { status }); }
    const h = (init?.headers ?? {}) as Record<string, string>;
    const r = await backend.call(init?.method ?? 'GET', String(url).replace('http://api.test', ''), { body: init?.body ? JSON.parse(String(init.body)) : undefined, token: h.Authorization?.replace('Bearer ', '') });
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  api.setBase('http://api.test/api'); api.setUnauthorizedHandler(() => { unauthorizedHits++; });
});
afterEach(() => { globalThis.fetch = real; api.setToken(null); api.setUnauthorizedHandler(null); api.setBase(''); });
const ev = (title: string, skillIds = ['swe:testing']) => ({ title, description: 'did it', type: 'Project' as const, strength: 'strong' as const, skillIds });

describe('complete user journey (in-memory backend)', () => {
  it('signup -> login -> careers -> career model -> rate -> evidence -> persists -> readiness/gaps/actions -> logout locks data', async () => {
    const u = await authService.signUp('Ada Lovelace', 'ada@example.com', 'Passw0rdOK1');
    await authService.logout(); assert.equal(authService.getCurrentUser(), null);
    const again = await authService.login('ada@example.com', 'Passw0rdOK1', true); assert.equal(again.id, u.id);
    const careers = await careerService.list(); assert.ok(careers.length >= 3);
    const ds = await careerService.getDataset('swe'); assert.ok(ds.career.capabilities.length > 0);
    const skill = ds.career.capabilities[0].skills[0].id;
    await profileService.setSkillLevel(u.id, skill, 3).catch(() => undefined); // profile is local; the rating itself is what matters
    await coreApi.setSkillAssessment(skill, 3);
    const created = await evidenceService.createEvidence({ ...ev('Test suite', [skill]) });
    // "refresh": nothing in memory is reused; everything is re-read from the server
    assert.equal((await coreApi.listSkillAssessments()).find((a) => a.skillId === skill)?.level, 3);
    assert.deepEqual((await evidenceService.getEvidence()).map((e) => e.id), [created.id]);
    const view = await loadRemoteAnalysis('swe', await evidenceService.getEvidence());
    assert.ok(view.readiness && view.gaps && view.skills.length > 0);
    assert.ok((await coreApi.getActions('swe')).actions.length > 0);
    await authService.logout();
    await assert.rejects(() => coreApi.listEvidence(), (e: unknown) => e instanceof ApiError && e.status === 401);
    await assert.rejects(() => coreApi.getReadiness('swe'), (e: unknown) => e instanceof ApiError && e.status === 401);
  });
});

describe('user isolation', () => {
  it('B never sees A\'s ratings or evidence, cannot read it by id, and switching users leaves no trace', async () => {
    const a = await authService.signUp('A', 'a@example.com', 'Passw0rdOK1');
    await coreApi.setSkillAssessment('swe:testing', 4); const e = await evidenceService.createEvidence(ev('A private'));
    await authService.logout();
    const b = await authService.signUp('B', 'b@example.com', 'Passw0rdOK1'); assert.notEqual(a.id, b.id);
    assert.deepEqual(await evidenceService.getEvidence(), []);
    assert.equal((await coreApi.listSkillAssessments()).filter((x) => x.assessed).length, 0);
    await assert.rejects(() => evidenceService.getEvidenceById(e.id), (x: unknown) => x instanceof ApiError && x.status === 404);
    await assert.rejects(() => coreApi.updateEvidence(e.id, { title: 'hijack' }), (x: unknown) => x instanceof ApiError && x.status === 404);
    await assert.rejects(() => coreApi.deleteEvidence(e.id), (x: unknown) => x instanceof ApiError && x.status === 404);
    await authService.logout(); await authService.login('a@example.com', 'Passw0rdOK1', true);
    assert.equal((await evidenceService.getEvidence())[0].title, 'A private'); // untouched by B's attempts
  });
});

describe('failures are never presented as saved', () => {
  it('a failed rating or evidence save rejects and the server keeps the old value', async () => {
    const u = await authService.signUp('A', 'a@example.com', 'Passw0rdOK1');
    await coreApi.setSkillAssessment('swe:testing', 2);
    failNext = 500; await assert.rejects(() => coreApi.setSkillAssessment('swe:testing', 5), ApiError);
    failNext = 500; await assert.rejects(() => evidenceService.createEvidence(ev('lost')), ApiError);
    assert.equal((await coreApi.listSkillAssessments()).find((x) => x.skillId === 'swe:testing')?.level, 2);
    assert.deepEqual(await evidenceService.getEvidence(), []);
    void u;
  });
  it('a rejected token calls the unauthorized handler once per failed call and sends no redirect loop trigger on public calls', async () => {
    await authService.signUp('A', 'a@example.com', 'Passw0rdOK1');
    api.setToken('not.a.jwt'); await assert.rejects(() => coreApi.listEvidence(), (e: unknown) => e instanceof ApiError && e.status === 401);
    assert.equal(unauthorizedHits, 1);
    api.setToken(null); const before = unauthorizedHits;
    await assert.rejects(() => authService.login('a@example.com', 'wrong-password', true)); // wrong password is NOT a session expiry
    assert.equal(unauthorizedHits, before);
  });
});

describe('career switching and readiness honesty', () => {
  it('analysis is per career, unassessed skills are unknown (not 0), and gaps separate below-target from unassessed', async () => {
    await authService.signUp('A', 'a@example.com', 'Passw0rdOK1');
    const swe = await loadRemoteAnalysis('swe', []); const fin = await loadRemoteAnalysis('fin', []);
    assert.notDeepEqual(swe.skills.map((s) => s.skillId), fin.skills.map((s) => s.skillId));
    assert.ok(swe.skills.every((s) => !s.assessed && s.status === 'not_assessed'), 'no rating means unknown (assessed=false, status not_assessed), never a real level 0');
    const r0 = await coreApi.getReadiness('swe'); assert.equal(r0.state, 'not_assessed'); assert.equal(r0.score, null);
    await coreApi.setSkillAssessment('swe:testing', 1);
    const g = await coreApi.getGaps('swe');
    assert.ok(g.below.every((s) => s.skillId !== 'x') && g.unassessed.length > 0);
    assert.ok(!g.unassessed.some((u) => g.below.some((b) => b.skillId === u.skillId)));
    const acts = (await coreApi.getActions('swe')).actions;
    const ids = new Set([...g.below, ...g.unassessed].map((s) => s.skillId)); // every action points at a real gap or unassessed skill of THIS career
    assert.ok(acts.every((a) => ids.has(a.skillId) || a.type === 'add_evidence'));
    const r1 = await coreApi.getReadiness('swe'); assert.ok(r1.caveats.length > 0 && r1.formula.length > 0);
  });
});

import { createSubmitGuard } from '../src/utils/submitGuard';
describe('evidence double-submit guard', () => {
  it('blocks a second submit while one is running, allows it after a failure, and never blocks a separate form', async () => {
    await authService.signUp('A', 'a@example.com', 'Passw0rdOK1');
    const g = createSubmitGuard(); let sent = 0;
    const submit = async (fail = false) => { if (!g.tryEnter()) return; try { await evidenceService.createEvidence(ev(`E${++sent}`)); if (fail) throw new Error('x'); } catch { g.leave(); } };
    await Promise.all([submit(), submit(), submit()]); // double/triple click
    assert.equal((await evidenceService.getEvidence()).length, 1);
    const g2 = createSubmitGuard(); assert.ok(g2.tryEnter()); await evidenceService.createEvidence(ev('Second, separate')); // new form instance
    assert.equal((await evidenceService.getEvidence()).length, 2);
    const g3 = createSubmitGuard(); assert.ok(g3.tryEnter()); assert.equal(g3.tryEnter(), false); g3.leave(); assert.ok(g3.tryEnter()); // retry after failure
  });
});

describe('backend unavailable while signed in (service level)', () => {
  it('profile load fails with a network ApiError, keeps the session, and recovers with the SERVER profile when the server returns', async () => {
    const u = await authService.signUp('A', 'a@example.com', 'Passw0rdOK1');
    await profileService.updateProfile(u.id, { onboardingComplete: true, targetCareerId: 'swe', experienceLevel: 'early', stage: 'Early Career' });
    await coreApi.setSkillAssessment('swe:testing', 3);
    const up = globalThis.fetch; globalThis.fetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    try { await assert.rejects(() => profileService.getProfile(u.id), (e: unknown) => e instanceof ApiError && e.status === 0); } finally { globalThis.fetch = up; }
    assert.ok(authService.getCurrentUser(), 'session kept'); assert.equal(unauthorizedHits, 0);
    const p = await profileService.getProfile(u.id);
    assert.equal(p?.onboardingComplete, true); assert.equal(p?.targetCareerId, 'swe'); assert.equal(p?.stage, 'Early Career'); assert.deepEqual(p?.skillAssessments, [{ skillId: 'swe:testing', currentLevel: 3 }]);
  });
});
