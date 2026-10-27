import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AiProvider, AiRequest } from '../src/ai/provider';
import { NO_AI } from '../src/config';
import { buildCareerGraph } from '../src/domain/graph';
import { LOGIN_FAILURES, LOGIN_WINDOW_MS } from '../src/services/auth';
import { MAX_EVIDENCE_PER_USER } from '../src/services/core';
import { makeApp } from './helpers';

// Everything here runs the real routes, auth middleware, services and validation over IN-MEMORY repositories. It is not PostgreSQL.
class FakeAi implements AiProvider { readonly id = 'fake'; readonly label = 'Fake (tests only)'; readonly model = 'f1'; calls: AiRequest[] = []; async complete(r: AiRequest) { this.calls.push(r); return { text: 'ok' }; } }
type App = ReturnType<typeof makeApp>;
const PW = 'Passw0rdOK1';
const reg = async (app: App, email: string) => (await app.call('POST', '/api/auth/register', { body: { name: 'Ada', email, password: PW } })).body as { token: string };
const CAREER = { name: 'Fashion Designer', category: 'Fashion', description: 'Designing garments', evidenceExpectations: ['A finished collection'], capabilities: [{ name: 'Design', description: '', skills: [{ name: 'Pattern cutting', requiredLevel: 4, importance: 5 }, { name: 'Sketching', requiredLevel: 3, importance: 3 }] }, { name: 'Business', description: '', skills: [{ name: 'Costing', requiredLevel: 3, importance: 2 }] }] };
const make = async (app: App, token: string) => { const r = await app.call('POST', '/api/careers', { token, body: CAREER }); assert.equal(r.status, 201); return { id: r.body.career.id as string, skills: (r.body.requirements as { skillId: string }[]).map((x) => x.skillId) }; };
const EV = (title: string, skillIds: string[]) => ({ title, description: 'd', type: 'Project', strength: 'strong', skillIds });
const ACTION = { title: 'Raise Pattern cutting', description: 'x', type: 'build_skill', phase: 'skill_building', priority: 'high', priorityScore: 10, impact: 'high', effort: 'medium', estimatedTime: '1 week', reason: 'r', prerequisites: [], relatedSkillIds: [], relatedCapabilityIds: [] };

describe('login throttling (failed attempts only)', () => {
  it(`locks an email after ${LOGIN_FAILURES} failures with 429 + Retry-After, even for the right password, and unlocks with time`, async () => {
    const app = makeApp(); await reg(app, 'a@x.com');
    const bad = () => app.call('POST', '/api/auth/login', { body: { email: 'a@x.com', password: 'WrongPass123' } });
    for (let i = 0; i < LOGIN_FAILURES; i++) assert.equal((await bad()).status, 401);
    const locked = await app.call('POST', '/api/auth/login', { body: { email: 'a@x.com', password: PW } });
    assert.equal(locked.status, 429); assert.ok(Number(locked.headers['Retry-After']) >= 1); assert.ok(!JSON.stringify(locked.body).includes(PW));
    app.clock.ms += LOGIN_WINDOW_MS + 1000;
    assert.equal((await app.call('POST', '/api/auth/login', { body: { email: 'a@x.com', password: PW } })).status, 200);
  });
  it('is per email, counts unknown emails the same way (no account enumeration), and a success resets the count', async () => {
    const app = makeApp(); await reg(app, 'a@x.com'); await reg(app, 'b@x.com');
    const login = (email: string, password: string) => app.call('POST', '/api/auth/login', { body: { email, password } });
    for (let i = 0; i < LOGIN_FAILURES; i++) await login('ghost@x.com', 'WrongPass123');
    assert.equal((await login('ghost@x.com', 'WrongPass123')).status, 429, 'unknown email is throttled exactly like a real one');
    assert.equal((await login('b@x.com', PW)).status, 200, 'other emails are unaffected');
    for (let i = 0; i < LOGIN_FAILURES - 1; i++) await login('a@x.com', 'WrongPass123');
    assert.equal((await login('a@x.com', PW)).status, 200); // success clears the failures
    for (let i = 0; i < LOGIN_FAILURES - 1; i++) assert.equal((await login('a@x.com', 'WrongPass123')).status, 401);
    assert.equal((await login('a@x.com', PW)).status, 200);
  });
});

describe('evidence list paging and the per-user cap', () => {
  it('pages newest-first with a total, and rejects bad paging values', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com'); const c = await make(app, token);
    for (const t of ['one', 'two', 'three']) assert.equal((await app.call('POST', '/api/evidence', { token, body: EV(t, [c.skills[0]]) })).status, 201);
    const all = (await app.call('GET', '/api/evidence', { token })).body; assert.equal(all.total, 3); assert.equal(all.evidence.length, 3); assert.equal(all.limit, 200);
    const page = (await app.call('GET', '/api/evidence?limit=2&offset=2', { token })).body; assert.equal(page.evidence.length, 1); assert.equal(page.total, 3); assert.equal(page.offset, 2);
    for (const q of ['limit=0', 'limit=201', 'limit=abc', 'offset=-1']) assert.equal((await app.call('GET', `/api/evidence?${q}`, { token })).status, 400, q);
  });
  it(`refuses the ${MAX_EVIDENCE_PER_USER + 1}th item with a clear 409, and frees a slot after a delete`, async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com'); const c = await make(app, token); let first = '';
    for (let i = 0; i < MAX_EVIDENCE_PER_USER; i++) { const r = await app.call('POST', '/api/evidence', { token, body: EV(`e${i}`, [c.skills[0]]) }); assert.equal(r.status, 201); if (!first) first = r.body.id; }
    const over = await app.call('POST', '/api/evidence', { token, body: EV('too many', [c.skills[0]]) });
    assert.equal(over.status, 409); assert.equal(over.body.error?.code ?? over.body.code, 'evidence_limit_reached');
    assert.equal((await app.call('DELETE', `/api/evidence/${first}`, { token })).status, 204);
    assert.equal((await app.call('POST', '/api/evidence', { token, body: EV('fits now', [c.skills[0]]) })).status, 201);
  });
});

describe('roadmap progress on /actions', () => {
  it('returns each action with its saved status; completing is persistent and idempotent; history keeps closed ones', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com'); const c = await make(app, token);
    await app.call('PUT', `/api/me/skills/${c.skills[0]}`, { token, body: { level: 1 } });
    const get = async () => (await app.call('GET', `/api/careers/${c.id}/actions`, { token })).body;
    const before = await get(); const a = before.actions.find((x: { id: string }) => x.id === `build_skill:${c.skills[0]}`);
    assert.ok(a); assert.equal(a.status, 'not_started'); assert.equal(a.completedAt, null);
    const put = (status: string) => app.call('PUT', `/api/careers/${c.id}/action-progress/${encodeURIComponent(a.id)}`, { token, body: { status, action: { ...ACTION, relatedSkillIds: [c.skills[0]] } } });
    assert.equal((await put('in_progress')).status, 200);
    assert.equal((await get()).summary.inProgress, 1);
    assert.equal((await put('completed')).status, 200); assert.equal((await put('completed')).status, 200);
    const done = await get(); const d = done.actions.find((x: { id: string }) => x.id === a.id);
    assert.equal(d.status, 'completed'); assert.ok(d.completedAt); assert.equal(done.summary.completed, 1); assert.equal(done.history.length, 0);
    await app.call('PUT', `/api/me/skills/${c.skills[0]}`, { token, body: { level: 4 } }); // the gap closes: the action is no longer generated
    const closed = await get();
    assert.ok(!closed.actions.some((x: { id: string }) => x.id === a.id)); assert.deepEqual(closed.history.map((h: { actionKey: string; status: string }) => [h.actionKey, h.status]), [[a.id, 'completed']]);
  });
  it('is authenticated and isolated', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com'); const c = await make(app, a.token);
    assert.equal((await app.call('GET', `/api/careers/${c.id}/actions`)).status, 401);
    assert.equal((await app.call('GET', `/api/careers/${c.id}/actions`, { token: b.token })).status, 404);
  });
});

describe('GET /api/careers/:id/graph', () => {
  it('builds career -> capability -> skill -> evidence/action from real records only', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com'); const c = await make(app, token);
    await app.call('PUT', `/api/me/skills/${c.skills[0]}`, { token, body: { level: 2 } });
    const ev = (await app.call('POST', '/api/evidence', { token, body: EV('Capsule lookbook', [c.skills[0]]) })).body;
    await app.call('POST', '/api/evidence', { token, body: EV('Unrelated shared-career item', ['swe:not-in-this-career']) }); // not linkable: rejected below
    const g = (await app.call('GET', `/api/careers/${c.id}/graph`, { token })).body;
    const ids = g.nodes.map((n: { id: string }) => n.id); assert.equal(new Set(ids).size, ids.length);
    assert.ok(g.links.every((l: { source: string; target: string }) => ids.includes(l.source) && ids.includes(l.target)), 'no dangling links');
    const kinds = (k: string) => g.nodes.filter((n: { kind: string }) => n.kind === k);
    assert.equal(kinds('career').length, 1); assert.equal(kinds('capability').length, 2); assert.equal(kinds('skill').length, 3); assert.equal(kinds('evidence').length, 1);
    assert.deepEqual(g.links.filter((l: { kind: string }) => l.kind === 'supports'), [{ source: c.skills[0], target: ev.id, kind: 'supports' }]);
    const rated = kinds('skill').find((n: { id: string }) => n.id === c.skills[0]), unrated = kinds('skill').find((n: { id: string }) => n.id === c.skills[1]);
    assert.equal(rated.data.currentLevel, 2); assert.equal(unrated.data.currentLevel, null); assert.equal(unrated.data.assessed, false); assert.equal(unrated.data.skillScore, null);
    assert.equal(kinds('evidence')[0].data.verified, false);
    assert.ok(g.links.filter((l: { kind: string }) => l.kind === 'addresses').every((l: { source: string; target: string }) => c.skills.includes(l.source) && l.target.startsWith('action:')));
    assert.ok(g.notes.some((n: string) => /not independently verified/.test(n)));
  });
  it('shows no readiness score and no actions-as-completed when nothing is rated; no prerequisite links exist', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com'); const c = await make(app, token);
    const g = (await app.call('GET', `/api/careers/${c.id}/graph`, { token })).body;
    assert.equal(g.readiness.score, null); assert.equal(g.readiness.state, 'not_assessed'); assert.ok(g.notes.some((n: string) => /No skills are rated/.test(n)));
    assert.ok(g.links.every((l: { kind: string }) => ['contains', 'supports', 'addresses'].includes(l.kind)));
    assert.equal(g.summary.completedActions, 0);
  });
  it('requires authentication, 404s a foreign career without leaking, and never includes another user\'s evidence', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com'); const c = await make(app, a.token);
    await app.call('POST', '/api/evidence', { token: a.token, body: EV('A-PRIVATE-EVIDENCE', [c.skills[0]]) });
    assert.equal((await app.call('GET', `/api/careers/${c.id}/graph`)).status, 401);
    const r = await app.call('GET', `/api/careers/${c.id}/graph`, { token: b.token }); assert.equal(r.status, 404); assert.ok(!JSON.stringify(r.body).includes('A-PRIVATE'));
    assert.equal((await app.call('GET', '/api/careers/bad id!/graph', { token: b.token })).status, 400);
    const swe = (await app.call('GET', '/api/careers/swe/graph', { token: b.token })).body; assert.ok(!JSON.stringify(swe).includes('A-PRIVATE'));
  });
  it('the pure builder ignores actions and evidence that point at skills outside the career', () => {
    const r = { careerId: 'c', careerName: 'C', state: 'not_assessed', score: null, counts: { total: 1, assessed: 0 }, skills: [{ skillId: 's', name: 'S', capabilityId: 'k', capabilityName: 'K', requiredLevel: 3, importance: 3, assessed: false, currentLevel: null, status: 'not_assessed', gap: null, evidenceCount: 0, evidenceStatus: 'none', skillScore: null, contribution: null }] } as never;
    const g = buildCareerGraph(r, [{ id: 'e', title: 't', type: 'x', strength: 'weak', source: 'user', skillIds: ['other'] }], [{ id: 'a', skillId: 'other', recommendation: 'x' } as never]);
    assert.equal(g.nodes.filter((n) => n.kind === 'evidence' || n.kind === 'action').length, 0);
  });
});

describe('COMPLETE BACKEND JOURNEY (in-memory repositories)', () => {
  it('register -> login -> onboarding -> custom career -> skills -> evidence -> graph -> readiness -> gaps -> roadmap -> completion -> updates -> assistant', async () => {
    const ai = new FakeAi();
    const app = makeApp({ aiProvider: ai, config: { ai: { ...NO_AI, provider: 'anthropic', apiKey: 'k', model: 'm', ratePerMinute: 50 } } as never });
    // register + login
    assert.equal((await app.call('POST', '/api/auth/register', { body: { name: 'Ada', email: 'ada@x.com', password: PW } })).status, 201);
    assert.equal((await app.call('POST', '/api/auth/register', { body: { name: 'Ada', email: 'ADA@x.com', password: PW } })).status, 409, 'duplicate email, case-insensitive');
    const login = await app.call('POST', '/api/auth/login', { body: { email: 'ada@x.com', password: PW } }); assert.equal(login.status, 200);
    const token = login.body.token as string;
    assert.equal((await app.call('GET', '/api/auth/me', { token })).body.user.email, 'ada@x.com');
    // custom career + onboarding
    const c = await make(app, token);
    const prof = await app.call('PUT', '/api/profile', { token, body: { targetCareerId: c.id, stage: 'student', experienceLevel: 'beginner', onboardingComplete: true } });
    assert.equal(prof.status, 200); assert.equal((await app.call('GET', '/api/profile', { token })).body.targetCareerId, c.id);
    assert.equal((await app.call('PUT', '/api/profile', { token, body: { targetCareerId: c.id, experienceLevel: 'wizard' } })).status, 400);
    // nothing rated yet: no fabricated score
    const r0 = (await app.call('GET', `/api/careers/${c.id}/readiness`, { token })).body; assert.equal(r0.score, null); assert.equal(r0.state, 'not_assessed');
    // rate + evidence
    await app.call('PUT', `/api/me/skills/${c.skills[0]}`, { token, body: { level: 1 } });
    const ev = (await app.call('POST', '/api/evidence', { token, body: EV('First pattern block', [c.skills[0]]) })).body;
    const r1 = (await app.call('GET', `/api/careers/${c.id}/readiness`, { token })).body; assert.equal(typeof r1.score, 'number');
    const gaps = (await app.call('GET', `/api/careers/${c.id}/gaps`, { token })).body; assert.ok(JSON.stringify(gaps).includes(c.skills[0]));
    // graph agrees with readiness
    const g1 = (await app.call('GET', `/api/careers/${c.id}/graph`, { token })).body; assert.equal(g1.readiness.score, r1.score); assert.equal(g1.summary.evidence, 1);
    // roadmap + completion (does not change readiness by itself)
    const key = `build_skill:${c.skills[0]}`;
    const road = (await app.call('GET', `/api/careers/${c.id}/actions`, { token })).body; assert.ok(road.actions.some((a: { id: string }) => a.id === key));
    assert.equal((await app.call('PUT', `/api/careers/${c.id}/action-progress/${encodeURIComponent(key)}`, { token, body: { status: 'completed', action: { ...ACTION, relatedSkillIds: [c.skills[0]] } } })).status, 200);
    assert.equal((await app.call('GET', `/api/careers/${c.id}/readiness`, { token })).body.score, r1.score, 'marking an action complete never changes readiness');
    // assistant sees the completion and the evidence, and does not offer the action again
    assert.equal((await app.call('POST', '/api/assistant/chat', { token, body: { careerId: c.id, messages: [{ role: 'user', content: 'What next?' }] } })).status, 200);
    const sys = ai.calls[0].system; assert.ok(sys.includes('First pattern block') && sys.includes('Raise Pattern cutting'));
    const ctx = JSON.parse(sys.split('<career_data>\n')[1].split('\n</career_data>')[0]); assert.ok(!ctx.topActions.some((a: { type: string; skill: string }) => a.type === 'build_skill' && a.skill === 'Pattern cutting'));
    // updating the rating changes readiness; unlinking evidence changes the graph
    await app.call('PUT', `/api/me/skills/${c.skills[0]}`, { token, body: { level: 4 } });
    const r2 = (await app.call('GET', `/api/careers/${c.id}/readiness`, { token })).body; assert.ok(r2.score > r1.score);
    assert.equal((await app.call('DELETE', `/api/evidence/${ev.id}/skills/${c.skills[0]}`, { token })).status, 200);
    assert.equal((await app.call('GET', `/api/careers/${c.id}/graph`, { token })).body.summary.links, g1.summary.links - 1 - g1.summary.actions + (await app.call('GET', `/api/careers/${c.id}/graph`, { token })).body.summary.actions, 'the supports link is gone');
    // a second user sees none of it; logout is a client-side discard
    const b = await reg(app, 'bob@x.com');
    for (const p of [`/api/careers/${c.id}/graph`, `/api/careers/${c.id}/readiness`, `/api/careers/${c.id}/actions`]) assert.equal((await app.call('GET', p, { token: b.token })).status, 404, p);
    assert.equal((await app.call('POST', '/api/auth/logout', { token })).status, 204);
  });
});
