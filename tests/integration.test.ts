import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeApp } from '../server/tests/helpers';
import { api, ApiError } from '../src/services/api';
import { authService, expireSession } from '../src/services/auth';
import { careerService } from '../src/services/career';
import { coreApi, toApiEvidenceInput, toEvidence, type ApiCareerModel, type ApiReadiness } from '../src/services/coreApi';
import { dataService } from '../src/services/data';
import { findPending, importBrowserData } from '../src/services/browserData';
import { evidenceService } from '../src/services/evidence';
import { loadRemoteAnalysis, mapActions, mapReadiness, mapRemoteAnalysis, mapSkills } from '../src/services/analysisApi';
import { profileService } from '../src/services/profile';
import { saveErrors } from '../src/utils/apiErrors';
import { resetStorage } from './helpers';

// Frontend services against the REAL backend request pipeline (routing, auth, validation, services) over in-memory repositories,
// connected through a fake `fetch`. This is NOT PostgreSQL and NOT a browser; it proves the contract between the two codebases.
let backend: ReturnType<typeof makeApp>, calls: { method: string; path: string; auth: boolean; body?: unknown }[], realFetch: typeof fetch, failNext: number | null;
const BASE = 'http://api.test/api';
beforeEach(() => {
  resetStorage(); backend = makeApp({ now: () => new Date() }); calls = []; failNext = null; realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('http://api.test', '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const token = headers.Authorization?.replace('Bearer ', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', path, auth: !!token, body });
    if (failNext) { const status = failNext; failNext = null; return new Response(JSON.stringify({ error: { code: 'boom', message: 'Server problem' } }), { status }); }
    const r = await backend.call(init?.method ?? 'GET', path, { body, token });
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  api.setBase(BASE);
});
afterEach(() => { globalThis.fetch = realFetch; api.setToken(null); });
const signUp = async (email = 'ada@example.com') => authService.signUp('Ada Lovelace', email, 'Passw0rdOK1');
const SWE = 'swe';

describe('feature boundary', () => {
  it('uses the backend only when a base URL is configured; mock mode is unchanged', () => {
    const on = ['auth', 'careers', 'assessments', 'evidence', 'analysis'].map((f) => api.useBackend(f as never));
    api.setBase(''); const off = ['auth', 'careers', 'assessments', 'evidence', 'analysis', 'profile'].map((f) => api.useBackend(f as never));
    assert.deepEqual(on, [true, true, true, true, true]); assert.ok(off.every((x) => x === false)); assert.equal(api.useBackend('profile'), false);
  });
});

describe('careers via the backend', () => {
  it('lists real backend careers and loads a career model; never falls back to bundled data on failure', async () => {
    await signUp();
    const list = await careerService.list();
    assert.deepEqual(list.map((c) => c.name).sort(), ['Financial Analyst', 'Software Engineer', 'UX Designer']);
    assert.ok(calls.some((c) => c.path === '/api/careers' && c.auth));
    const ds = await careerService.getDataset(SWE);
    assert.equal(ds.career.id, SWE); assert.ok(ds.career.capabilities.length >= 2); assert.ok(ds.career.capabilities.every((c) => c.skills.every((s) => s.requiredLevel >= 1)));
    failNext = 500; await assert.rejects(() => careerService.getDataset(SWE), ApiError); // an error, not silently local data
    failNext = 500; await assert.rejects(() => careerService.list(), ApiError);
  });
  it('keeps local custom careers in the list and analyses them locally', async () => {
    const u = await signUp();
    const model = await coreApi.getCareer(SWE); assert.ok(u.id);
    const custom = { id: 'custom-1', name: 'My Role', category: 'X', description: 'd', capabilities: [{ id: 'c1', name: 'C', skills: [{ id: 's1', name: 'S', currentLevel: 0, requiredLevel: 2, evidenceIds: [] }] }], origin: { source: 'custom' } };
    // A career saved in this browser BEFORE backend mode was switched on (legacy). New saves in backend mode now go to the server (see customCareers.test.ts).
    (globalThis as unknown as { localStorage: Storage }).localStorage.setItem(`careergraph:user:${u.id}:custom-careers`, JSON.stringify([custom]));
    const n = calls.length; const ds = await careerService.getDataset('custom-1'); assert.equal(ds.career.name, 'My Role'); assert.equal(calls.length, n); assert.ok(model.career.id === SWE);
  });
});

describe('skill assessments persist on the server', () => {
  it('saves, updates and re-reads ratings; unassessed skills are absent, not level 0', async () => {
    const u = await signUp();
    await profileService.completeOnboarding(u.id, { targetCareerId: SWE, experienceLevel: 'beginner', skillAssessments: [{ skillId: 'swe:algorithms', currentLevel: 2 }] });
    let p = await profileService.getProfile(u.id);
    assert.deepEqual(p?.skillAssessments, [{ skillId: 'swe:algorithms', currentLevel: 2 }]); assert.equal(p?.onboardingComplete, true);
    assert.ok(calls.some((c) => c.method === 'PUT' && c.path === '/api/me/skills/swe%3Aalgorithms' && JSON.stringify(c.body) === '{"level":2}'));
    p = await profileService.setSkillLevel(u.id, 'swe:testing', 0); // a genuine zero is kept
    assert.deepEqual(p.skillAssessments.map((a) => [a.skillId, a.currentLevel]).sort(), [['swe:algorithms', 2], ['swe:testing', 0]]);
    p = await profileService.setSkillLevel(u.id, 'swe:algorithms', 4);
    // "refresh": drop everything local except the token + local profile shell, read again
    const again = await profileService.getProfile(u.id);
    assert.equal(again?.skillAssessments.find((a) => a.skillId === 'swe:algorithms')?.currentLevel, 4);
    assert.ok(!again?.skillAssessments.some((a) => a.skillId === 'swe:system-design')); // never rated -> not present
  });
  it('surfaces server validation errors instead of swallowing them', async () => {
    const u = await signUp();
    await profileService.completeOnboarding(u.id, { targetCareerId: SWE, experienceLevel: 'beginner', skillAssessments: [] });
    await assert.rejects(() => profileService.setSkillLevel(u.id, 'no:such-skill', 3), (e) => e instanceof ApiError && e.status === 404);
    await assert.rejects(() => coreApi.setSkillAssessment('swe:testing', 9), (e) => e instanceof ApiError && e.status === 400 && !!e.fields?.level);
  });
});

describe('evidence via the backend', () => {
  it('creates, lists, updates, links and deletes evidence; it survives a re-read', async () => {
    await signUp();
    const created = await evidenceService.createEvidence({ title: 'CLI tool', description: 'Built it', type: 'Project', strength: 'strong', skillIds: ['swe:testing'], url: 'https://example.com/x' });
    assert.equal(created.source, 'user'); assert.deepEqual(created.skillIds, ['swe:testing']); assert.equal(created.url, 'https://example.com/x'); assert.equal(created.organization, undefined);
    assert.equal((await evidenceService.getEvidence()).length, 1);
    const updated = await evidenceService.updateEvidence(created.id, { title: 'CLI tool v2', description: 'Built it', type: 'Project', strength: 'very_strong', skillIds: ['swe:testing', 'swe:algorithms'] }); // url omitted -> cleared
    assert.equal(updated.title, 'CLI tool v2'); assert.equal(updated.url, undefined); assert.equal(updated.skillIds.length, 2);
    assert.equal((await evidenceService.getEvidenceById(created.id)).strength, 'very_strong');
    const linked = await coreApi.unlinkEvidenceSkill(created.id, 'swe:algorithms'); assert.deepEqual(linked.skillIds, ['swe:testing']);
    assert.equal((await coreApi.linkEvidenceSkill(created.id, 'swe:algorithms')).skillIds.length, 2);
    await evidenceService.deleteEvidence(created.id);
    assert.deepEqual(await evidenceService.getEvidence(), []);
    await assert.rejects(() => evidenceService.getEvidenceById(created.id), (e) => e instanceof ApiError && e.status === 404);
  });
  it('maps server validation errors to form fields', async () => {
    await signUp();
    const err = await evidenceService.createEvidence({ title: 'x', description: 'd', type: 'Project', strength: 'weak', skillIds: ['no:such'] }).catch((e) => e);
    assert.ok(err instanceof ApiError && err.status === 400);
    assert.ok(saveErrors(err).skills); assert.match(saveErrors(new ApiError(500, 'x', 'm')).form, /could not save/i);
    assert.match(saveErrors(new ApiError(401, 'token_expired', 'm')).form, /expired/i);
  });
  it("one user's evidence is invisible to another", async () => {
    await signUp('a@example.com'); const mine = await evidenceService.createEvidence({ title: 'A', description: 'd', type: 'Project', strength: 'weak', skillIds: ['swe:testing'] });
    await authService.logout(); await signUp('b@example.com');
    assert.deepEqual(await evidenceService.getEvidence(), []);
    await assert.rejects(() => evidenceService.getEvidenceById(mine.id), (e) => e instanceof ApiError && e.status === 404);
    await assert.rejects(() => evidenceService.deleteEvidence(mine.id), (e) => e instanceof ApiError && e.status === 404);
  });
  it('mapping is explicit: null <-> undefined only, clearing sends null', () => {
    const api1 = { id: 'i', title: 't', description: 'd', type: 'Project' as const, url: null, date: null, organization: null, strength: 'weak' as const, source: 'user', skillIds: ['a'], createdAt: 'c', updatedAt: 'u' };
    const e = toEvidence(api1, 'uid'); assert.equal(e.url, undefined); assert.equal(e.userId, 'uid');
    assert.deepEqual(toApiEvidenceInput({ title: 't', description: 'd', type: 'Project', strength: 'weak', skillIds: [] }), { title: 't', description: 'd', type: 'Project', strength: 'weak', url: null, date: null, organization: null, skillIds: [] });
  });
});

describe('readiness, gaps and actions come from the backend', () => {
  it('end to end: a new user is not assessed, then ratings and evidence change the server result', async () => {
    const u = await signUp();
    await profileService.completeOnboarding(u.id, { targetCareerId: SWE, experienceLevel: 'beginner', skillAssessments: [] });
    let v = await loadRemoteAnalysis(SWE, []);
    assert.equal(v.readiness.assessment.state, 'not_assessed'); assert.equal(v.readiness.backend?.score, null);
    assert.ok(v.skills.every((s) => s.status === 'not_assessed' && s.assessed === false)); // unknown, not failed
    assert.equal(v.gaps.length, 0); assert.ok(v.actions.length > 0 && v.actions.every((a) => a.type === 'other')); // "assess" actions
    const used = calls.filter((c) => /readiness|gaps|actions/.test(c.path)); assert.equal(used.length, 3);
    assert.ok(calls.some((c) => c.path === '/api/careers/swe/actions?limit=10'));
    assert.ok(calls.every((c) => !/userId/i.test(c.path) && !/userId/i.test(JSON.stringify(c.body ?? {})))); // identity only via the token

    await profileService.setSkillLevel(u.id, 'swe:algorithms', 1);
    const created = await evidenceService.createEvidence({ title: 'P', description: 'd', type: 'Project', strength: 'very_strong', skillIds: ['swe:testing'] });
    await profileService.setSkillLevel(u.id, 'swe:testing', 5);
    v = await loadRemoteAnalysis(SWE, [created]);
    assert.equal(v.readiness.assessment.state, 'partial'); assert.equal(typeof v.readiness.backend?.score, 'number');
    assert.equal(v.readiness.overall, v.readiness.backend?.score);
    const algo = v.skills.find((s) => s.skillId === 'swe:algorithms'); assert.equal(algo?.assessed, true); assert.equal(algo?.currentLevel, 1); assert.ok(['skill_gap', 'combined_gap'].includes(algo?.status ?? ''));
    const unrated = v.skills.find((s) => s.skillId === 'swe:system-design'); assert.equal(unrated?.status, 'not_assessed'); assert.equal(unrated?.assessed, false);
    assert.ok(v.gaps.some((g) => g.skillId === 'swe:algorithms')); assert.ok(!v.gaps.some((g) => g.skillId === 'swe:system-design'));
    assert.equal(v.skills.find((s) => s.skillId === 'swe:testing')?.evidenceCount, 1);
    assert.ok(v.readiness.backend?.caveats.some((c) => /self-reported/.test(c)));
    assert.ok(v.actions.every((a) => a.effort === undefined && a.estimatedTime === undefined)); // not invented
    assert.ok(v.actions[0].title && v.actions[0].reason && v.actions[0].description.length > 10); assert.ok((v.actions[0].detail?.completionCriterion ?? '').length > 5); assert.ok((v.actions[0].detail?.guidance?.definitionOfDone.length ?? 0) >= 1 && (v.actions[0].detail?.guidance?.steps.length ?? 0) >= 3);
    const again = await loadRemoteAnalysis(SWE, [created]); assert.deepEqual(again.readiness, v.readiness); // stable across reloads
  });
  it('propagates failures so the UI can show an error state (no silent mock fallback)', async () => {
    await signUp();
    failNext = 500; await assert.rejects(() => loadRemoteAnalysis(SWE, []), ApiError);
    await assert.rejects(() => loadRemoteAnalysis('nope', []), (e) => e instanceof ApiError && e.status === 404);
  });
});

describe('mapping unit tests (fixtures)', () => {
  const model: ApiCareerModel = { career: { id: 'x', name: 'X', category: 'c', description: 'd', source: 'seed', evidenceExpectations: [] }, capabilities: [{ id: 'cap', careerId: 'x', name: 'Cap', description: '', position: 0 }], skills: [{ id: 'a', name: 'A', description: '', category: null }, { id: 'b', name: 'B', description: '', category: null }], requirements: [{ careerId: 'x', skillId: 'a', capabilityId: 'cap', requiredLevel: 3, importance: 3, position: 0 }, { careerId: 'x', skillId: 'b', capabilityId: 'cap', requiredLevel: 2, importance: 3, position: 1 }] };
  const row = (o: Partial<ApiReadiness['skills'][0]>): ApiReadiness['skills'][0] => ({ skillId: 'a', name: 'A', capabilityId: 'cap', capabilityName: 'Cap', requiredLevel: 3, importance: 3, assessed: false, currentLevel: null, status: 'unassessed', gap: null, evidenceCount: 0, evidencePoints: 0, evidenceRatio: 0, evidenceStatus: 'none', levelRatio: null, skillScore: null, weightShare: null, contribution: null, ...o });
  const r = (state: ApiReadiness['state'], skills: ApiReadiness['skills'], score: number | null): ApiReadiness => ({ careerId: 'x', careerName: 'X', state, score, range: score === null ? null : { min: 10, max: 90 }, counts: { total: 2, assessed: skills.filter((s) => s.assessed).length, unassessed: skills.filter((s) => !s.assessed).length, meets: skills.filter((s) => s.status === 'meets').length, below: skills.filter((s) => s.status === 'below').length }, weights: { total: 6, assessed: 3, assessedShare: 0.5 }, skills, caveats: ['c1'], formula: 'f' });
  it('keeps unassessed unknown and maps status/coverage', () => {
    const rd = r('partial', [row({ assessed: true, currentLevel: 1, status: 'below', gap: 2 }), row({ skillId: 'b', name: 'B' })], 40);
    const sk = mapSkills(model, rd, [], []);
    assert.equal(sk[0].status, 'combined_gap'); assert.equal(sk[0].skillGap, 2); assert.equal(sk[1].status, 'not_assessed'); assert.equal(sk[1].assessed, false); assert.equal(sk[1].skillGap, 0);
  });
  it('readiness mapping carries score, coverage, range and caveats; not_assessed has no number', () => {
    const g = { careerId: 'x', counts: r('partial', [], 1).counts, below: [], unassessed: [], meets: [], caveats: [] };
    const m = mapReadiness(r('partial', [row({ assessed: true, currentLevel: 3, status: 'meets', gap: 0, evidenceStatus: 'sufficient' }), row({ skillId: 'b' })], 55), g);
    assert.equal(m.overall, 55); assert.equal(m.assessment.state, 'partial'); assert.equal(m.assessment.assessed, 1); assert.deepEqual(m.backend?.range, { min: 10, max: 90 }); assert.deepEqual(m.backend?.caveats, ['c1']);
    assert.equal(m.metrics.find((x) => x.key === 'coverage')?.value, 50); assert.equal(m.metrics.find((x) => x.key === 'weight')?.value, 50);
    const na = mapReadiness(r('not_assessed', [row({}), row({ skillId: 'b' })], null), g); assert.equal(na.assessment.state, 'not_assessed'); assert.equal(na.backend?.score, null);
  });
  it('action mapping is deterministic and does not invent effort or time', () => {
    const acts = mapActions({ careerId: 'x', careerName: 'X', note: 'n', actions: [{ id: 'build_skill:a', rank: 1, type: 'build_skill', skillId: 'a', skillName: 'A', capabilityId: 'cap', capabilityName: 'Cap', priority: 'high', priorityScore: 8, reason: 'r', recommendation: 'rec', currentLevel: 1, targetLevel: 3, completionCriterion: 'crit' }] }, 'x');
    assert.deepEqual(acts, mapActions({ careerId: 'x', careerName: 'X', note: 'n', actions: [{ id: 'build_skill:a', rank: 1, type: 'build_skill', skillId: 'a', skillName: 'A', capabilityId: 'cap', capabilityName: 'Cap', priority: 'high', priorityScore: 8, reason: 'r', recommendation: 'rec', currentLevel: 1, targetLevel: 3, completionCriterion: 'crit' }] }, 'x'));
    assert.equal(acts[0].type, 'build_skill'); assert.equal(acts[0].status, 'not_started'); assert.equal(acts[0].effort, undefined); assert.equal(acts[0].estimatedTime, undefined); assert.equal(acts[0].title, 'Raise A to Intermediate');
  });
  it('mapRemoteAnalysis ties evidence to skills', () => {
    const rd = r('assessed', [row({ assessed: true, currentLevel: 3, status: 'meets', gap: 0 }), row({ skillId: 'b', assessed: true, currentLevel: 2, status: 'meets', gap: 0 })], 70);
    const ev = [{ id: 'e1', title: 't', description: 'd', type: 'Project' as const, skillIds: ['a'], strength: 'strong' as const, source: 'user' as const, createdAt: '', updatedAt: '' }];
    const v = mapRemoteAnalysis(model, rd, { careerId: 'x', counts: rd.counts, below: [], unassessed: [], meets: rd.skills as never, caveats: [] }, { careerId: 'x', careerName: 'X', note: '', actions: [] }, ev);
    assert.deepEqual(v.career.capabilities[0].skills.map((s) => s.evidenceIds), [['e1'], []]); assert.equal(v.career.capabilities[0].skills[0].currentLevel, 3);
  });
});

describe('authentication behaviour', () => {
  it('sends the Bearer token to protected endpoints and none to public ones', async () => {
    await signUp(); await coreApi.listCareers();
    assert.equal(calls.find((c) => c.path === '/api/auth/register')?.auth, false); assert.equal(calls.find((c) => c.path === '/api/careers')?.auth, true);
  });
  it('an expired/invalid token is rejected (401) and triggers the unauthorized handler', async () => {
    await signUp(); let fired = 0; api.setUnauthorizedHandler(() => { fired++; expireSession(); });
    api.setToken('aaa.bbb.ccc'); // not a valid token
    await assert.rejects(() => coreApi.listCareers(), (e) => e instanceof ApiError && e.status === 401);
    assert.equal(fired, 1); assert.equal(authService.getCurrentUser(), null); // session dropped -> route guards send the user to /login
    api.setUnauthorizedHandler(expireSession);
  });
  it('no token at all is a 401 without crashing', async () => {
    api.setToken(null); await assert.rejects(() => evidenceService.getEvidence(), () => true);
    await assert.rejects(() => coreApi.listEvidence(), (e) => e instanceof ApiError && e.status === 401);
  });
});

describe('data controls act on server data', () => {
  it('clearEvidence and resetAll delete this user\'s server-side evidence and ratings', async () => {
    const u = await signUp();
    await profileService.completeOnboarding(u.id, { targetCareerId: SWE, experienceLevel: 'beginner', skillAssessments: [{ skillId: 'swe:testing', currentLevel: 2 }] });
    await evidenceService.createEvidence({ title: 'A', description: 'd', type: 'Project', strength: 'weak', skillIds: ['swe:testing'] });
    await dataService.clearEvidence(); assert.deepEqual(await coreApi.listEvidence(), []); assert.equal((await coreApi.listSkillAssessments()).length, 1);
    await evidenceService.createEvidence({ title: 'B', description: 'd', type: 'Project', strength: 'weak', skillIds: ['swe:testing'] });
    await dataService.resetAll(); assert.deepEqual(await coreApi.listEvidence(), []); assert.deepEqual(await coreApi.listSkillAssessments(), []);
  });
});

import { describeApiMode, formatModeLine } from '../src/services/diagnostics';
import { normalizeBase } from '../src/services/api';

describe('diagnostics and base URL handling', () => {
  it('normalizes the base URL (spaces, quotes, trailing slashes) without duplicating /api', () => {
    assert.equal(normalizeBase(' "http://localhost:4000/api/" '), 'http://localhost:4000/api'); assert.equal(normalizeBase(undefined), ''); assert.equal(normalizeBase("'http://x/api'"), 'http://x/api');
  });
  it('explains local mode and flags common mistakes', () => {
    const local = describeApiMode(''); assert.equal(local.mode, 'local'); assert.match(local.problems[0], /\.env/); assert.match(formatModeLine(local), /LOCAL DEMO DATA/);
    assert.deepEqual(describeApiMode('http://localhost:4000/api').problems, []); assert.match(formatModeLine(describeApiMode('http://localhost:4000/api')), /BACKEND \(http:\/\/localhost:4000\/api\)/);
    assert.match(describeApiMode('http://localhost:4000/api/api').problems.join(), /twice/); assert.match(describeApiMode('http://localhost:4000').problems.join(), /does not end with "\/api"/); assert.match(describeApiMode('localhost:4000/api').problems.join(), /not an http/);
  });
  it('request URLs are base + path with exactly one /api, and a network failure is a plain ApiError with no secrets', async () => {
    await signUp(); api.setBase('http://api.test/api/'); await coreApi.listCareers();
    assert.ok(calls.every((c) => c.path.startsWith('/api/') && !c.path.startsWith('/api/api')));
    const logged: string[] = []; const orig = { w: console.warn, d: console.debug };
    console.warn = (...a: unknown[]) => void logged.push(a.join(' ')); console.debug = (...a: unknown[]) => void logged.push(a.join(' '));
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    const err = await coreApi.listCareers().catch((e) => e); console.warn = orig.w; console.debug = orig.d;
    assert.ok(err instanceof ApiError && err.status === 0 && err.code === 'network_error' && /Could not reach the server/.test(err.message));
    assert.ok(!logged.join(' ').match(/Bearer|eyJ|password/i));
  });
});

describe('browser data is only copied by an explicit, safe import', () => {
  const key = (uid: string, k: string) => `careergraph:user:${uid}:${k}`;
  const store = () => (globalThis as unknown as { localStorage: Storage }).localStorage;
  const seed = (uid: string) => {
    const now = '2026-01-01T00:00:00.000Z';
    store().setItem(key(uid, 'profile'), JSON.stringify({ userId: uid, stage: '', education: '', experienceSummary: '', targetCareerId: 'fin', experienceLevel: 'beginner', onboardingComplete: true, skillAssessments: [{ skillId: 'swe:testing', currentLevel: 3 }, { skillId: 'custom:gone', currentLevel: 2 }], completeness: 60, lastAnalysis: '', createdAt: now, updatedAt: now }));
    store().setItem(key(uid, 'evidence'), JSON.stringify([
      { id: 'ev-1', userId: uid, title: 'Newer', description: 'd', type: 'Project', strength: 'strong', skillIds: ['swe:testing'], source: 'user', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: now },
      { id: 'ev-2', userId: uid, title: 'Older', description: 'd', type: 'Project', strength: 'weak', skillIds: ['swe:testing'], source: 'user', createdAt: now, updatedAt: now },
      { id: 'ev-bad', userId: uid, title: 'Custom-career evidence', description: 'd', type: 'Project', strength: 'weak', skillIds: ['custom:gone'], source: 'user', createdAt: now, updatedAt: now },
    ]));
  };
  const signUpSeeded = async (email?: string) => { const u = await signUp(email); seed(u.id); calls.length = 0; return u; }; // sign-up itself is a POST; count only what happens afterwards
  const writes = () => calls.filter((c) => c.method !== 'GET').length;

  it('never migrates by itself: reading profile or evidence sends no writes and keeps local data', async () => {
    const u = await signUpSeeded();
    const before = store().getItem(key(u.id, 'evidence'));
    assert.deepEqual((await profileService.getProfile(u.id))?.skillAssessments, []);
    assert.deepEqual(await evidenceService.getEvidence(), []);
    assert.equal(writes(), 0); assert.equal(store().getItem(key(u.id, 'evidence')), before);
  });

  it('findPending is read-only and lists what the server lacks', async () => {
    const u = await signUpSeeded();
    const p = await findPending(u.id);
    assert.equal(p.ratings.length, 2); assert.equal(p.evidence.length, 3); assert.equal(writes(), 0);
  });

  it('copies oldest-first, keeps failures local, never deletes browser data, and a re-run copies nothing', async () => {
    const u = await signUpSeeded();
    const localBefore = store().getItem(key(u.id, 'evidence')), profBefore = store().getItem(key(u.id, 'profile'));
    const r = await importBrowserData(u.id);
    assert.deepEqual([r.ratingsCopied, r.evidenceCopied, r.failed, r.stopped], [1, 2, 2, null]); // custom skill rating + custom evidence rejected
    assert.deepEqual((await evidenceService.getEvidence()).map((e) => e.title).sort(), ['Newer', 'Older']);
    assert.equal(store().getItem(key(u.id, 'evidence')), localBefore); assert.equal(store().getItem(key(u.id, 'profile')), profBefore); // untouched
    const posts = calls.filter((c) => c.method === 'POST').map((c) => (c.body as { title: string }).title);
    assert.deepEqual(posts.slice(0, 3), ['Older', 'Custom-career evidence', 'Newer']); // oldest first; the rejected one did not stop the rest
    const w = writes(); const again = await importBrowserData(u.id);
    assert.deepEqual([again.ratingsCopied, again.evidenceCopied], [0, 0]);
    assert.equal(writes() - w, 2); // only the two still-invalid items are retried (and rejected again)
  });

  it('does not overwrite an existing server rating and does not duplicate existing evidence', async () => {
    const u = await signUpSeeded();
    await coreApi.setSkillAssessment('swe:testing', 5);
    await coreApi.createEvidence({ title: 'Newer', description: 'd', type: 'Project', strength: 'strong', skillIds: ['swe:testing'] });
    const p = await findPending(u.id);
    assert.deepEqual(p.ratings.map((x) => x.skillId), ['custom:gone']); assert.equal(p.keptOnServer, 1);
    assert.deepEqual(p.evidence.map((e) => e.id).sort(), ['ev-2', 'ev-bad']); assert.equal(p.alreadyOnServer, 1);
    await importBrowserData(u.id);
    assert.equal((await coreApi.listSkillAssessments()).find((a) => a.skillId === 'swe:testing')?.level, 5);
  });

  it('survives a partial failure: continues after a rejected item and stops cleanly on a network error', async () => {
    const u = await signUpSeeded();
    const orig = globalThis.fetch; let n = 0;
    globalThis.fetch = (async (...a: Parameters<typeof fetch>) => { if (a[1]?.method === 'POST' && ++n === 2) throw new TypeError('offline'); return orig(...a); }) as typeof fetch;
    const r = await importBrowserData(u.id);
    globalThis.fetch = orig;
    assert.equal(r.stopped, 'network'); assert.equal(r.evidenceCopied, 1);
    const fin = await importBrowserData(u.id); // run again: finishes the rest, nothing doubled
    assert.equal(fin.evidenceCopied, 1);
    assert.deepEqual((await evidenceService.getEvidence()).map((e) => e.title).sort(), ['Newer', 'Older']);
  });

  it('only reads the signed-in user\'s own browser data', async () => {
    const a = await signUpSeeded();
    await authService.logout(); const b = await signUp('grace@example.com');
    const p = await findPending(b.id);
    assert.deepEqual([p.ratings.length, p.evidence.length], [0, 0]);
  });
});
