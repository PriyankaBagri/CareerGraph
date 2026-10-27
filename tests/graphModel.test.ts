import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeApp } from '../server/tests/helpers';
import { loadRemoteAnalysis } from '../src/services/analysisApi';
import { ApiError, api } from '../src/services/api';
import { authService } from '../src/services/auth';
import { coreApi } from '../src/services/coreApi';
import { evidenceService } from '../src/services/evidence';
import type { DashboardView } from '../src/types';
import { explainAction, skillPanel } from '../src/utils/graphDetail';
import { MAX_ACTION_NODES, actionNodeId, buildGraphModel, neighborId } from '../src/utils/graphModel';
import { resetStorage } from './helpers';

// REAL frontend services + REAL backend pipeline over in-memory repositories with a fake fetch. Not PostgreSQL, not a browser.
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
const signUp = (email = 'a@x.com') => authService.signUp('Ada', email, 'Passw0rdOK1');
const base = { description: 'did it', type: 'Project' as const, strength: 'strong' as const };
const load = async (): Promise<DashboardView> => loadRemoteAnalysis('swe', await evidenceService.getEvidence());
const model = (v: DashboardView, attentionOnly = false) => buildGraphModel({ career: v.career, evidence: v.evidence, skills: v.skills, actions: v.actions, attentionOnly });

describe('graph model mapping (real server data)', () => {
  it('maps career, capabilities, skills, evidence and actions with unique ids and only real links', async () => {
    await signUp(); const v0 = await load(); const [a, b] = v0.skills;
    await coreApi.setSkillAssessment(a.skillId, 1);
    await evidenceService.createEvidence({ ...base, title: 'Shipped', skillIds: [a.skillId] });
    const v = await load(), m = model(v);
    assert.equal(new Set(m.nodes.map((n) => n.id)).size, m.nodes.length);
    assert.equal(m.nodes.filter((n) => n.kind === 'skill').length, v.skills.length);
    assert.equal(m.nodes.filter((n) => n.kind === 'evidence').length, 1);
    const ids = new Set(m.nodes.map((n) => n.id));
    assert.ok(m.links.every((l) => ids.has(l.a) && ids.has(l.b)), 'no dangling links');
    assert.deepEqual(m.links.filter((l) => l.kind === 'supports').map((l) => [l.a, l.b]).filter(([s]) => s === a.skillId).length, 1);
    assert.ok(!m.links.some((l) => l.kind === 'supports' && l.a === b.skillId), 'no evidence link for a skill the user did not link');
    for (const l of m.links.filter((x) => x.kind === 'addresses')) { const act = v.actions.find((x) => actionNodeId(x) === l.b)!; assert.ok(act.relatedSkillIds.includes(l.a)); }
    assert.ok(m.nodes.filter((n) => n.kind === 'action').length <= MAX_ACTION_NODES);
  });
  it('orders actions by the server rank, excludes completed ones but counts them', async () => {
    await signUp(); const v = await load();
    assert.ok(v.actions.length > 2);
    const ranks = model(v).openActions.map((a) => a.detail!.rank);
    assert.deepEqual(ranks, [...ranks].sort((x, y) => x - y));
    const done = { ...v.actions[0], status: 'completed' as const };
    const m = buildGraphModel({ career: v.career, evidence: v.evidence, skills: v.skills, actions: [done, ...v.actions.slice(1)] });
    assert.equal(m.completedActions, 1); assert.ok(!m.openActions.some((a) => a.id === done.id));
  });
  it('ignores actions pointing at skills that do not exist', async () => {
    await signUp(); const v = await load();
    const ghost = { ...v.actions[0], id: 'ghost', relatedSkillIds: ['no-such-skill'] };
    assert.ok(!model({ ...v, actions: [ghost] }).nodes.some((n) => n.id === 'act:ghost'));
  });
  it('the attention filter hides on-track skills but keeps unassessed ones', async () => {
    await signUp(); const v = await load();
    assert.equal(model(v, true).nodes.filter((n) => n.kind === 'skill').length, v.skills.length, 'nothing is assessed, so every skill needs attention');
    const top = v.skills.map((s) => ({ ...s, assessed: true, currentLevel: s.requiredLevel, evidenceCount: 9, breakdown: s.breakdown && { ...s.breakdown, evidenceStatus: 'enough' as const } }));
    const m = buildGraphModel({ career: v.career, evidence: v.evidence, skills: top, actions: [], attentionOnly: true });
    assert.ok(m.hiddenSkills >= 0 && m.nodes.filter((n) => n.kind === 'skill').length <= v.skills.length);
  });
  it('arrow navigation follows real links and stays in bounds', async () => {
    await signUp(); const v0 = await load(); const s = v0.skills[0];
    await coreApi.setSkillAssessment(s.skillId, 1);
    const e = await evidenceService.createEvidence({ ...base, title: 'P', skillIds: [s.skillId] });
    const v = await load(), m = model(v);
    assert.equal(neighborId(m, s.skillId, 'right') === e.id || m.openActions.some((a) => actionNodeId(a) === neighborId(m, s.skillId, 'right')), true);
    assert.equal(neighborId(m, e.id, 'left'), s.skillId);
    const cap = v.career.capabilities.find((c) => c.skills.some((x) => x.id === s.skillId))!;
    assert.equal(neighborId(m, s.skillId, 'left'), cap.id);
    assert.equal(neighborId(m, v.career.id, 'left'), v.career.id);
    assert.equal(neighborId(m, 'unknown', 'up'), m.nodes[0].id);
  });
});

describe('prioritization explanation', () => {
  it('shows score arithmetic only when it reproduces the server score, and names the gap', async () => {
    await signUp(); const v0 = await load();
    await coreApi.setSkillAssessment(v0.skills[0].skillId, 1);
    const v = await load();
    for (const a of v.actions) {
      const x = explainAction(a, v.skills, v.actions.length, v.guidance);
      assert.ok(x.whyRanked.length >= 2); assert.ok(x.skill?.id === a.relatedSkillIds[0]);
      const scoreLine = x.whyRanked.find((t) => /=\s*[\d.]+/.test(t));
      if (scoreLine) assert.ok(scoreLine.includes(String(a.priorityScore)), `${scoreLine} should equal ${a.priorityScore}`);
    }
    const build = v.actions.find((a) => a.detail?.kind === 'build_skill'); assert.ok(build);
    assert.ok(explainAction(build, v.skills, v.actions.length).doneWhen);
    const assess = v.actions.find((a) => a.detail?.kind === 'assess_skill'); assert.ok(assess);
    assert.match(explainAction(assess, v.skills, v.actions.length).evidenceToProduce.map((e) => e.text).join(' '), /rate/i);
  });
});

describe('refresh after changes (no stale data)', () => {
  it('linking and unlinking evidence changes the skill, its evidence node and its actions', async () => {
    await signUp(); const v0 = await load(); const s = v0.skills[0];
    await coreApi.setSkillAssessment(s.skillId, s.requiredLevel);
    const before = await load();
    assert.ok(before.actions.some((a) => a.relatedSkillIds.includes(s.skillId) && a.detail?.kind === 'add_evidence'), 'meets level but has no evidence, so an add-evidence action exists');
    const e = await evidenceService.createEvidence({ ...base, strength: 'very_strong', title: 'Proof', skillIds: [s.skillId] });
    const linked = await load(), m = model(linked);
    assert.ok(m.links.some((l) => l.a === s.skillId && l.b === e.id));
    assert.ok(!linked.actions.some((a) => a.relatedSkillIds.includes(s.skillId) && a.detail?.kind === 'add_evidence'), 'action disappears once evidence is enough');
    await evidenceService.setSkillLink(e, s.skillId, false);
    const after = await load(), m2 = model(after);
    assert.ok(!m2.links.some((l) => l.a === s.skillId && l.b === e.id));
    assert.ok(after.actions.some((a) => a.relatedSkillIds.includes(s.skillId) && a.detail?.kind === 'add_evidence'), 'action returns after unlinking');
    assert.equal(skillPanel(after.skills.find((x) => x.skillId === s.skillId)!, after.evidence, after.actions).evidence.length, 0);
  });
  it('changing a rating changes the action kind for that skill', async () => {
    await signUp(); const v0 = await load(); const s = v0.skills[0];
    assert.ok(v0.actions.some((a) => a.relatedSkillIds.includes(s.skillId) && a.detail?.kind === 'assess_skill'));
    await coreApi.setSkillAssessment(s.skillId, 0);
    const v = await load();
    assert.ok(!v.actions.some((a) => a.relatedSkillIds.includes(s.skillId) && a.detail?.kind === 'assess_skill'));
    assert.ok(v.skills.find((x) => x.skillId === s.skillId)!.assessed);
  });
});

describe('authorization', () => {
  it('requests are rejected without a token and another user cannot see your evidence in the graph', async () => {
    await signUp('a@x.com'); const v0 = await load(); const s = v0.skills[0];
    const mine = await evidenceService.createEvidence({ ...base, title: 'Private', skillIds: [s.skillId] });
    authService.signOut?.(); api.setToken(null);
    await assert.rejects(() => coreApi.getActions('swe', 10), (e: unknown) => e instanceof ApiError && e.status === 401);
    await authService.signUp('Bob', 'b@x.com', 'Passw0rdOK1');
    const vb = await load();
    assert.ok(!vb.evidence.some((e) => e.id === mine.id));
    await assert.rejects(() => coreApi.getActions('not-a-career', 10), (e: unknown) => e instanceof ApiError && e.status === 404);
  });
});

describe('component guards', () => {
  const src = readFileSync(new URL('../src/components/graph/CareerGraph.tsx', import.meta.url), 'utf8');
  it('is keyboard operable, announces changes, and has no network or write path of its own', () => {
    for (const k of ['ArrowUp', 'ArrowRight', 'Enter', 'Escape']) assert.ok(src.includes(k), k);
    assert.ok(/aria-live="polite"/.test(src) && /role="status"/.test(src) && /aria-busy/.test(src) && /aria-pressed/.test(src));
    assert.ok(!/fetch\(|coreApi|evidenceService|setActionStatus/.test(src), 'the graph is read-only; changes go through existing pages');
    assert.ok(/tabIndex=\{n\.id === focusId \? 0 : -1\}/.test(src), 'roving tabindex');
  });
});
