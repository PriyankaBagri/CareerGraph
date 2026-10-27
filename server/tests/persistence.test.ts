import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeApp } from './helpers';

type App = ReturnType<typeof makeApp>;
const reg = async (app: App, email: string) => { const r = await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email, password: 'Passw0rdOK1' } }); assert.equal(r.status, 201, JSON.stringify(r.body)); return { token: r.body.token as string, id: r.body.user.id as string }; };
const CAREER = { name: 'Corporate Lawyer', category: 'Law', description: 'Advising companies', evidenceExpectations: ['Drafted agreement'], capabilities: [{ name: 'Foundations', description: 'Core', skills: [{ name: 'Legal research', requiredLevel: 4 }, { name: 'Drafting', requiredLevel: 3 }] }] };
const ACTION = { title: 'Raise Legal research', description: 'Practice', type: 'build_skill', phase: 'skill_building', priority: 'high', priorityScore: 60, impact: 'high', effort: 'medium', estimatedTime: '2-4 weeks', reason: 'Below target', prerequisites: [], relatedSkillIds: [], relatedCapabilityIds: [] };

describe('target career: visible to the user (regression: custom careers were rejected as "Unknown career")', () => {
  it('accepts a shared career and the user\'s OWN custom career, and restores it on the next profile read', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    assert.equal((await app.call('PUT', '/api/profile', { token: a.token, body: { targetCareerId: 'swe' } })).status, 200);
    const id = (await app.call('POST', '/api/careers', { token: a.token, body: CAREER })).body.career.id as string;
    const put = await app.call('PUT', '/api/profile', { token: a.token, body: { targetCareerId: id } });
    assert.equal(put.status, 200, JSON.stringify(put.body)); assert.equal(put.body.targetCareerId, id);
    assert.equal((await app.call('GET', '/api/profile', { token: a.token })).body.targetCareerId, id);
  });
  it('rejects another user\'s custom career and an unknown id', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const id = (await app.call('POST', '/api/careers', { token: a.token, body: CAREER })).body.career.id as string;
    const r = await app.call('PUT', '/api/profile', { token: b.token, body: { targetCareerId: id } }); assert.equal(r.status, 400); assert.ok(r.body.error?.fields?.targetCareerId ?? r.body.fields?.targetCareerId ?? JSON.stringify(r.body).includes('Unknown career'));
    assert.equal((await app.call('PUT', '/api/profile', { token: b.token, body: { targetCareerId: 'cx-nope' } })).status, 400);
    assert.equal((await app.call('GET', '/api/profile', { token: b.token })).body.targetCareerId, null);
  });
  it('a deleted custom career is reported as "no target" instead of a dangling id', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    const id = (await app.call('POST', '/api/careers', { token: a.token, body: CAREER })).body.career.id as string;
    await app.call('PUT', '/api/profile', { token: a.token, body: { targetCareerId: id } });
    assert.equal((await app.call('DELETE', `/api/careers/${id}`, { token: a.token })).status, 204);
    assert.equal((await app.call('GET', '/api/profile', { token: a.token })).body.targetCareerId, null);
  });
});

describe('profile details persisted for the authenticated user', () => {
  it('stores stage, experience level, onboarding state and completeness, validated, and isolated per user', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const r = await app.call('PUT', '/api/profile', { token: a.token, body: { stage: 'Early Career', experienceLevel: 'early', onboardingComplete: true, completeness: 70, experienceSummary: 'Two years' } });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.onboardingComplete, true); assert.equal(r.body.experienceLevel, 'early'); assert.equal(r.body.completeness, 70);
    const again = (await app.call('GET', '/api/profile', { token: a.token })).body; assert.equal(again.stage, 'Early Career'); assert.equal(again.experienceSummary, 'Two years');
    const other = (await app.call('GET', '/api/profile', { token: b.token })).body; assert.equal(other.onboardingComplete, false); assert.equal(other.experienceLevel, 'beginner'); assert.equal(other.experienceSummary, null);
    for (const bad of [{ experienceLevel: 'wizard' }, { completeness: 101 }, { completeness: 1.5 }, { onboardingComplete: 'yes' }]) assert.equal((await app.call('PUT', '/api/profile', { token: a.token, body: bad })).status, 400, JSON.stringify(bad));
  });
});

describe('action progress persisted per user and career', () => {
  const put = (app: App, token: string, career: string, key: string, status: string, action: object = ACTION) => app.call('PUT', `/api/careers/${career}/action-progress/${encodeURIComponent(key)}`, { token, body: { status, action } });
  it('requires authentication', async () => {
    const app = makeApp();
    assert.equal((await app.call('GET', '/api/careers/swe/action-progress')).status, 401);
    assert.equal((await app.call('PUT', '/api/careers/swe/action-progress/k', { body: { status: 'completed', action: ACTION } })).status, 401);
    assert.equal((await app.call('GET', '/api/settings')).status, 401);
  });
  it('saves, updates, lists and clears progress for a shared career; "not started" is no row', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    assert.deepEqual((await app.call('GET', '/api/careers/swe/action-progress', { token: a.token })).body.items, []);
    assert.equal((await put(app, a.token, 'swe', 'build:s1', 'in_progress')).status, 200);
    const done = await put(app, a.token, 'swe', 'build:s1', 'completed'); assert.equal(done.body.status, 'completed'); assert.ok(done.body.completedAt);
    const list = (await app.call('GET', '/api/careers/swe/action-progress', { token: a.token })).body.items; assert.equal(list.length, 1); assert.equal(list[0].status, 'completed'); assert.equal(list[0].snapshot.title, 'Raise Legal research');
    assert.equal((await app.call('DELETE', '/api/careers/swe/action-progress/build%3As1', { token: a.token })).status, 204);
    assert.equal((await app.call('DELETE', '/api/careers/swe/action-progress/build%3As1', { token: a.token })).status, 204); // idempotent
    assert.deepEqual((await app.call('GET', '/api/careers/swe/action-progress', { token: a.token })).body.items, []);
  });
  it('works for the user\'s own custom career, and drops snapshot references to skills outside that career', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    const made = (await app.call('POST', '/api/careers', { token: a.token, body: CAREER })).body; const id = made.career.id as string; const sk = made.requirements[0].skillId as string;
    const r = await put(app, a.token, id, 'assess:1', 'in_progress', { ...ACTION, relatedSkillIds: [sk, 'someone-elses-skill'] });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body.snapshot.relatedSkillIds, [sk]);
  });
  it('is isolated: another user cannot read, write or clear it, nor use a custom career they do not own', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const id = (await app.call('POST', '/api/careers', { token: a.token, body: CAREER })).body.career.id as string;
    await put(app, a.token, id, 'k1', 'completed'); await put(app, a.token, 'swe', 'k2', 'in_progress');
    assert.equal((await app.call('GET', `/api/careers/${id}/action-progress`, { token: b.token })).status, 404);
    assert.equal((await put(app, b.token, id, 'k1', 'completed')).status, 404);
    assert.equal((await app.call('DELETE', `/api/careers/${id}/action-progress/k1`, { token: b.token })).status, 404);
    assert.deepEqual((await app.call('GET', '/api/careers/swe/action-progress', { token: b.token })).body.items, []); // same shared career, B sees none of A's
    await app.call('DELETE', '/api/careers/swe/action-progress/k2', { token: b.token });
    assert.equal((await app.call('GET', '/api/careers/swe/action-progress', { token: a.token })).body.items.length, 1); // B's clear did not touch A's row
    assert.equal((await app.call('GET', `/api/careers/${id}/action-progress`, { token: a.token })).body.items.length, 1);
  });
  it('validates input', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    assert.equal((await put(app, a.token, 'swe', 'k', 'not_started')).status, 400); // "not started" is DELETE, never stored
    assert.equal((await put(app, a.token, 'swe', 'k', 'completed', { ...ACTION, phase: 'later' })).status, 400);
    assert.equal((await put(app, a.token, 'swe', 'k', 'completed', { title: 'x' })).status, 400);
    assert.equal((await app.call('PUT', '/api/careers/swe/action-progress/k', { token: a.token, body: { status: 'completed' } })).status, 400);
    assert.equal((await put(app, a.token, 'no-such-career', 'k', 'completed')).status, 404);
    assert.equal((await put(app, a.token, 'swe', "k'; DROP TABLE actions;--", 'completed')).status, 400);
  });
});

describe('user settings persisted per user', () => {
  it('defaults, updates, validates, and isolates', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const d = (await app.call('GET', '/api/settings', { token: a.token })).body; assert.equal(d.reduceMotion, false); assert.equal(d.assistantSuggestions, true);
    const u = await app.call('PUT', '/api/settings', { token: a.token, body: { reduceMotion: true } }); assert.equal(u.status, 200); assert.equal(u.body.reduceMotion, true); assert.equal(u.body.assistantSuggestions, true);
    assert.equal((await app.call('PUT', '/api/settings', { token: a.token, body: { assistantSuggestions: false } })).body.reduceMotion, true); // partial update keeps the other value
    assert.equal((await app.call('GET', '/api/settings', { token: b.token })).body.reduceMotion, false);
    assert.equal((await app.call('PUT', '/api/settings', { token: a.token, body: {} })).status, 400);
    assert.equal((await app.call('PUT', '/api/settings', { token: a.token, body: { reduceMotion: 'yes' } })).status, 400);
  });
});

describe('evidence provenance: user-entered evidence is never presented as verified', () => {
  const EV = { title: 'Case study', description: 'did it', type: 'Project', strength: 'strong', skillIds: [] as string[] };
  it('reports user_provided + unverified, and ignores any client attempt to claim verification', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    for (const extra of [{}, { source: 'verified' }, { verified: true }, { provenance: { verification: { status: 'verified' } } }, { verification: { verifiedBy: 'me', verifiedAt: '2026-01-01', method: 'x' } }]) {
      const r = await app.call('POST', '/api/evidence', { token: a.token, body: { ...EV, ...extra } });
      assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.provenance.origin, 'user_provided'); assert.equal(r.body.provenance.verification.status, 'unverified'); assert.equal(r.body.source, 'user');
      assert.match(r.body.provenance.label, /not independently verified/);
    }
    const id = (await app.call('POST', '/api/evidence', { token: a.token, body: EV })).body.id as string;
    const put = await app.call('PUT', `/api/evidence/${id}`, { token: a.token, body: { ...EV, source: 'verified', verified: true } });
    assert.equal(put.body.provenance.verification.status, 'unverified');
    const list = (await app.call('GET', '/api/evidence', { token: a.token })).body.evidence as { provenance: { verification: { status: string } } }[];
    assert.ok(list.length > 0 && list.every((e) => e.provenance.verification.status === 'unverified'));
  });
  it('provenanceOf only reports verified for a COMPLETE verification record', async () => {
    const { provenanceOf } = await import('../src/domain/provenance');
    assert.equal(provenanceOf({ source: 'user' }).verification.status, 'unverified');
    assert.equal(provenanceOf({ source: 'user', verification: { verifiedBy: '', verifiedAt: '2026-01-01', method: 'x' } }).verification.status, 'unverified');
    assert.equal(provenanceOf({ source: 'user', verification: { verifiedBy: 'Registrar', verifiedAt: 'not a date', method: 'x' } }).verification.status, 'unverified');
    const ok = provenanceOf({ source: 'user', verification: { verifiedBy: 'Registrar', verifiedAt: '2026-01-01', method: 'transcript check' } });
    assert.equal(ok.verification.status, 'verified'); assert.equal(ok.origin, 'user_provided'); assert.match(ok.label, /Registrar/);
    assert.equal(provenanceOf({ source: 'system' }).origin, 'system_derived');
  });
});
