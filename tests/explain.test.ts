import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeApp } from '../server/tests/helpers';
import { loadRemoteAnalysis } from '../src/services/analysisApi';
import { authService } from '../src/services/auth';
import { api } from '../src/services/api';
import { coreApi } from '../src/services/coreApi';
import { evidenceService } from '../src/services/evidence';
import type { DashboardView, SkillAnalysis } from '../src/types';
import { explainSkill, readinessBreakdown } from '../src/utils/explain';
import { resetStorage } from './helpers';

// REAL frontend services + REAL backend pipeline (routing, auth, validation, readiness engine) over in-memory repositories, fake fetch. Not PostgreSQL, not a browser.
let backend: ReturnType<typeof makeApp>, real: typeof fetch, token = '';
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
const store = (k: 'localStorage' | 'sessionStorage') => (globalThis as unknown as Record<string, Storage>)[k];
const signUp = async (email = 'a@x.com') => { await authService.signUp('Ada', email, 'Passw0rdOK1'); token = store('localStorage').getItem('careergraph:token') ?? store('sessionStorage').getItem('careergraph:token') ?? ''; assert.ok(token); };
const rate = (skillId: string, level: number) => backend.call('PUT', `/api/me/skills/${encodeURIComponent(skillId)}`, { token, body: { level } });
const addEvidence = (skillIds: string[], strength = 'strong', title = 'Shipped a service') => backend.call('POST', '/api/evidence', { token, body: { title, description: 'did it', type: 'Project', strength, skillIds } });
const load = async (careerId = 'swe'): Promise<DashboardView> => loadRemoteAnalysis(careerId, await evidenceService.getEvidence());
const rules = (v: DashboardView) => v.readiness.backend?.evaluation?.rules;
const byId = (v: DashboardView, id: string) => v.skills.find((s) => s.skillId === id) as SkillAnalysis;

describe('skill explanation is derived from the server\'s own numbers', () => {
  it('an unassessed skill is "unknown, not zero", is excluded from the score, and says how to assess it', async () => {
    await signUp(); const v = await load(); const s = v.skills[0];
    const x = explainSkill(s, rules(v))!;
    assert.match(x.headline, /not zero/); assert.ok(!x.steps.some((t) => t.key === 'score' || t.key === 'weight'));
    assert.match(x.whatIf[0], /Rate your current/); assert.equal(s.breakdown?.skillScore, null);
  });
  it('level credit + evidence credit reproduce the server skill score, and the text states that score', async () => {
    await signUp(); const first = (await coreApi.getReadiness('swe')).skills;
    await rate(first[0].skillId, 3); await rate(first[1].skillId, 2);
    await addEvidence([first[0].skillId], 'strong'); await addEvidence([first[0].skillId], 'weak', 'Small script');
    const v = await load(); const r = rules(v)!;
    for (const id of [first[0].skillId, first[1].skillId]) {
      const s = byId(v, id), b = s.breakdown!;
      assert.ok(Math.abs(r.levelWeight * (b.levelRatio as number) + (1 - r.levelWeight) * b.evidenceRatio - (b.skillScore as number)) < 0.006, 'components sum to the server score');
      const x = explainSkill(s, r)!;
      assert.ok(x.steps.find((t) => t.key === 'score')!.text.includes(`${Math.round((b.skillScore as number) * 100)} out of 100`));
      assert.match(x.steps.find((t) => t.key === 'weight')!.text, new RegExp(`contributes ${b.contribution} point`));
    }
    const x = explainSkill(byId(v, first[0].skillId), r)!;
    assert.equal(x.evidenceLines.length, 2); assert.deepEqual(x.evidenceLines.map((l) => l.points).sort(), [1, 3]);
    assert.match(x.steps.find((t) => t.key === 'evidence')!.text, /worth 4 points/);
  });
  it('the "what if" level line matches what the server actually computes after the user raises the rating', async () => {
    await signUp(); const sk = (await coreApi.getReadiness('swe')).skills.find((s) => s.requiredLevel >= 3)!;
    await rate(sk.skillId, 1);
    const v1 = await load(); const b1 = byId(v1, sk.skillId).breakdown!; const r = rules(v1)!;
    const claim = /about \+(\d+) points/.exec(explainSkill(byId(v1, sk.skillId), r)!.whatIf[0])!;
    await rate(sk.skillId, 2);
    const b2 = byId(await load(), sk.skillId).breakdown!;
    const serverDelta = ((b2.skillScore as number) - (b1.skillScore as number)) * 100;
    assert.ok(Math.abs(serverDelta - Number(claim[1])) <= 1, `claimed +${claim[1]}, server +${serverDelta.toFixed(1)}`);
  });
  it('a career-specific minimum number of evidence items is explained as the reason evidence is "thin"', async () => {
    await signUp();
    const made = await backend.call('POST', '/api/careers', { token, body: { name: 'Corporate Lawyer', category: 'Law', description: '', evidenceExpectations: ['A drafted agreement', 'A moot court record'], capabilities: [{ name: 'Foundations', skills: [{ name: 'Legal research', requiredLevel: 3, importance: 5, minEvidence: 2 }] }] } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = made.body.career.id as string, skillId = made.body.requirements[0].skillId as string;
    await rate(skillId, 3); await addEvidence([skillId], 'very_strong', 'Research memo');
    const v = await load(id); const s = byId(v, skillId);
    assert.equal(s.breakdown?.evidenceStatus, 'thin'); assert.equal(s.breakdown?.evidenceRequired, 2);
    const x = explainSkill(s, rules(v))!;
    assert.match(x.statusReason, /at least 2 evidence items; 1 is linked/); assert.match(x.statusReason, /however strong/);
    assert.match(x.whatIf.join(' '), /Link 1 more evidence item/);
    assert.deepEqual(v.guidance?.evidenceExpectations, ['A drafted agreement', 'A moot court record']);
  });
  it('self-reported evidence is never presented as verified', async () => {
    await signUp(); const sk = (await coreApi.getReadiness('swe')).skills[0];
    await rate(sk.skillId, 3); await addEvidence([sk.skillId]);
    const v = await load(); const x = explainSkill(byId(v, sk.skillId), rules(v))!;
    assert.match(x.caveat, /self-reported/); assert.ok(x.evidenceLines.every((l) => !l.verified && /Self-reported/.test(l.provenance)));
    assert.ok(!/verified by|independently verified/i.test(JSON.stringify(x.steps)));
  });
  it('returns null (so the UI falls back to the plain text) when there are no server numbers', () => {
    const local = { assessed: true, skillId: 's', name: 'S', capabilityId: 'c', capabilityName: 'C', careerName: 'X', requiredLevel: 3, currentLevel: 2, skillGap: 1, evidence: [], evidenceCount: 0, strongest: null, coverage: 'none', status: 'combined_gap', nextAction: '' } as SkillAnalysis;
    assert.equal(explainSkill(local, undefined), null); assert.equal(readinessBreakdown([local]), null);
  });
});

describe('readiness breakdown reconciles with the server score', () => {
  it('contributors add up to the headline score; unassessed skills are listed apart, not as zeros', async () => {
    await signUp(); const sk = (await coreApi.getReadiness('swe')).skills;
    await rate(sk[0].skillId, 4); await rate(sk[1].skillId, 1); await rate(sk[2].skillId, 3); await addEvidence([sk[0].skillId]);
    const v = await load(); const bd = readinessBreakdown(v.skills)!;
    assert.equal(bd.contributors.length, 3); assert.ok(Math.abs(bd.pointsTotal - v.readiness.overall) <= 1, `points ${bd.pointsTotal} vs score ${v.readiness.overall}`);
    assert.equal(bd.unassessed.length, v.skills.length - 3); assert.ok(bd.unassessed.every((s) => !bd.contributors.some((c) => c.skillId === s.skillId)));
    assert.ok(bd.contributors.every((c, i, a) => i === 0 || a[i - 1].points >= c.points), 'sorted by contribution');
    assert.ok(bd.belowTarget.every((s) => s.skillGap > 0)); assert.ok(bd.evidenceGaps.every((s) => s.assessed));
  });
  it('with nothing rated there are no contributors and no score', async () => {
    await signUp(); const v = await load(); const bd = readinessBreakdown(v.skills)!;
    assert.equal(bd.contributors.length, 0); assert.equal(v.readiness.assessment.state, 'not_assessed'); assert.equal(bd.unassessed.length, v.skills.length);
  });
});

describe('actions carry structured, explainable detail', () => {
  it('each action has a rank, a completion criterion, the skill it addresses and a ranking rule from the server', async () => {
    await signUp(); const sk = (await coreApi.getReadiness('swe')).skills;
    await rate(sk[0].skillId, 1);
    const v = await load();
    assert.ok(v.actions.length > 0); assert.match(v.guidance?.priorityCriteria ?? '', /2 x gap x importance/);
    for (const a of v.actions) { assert.ok(a.detail && a.detail.completionCriterion.length > 0 && a.detail.rank >= 1); assert.equal(a.relatedSkillIds.length, 1); assert.ok(a.reason.length > 0); }
    const build = v.actions.find((a) => a.detail?.kind === 'build_skill')!; assert.equal(build.relatedSkillIds[0], sk[0].skillId);
    assert.ok(v.actions.some((a) => a.detail?.kind === 'assess_skill'), 'unrated skills produce "assess" actions, not fabricated gaps');
  });
});
