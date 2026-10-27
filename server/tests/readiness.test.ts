import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcActions, calcGaps, calcReadiness, type EngineInput, type EngineSkill } from '../src/domain/readiness';
import { CAREER_DATASETS } from '../src/domain/shared';
import { routes } from '../src/routes';
import { makeApp } from './helpers';

const sk = (id: string, req: number, imp: number, pos = 0, cap = 'c1'): EngineSkill => ({ skillId: id, name: id.toUpperCase(), capabilityId: cap, capabilityName: `Cap ${cap}`, requiredLevel: req, importance: imp, position: pos });
const inp = (skills: EngineSkill[], assessments: Record<string, number> = {}, evidenceStrengths: Record<string, string[]> = {}): EngineInput => ({ careerId: 'x', careerName: 'X', skills, assessments, evidenceStrengths });

describe('readiness engine (pure unit tests, no database)', () => {
  it('all skills assessed and meeting requirements with strong evidence -> 100', () => {
    const r = calcReadiness(inp([sk('a', 3, 3), sk('b', 4, 5, 1)], { a: 3, b: 5 }, { a: ['very_strong'], b: ['very_strong', 'strong'] }));
    assert.equal(r.state, 'assessed'); assert.equal(r.score, 100); assert.deepEqual(r.range, { min: 100, max: 100 });
    assert.equal(r.counts.meets, 2); assert.equal(r.counts.below, 0);
    assert.equal(Math.round(r.skills.reduce((t, s) => t + (s.contribution as number), 0)), 100); // contributions add up to the score
  });
  it('skills below requirement lower the score and report the gap', () => {
    const r = calcReadiness(inp([sk('a', 4, 3)], { a: 2 }));
    assert.equal(r.score, 38); // 0.75 * 0.5 + 0.25 * 0 = 0.375
    assert.equal(r.skills[0].status, 'below'); assert.equal(r.skills[0].gap, 2); assert.equal(r.skills[0].levelRatio, 0.5);
    assert.ok(r.caveats.some((c) => /no linked evidence/.test(c)));
  });
  it('unassessed skills are unknown, never zero: no score when nothing is rated', () => {
    const r = calcReadiness(inp([sk('a', 3, 3), sk('b', 3, 3, 1)]));
    assert.equal(r.state, 'not_assessed'); assert.equal(r.score, null); assert.equal(r.range, null);
    assert.ok(r.skills.every((s) => s.assessed === false && s.currentLevel === null && s.gap === null && s.skillScore === null && s.contribution === null));
    assert.match(r.caveats.join(' '), /unknown, not zero/);
  });
  it('a genuine level 0 is assessed and differs from unassessed', () => {
    const r = calcReadiness(inp([sk('a', 3, 3), sk('b', 3, 3, 1)], { a: 0 }));
    assert.equal(r.state, 'partial'); assert.equal(r.score, 0); assert.equal(r.skills[0].assessed, true); assert.equal(r.skills[1].assessed, false);
  });
  it('partial assessment: score covers rated skills only, range shows the bounds', () => {
    const r = calcReadiness(inp([sk('a', 2, 2), sk('b', 2, 2, 1)], { a: 2 }, { a: ['strong'] })); // a: 0.75 + 0.25*min(3/2.4,1) = 1
    assert.equal(r.state, 'partial'); assert.equal(r.score, 100); assert.deepEqual(r.range, { min: 50, max: 100 });
    assert.equal(r.weights.assessedShare, 0.5); assert.match(r.caveats.join(' '), /Only 1 of 2 skills are rated/);
  });
  it('importance weighting changes the result', () => {
    const skills = (impA: number, impB: number) => [sk('a', 4, impA), sk('b', 4, impB, 1)];
    const as = { a: 4, b: 0 };
    const heavyOnMet = calcReadiness(inp(skills(5, 1), as)).score as number, equal = calcReadiness(inp(skills(3, 3), as)).score as number, heavyOnGap = calcReadiness(inp(skills(1, 5), as)).score as number;
    assert.equal(equal, 38); assert.equal(heavyOnMet, 63); assert.equal(heavyOnGap, 13);
    assert.ok(heavyOnMet > equal && equal > heavyOnGap);
  });
  it('evidence present vs absent changes the score, and evidence strength matters', () => {
    const base = [sk('a', 3, 3)];
    const none = calcReadiness(inp(base, { a: 3 })), weak = calcReadiness(inp(base, { a: 3 }, { a: ['weak'] })), strong = calcReadiness(inp(base, { a: 3 }, { a: ['very_strong'] }));
    assert.equal(none.score, 75); assert.equal(strong.score, 100); assert.ok((weak.score as number) > 75 && (weak.score as number) < 100);
    assert.equal(none.skills[0].evidenceStatus, 'none'); assert.equal(weak.skills[0].evidenceStatus, 'thin'); assert.equal(strong.skills[0].evidenceStatus, 'sufficient');
  });
  it('no required skills / incomplete career data is handled safely', () => {
    const r = calcReadiness(inp([]));
    assert.equal(r.state, 'no_requirements'); assert.equal(r.score, null); assert.deepEqual(calcActions(inp([])), []);
    const odd = calcReadiness(inp([sk('a', 0, Number.NaN), sk('b', 9, 99, 1)], { a: 0, b: 3, ghost: 5 }));
    assert.equal(odd.skills[0].importance, 3); assert.equal(odd.skills[1].importance, 5); assert.equal(odd.skills[0].status, 'meets'); // requirement 0 = nothing required
    assert.ok(odd.score !== null && odd.score >= 0 && odd.score <= 100);
  });
  it('is deterministic: input order and repeated calls do not change output', () => {
    const skills = [sk('a', 4, 3, 0), sk('b', 3, 5, 1), sk('c', 5, 2, 2), sk('d', 2, 4, 3)];
    const as = { a: 1, b: 3, c: 2 }, ev = { b: ['strong'] };
    const one = calcReadiness(inp(skills, as, ev)), two = calcReadiness(inp([...skills].reverse(), as, ev));
    assert.deepEqual(one, two); assert.deepEqual(calcReadiness(inp(skills, as, ev)), one);
    assert.deepEqual(calcActions(inp(skills, as, ev), 10), calcActions(inp([...skills].reverse(), as, ev), 10));
  });
  it('gaps separate below / unassessed / meets and sort by weighted gap', () => {
    const g = calcGaps(inp([sk('a', 5, 2), sk('b', 3, 5, 1), sk('c', 3, 3, 2), sk('d', 3, 3, 3)], { a: 1, b: 1, c: 3 }));
    assert.deepEqual(g.below.map((s) => [s.skillId, s.weightedGap]), [['b', 10], ['a', 8]]);
    assert.deepEqual(g.unassessed.map((s) => s.skillId), ['d']); assert.deepEqual(g.meets.map((s) => s.skillId), ['c']);
    assert.deepEqual(g.counts, { total: 4, assessed: 3, unassessed: 1, meets: 1, below: 2 });
  });
  it('actions: prioritized, capped, with criteria; unknown is not treated as a gap', () => {
    const skills = [sk('a', 4, 5), sk('b', 3, 2, 1), sk('c', 3, 3, 2), sk('d', 2, 3, 3)];
    const acts = calcActions(inp(skills, { a: 1, c: 3 }, { c: ['weak'] }), 10);
    assert.deepEqual(acts.map((x) => x.id), ['build_skill:a', 'assess_skill:d', 'assess_skill:b', 'add_evidence:c']);
    assert.deepEqual(acts.map((x) => x.rank), [1, 2, 3, 4]);
    assert.equal(acts[0].priority, 'high'); assert.equal(acts[0].targetLevel, 4); assert.match(acts[0].completionCriterion, /level 4 or higher/);
    assert.ok(acts.every((x) => x.reason && x.recommendation && x.completionCriterion && x.capabilityName));
    assert.equal(calcActions(inp(skills, { a: 1 }), 2).length, 2); assert.equal(calcActions(inp(skills), 0).length, 1); // limit floor 1
  });
  it('a fully ready, well-evidenced user gets no actions', () => {
    assert.deepEqual(calcActions(inp([sk('a', 3, 3)], { a: 3 }, { a: ['very_strong'] })), []);
  });
});

type App = ReturnType<typeof makeApp>;
const reg = async (app: App, email: string) => { const r = await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email, password: 'Passw0rdOK1' } }); assert.equal(r.status, 201); return { token: r.body.token as string, id: r.body.user.id as string }; };
const SWE = CAREER_DATASETS[0].career, ALL = SWE.capabilities.flatMap((c) => c.skills);
const base = `/api/careers/${SWE.id}`;

describe('readiness / gaps / actions API', () => {
  it('requires authentication', async () => {
    const app = makeApp();
    for (const p of ['readiness', 'gaps', 'actions']) { assert.equal((await app.call('GET', `${base}/${p}`)).status, 401); assert.equal((await app.call('GET', `${base}/${p}`, { token: 'a.b.c' })).status, 401); }
  });
  it('rejects malformed ids (400), unknown careers (404) and bad limits (400)', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    for (const p of ['readiness', 'gaps', 'actions']) { assert.equal((await app.call('GET', `/api/careers/bad%20id/${p}`, { token })).status, 400); const r = await app.call('GET', `/api/careers/nope/${p}`, { token }); assert.equal(r.status, 404); assert.equal(r.body.error.code, 'career_not_found'); }
    for (const l of ['0', '11', 'x', '-1', '2.5']) assert.equal((await app.call('GET', `${base}/actions?limit=${l}`, { token })).status, 400, l);
  });
  it('new user: not assessed, no score, every skill unassessed, actions are "assess"', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const r = (await app.call('GET', `${base}/readiness`, { token })).body;
    assert.equal(r.state, 'not_assessed'); assert.equal(r.score, null); assert.equal(r.counts.total, ALL.length); assert.equal(r.counts.unassessed, ALL.length); assert.ok(r.formula && r.caveats.length);
    const g = (await app.call('GET', `${base}/gaps`, { token })).body; assert.equal(g.below.length, 0); assert.equal(g.unassessed.length, ALL.length);
    const a = (await app.call('GET', `${base}/actions`, { token })).body; assert.equal(a.actions.length, 5); assert.ok(a.actions.every((x: { type: string }) => x.type === 'assess_skill'));
  });
  it('reflects saved assessments and evidence end to end', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const s0 = ALL[0], s1 = ALL[1];
    await app.call('PUT', `/api/me/skills/${s0.id}`, { token, body: { level: 1 } });
    await app.call('PUT', `/api/me/skills/${s1.id}`, { token, body: { level: 5 } });
    const r1 = (await app.call('GET', `${base}/readiness`, { token })).body;
    assert.equal(r1.state, 'partial'); assert.equal(r1.counts.assessed, 2); assert.equal(typeof r1.score, 'number'); assert.ok(r1.range.min <= r1.score && r1.score <= r1.range.max);
    const row = r1.skills.find((s: { skillId: string }) => s.skillId === s0.id); assert.equal(row.currentLevel, 1); assert.equal(row.requiredLevel, s0.requiredLevel);
    const g = (await app.call('GET', `${base}/gaps`, { token })).body;
    assert.equal(g.below.some((s: { skillId: string }) => s.skillId === s0.id), s0.requiredLevel > 1);
    assert.ok(g.meets.some((s: { skillId: string }) => s.skillId === s1.id));
    const before = r1.skills.find((s: { skillId: string }) => s.skillId === s1.id).skillScore;
    await app.call('POST', '/api/evidence', { token, body: { title: 'Proof', description: 'd', type: 'Project', strength: 'very_strong', skillIds: [s1.id] } });
    const after = (await app.call('GET', `${base}/readiness`, { token })).body.skills.find((s: { skillId: string }) => s.skillId === s1.id);
    assert.ok(after.skillScore > before); assert.equal(after.evidenceCount, 1);
    const again = (await app.call('GET', `${base}/readiness`, { token })).body; // stable across calls
    assert.deepEqual((await app.call('GET', `${base}/readiness`, { token })).body, again);
    const acts = (await app.call('GET', `${base}/actions?limit=3`, { token })).body.actions; assert.equal(acts.length, 3); if (s0.requiredLevel > 1) assert.ok(acts.some((x: { type: string; skillId: string }) => x.type === 'build_skill' && x.skillId === s0.id));
  });
  it('is isolated per user and ignores a client-supplied user id', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    for (const s of ALL) await app.call('PUT', `/api/me/skills/${s.id}`, { token: a.token, body: { level: 5 } });
    await app.call('POST', '/api/evidence', { token: a.token, body: { title: 'A only', description: 'd', type: 'Project', strength: 'strong', skillIds: [ALL[0].id] } });
    const ra = (await app.call('GET', `${base}/readiness`, { token: a.token })).body, rb = (await app.call('GET', `${base}/readiness?userId=${a.id}`, { token: b.token, body: { userId: a.id } })).body;
    assert.equal(ra.state, 'assessed'); assert.equal(rb.state, 'not_assessed'); assert.equal(rb.score, null);
    assert.ok(rb.skills.every((s: { evidenceCount: number; assessed: boolean }) => s.evidenceCount === 0 && !s.assessed));
    assert.equal((await app.call('GET', `${base}/gaps?userId=${a.id}`, { token: b.token })).body.meets.length, 0);
    assert.ok(!JSON.stringify(rb).includes('A only'));
  });
  it('assessments of skills from another career do not affect this career', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const other = CAREER_DATASETS[1].career.capabilities[0].skills[0].id;
    await app.call('PUT', `/api/me/skills/${other}`, { token, body: { level: 5 } });
    assert.equal((await app.call('GET', `${base}/readiness`, { token })).body.state, 'not_assessed');
  });
});

describe('Stage 3 regression: every endpoint is still registered and protected', () => {
  const expected = ['GET /api/careers', 'GET /api/careers/:careerId', 'GET /api/careers/:careerId/skills', 'GET /api/me/skills', 'GET /api/me/skills/:skillId', 'PUT /api/me/skills/:skillId', 'DELETE /api/me/skills/:skillId',
    'GET /api/evidence', 'POST /api/evidence', 'GET /api/evidence/:evidenceId', 'PUT /api/evidence/:evidenceId', 'DELETE /api/evidence/:evidenceId', 'POST /api/evidence/:evidenceId/skills/:skillId', 'DELETE /api/evidence/:evidenceId/skills/:skillId',
    'GET /api/profile', 'PUT /api/profile', 'GET /api/auth/me'];
  it('keeps all Stage 1-3 routes with authentication', () => {
    for (const e of expected) { const [m, p] = e.split(' '); const r = routes.find((x) => x.method === m && x.path === p); assert.ok(r, `missing ${e}`); assert.equal(r.auth, true, `${e} must require auth`); }
    assert.ok(routes.find((x) => x.path === '/api/health')); assert.ok(routes.find((x) => x.path === '/api/auth/login' && !x.auth));
  });
  it('Stage 4 routes are read-only and authenticated', () => {
    const s4 = routes.filter((r) => /\/(readiness|gaps|actions)$/.test(r.path)); assert.equal(s4.length, 3); assert.ok(s4.every((r) => r.method === 'GET' && r.auth === true));
  });
});
