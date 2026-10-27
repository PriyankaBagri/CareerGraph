import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAREER_DATASETS } from '../src/domain/shared';
import { makeApp } from './helpers';

type App = ReturnType<typeof makeApp>;
const reg = async (app: App, email: string) => { const r = await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email, password: 'Passw0rdOK1' } }); assert.equal(r.status, 201, JSON.stringify(r.body)); return { token: r.body.token as string, id: r.body.user.id as string }; };
const SWE = CAREER_DATASETS[0].career, SKILL = SWE.capabilities[0].skills[0].id, SKILL2 = SWE.capabilities[0].skills[1].id;
const EV = { title: 'Built a CLI', description: 'A small tool', type: 'Project', strength: 'moderate', skillIds: [SKILL] };

describe('careers API', () => {
  it('requires authentication', async () => {
    const app = makeApp();
    for (const p of ['/api/careers', `/api/careers/${SWE.id}`, `/api/careers/${SWE.id}/skills`]) assert.equal((await app.call('GET', p)).status, 401);
    assert.equal((await app.call('GET', '/api/careers', { token: 'abc.def.ghi' })).status, 401);
  });
  it('lists the seeded careers (Software Engineer, UX Designer, Financial Analyst)', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const r = await app.call('GET', '/api/careers', { token });
    assert.equal(r.status, 200); assert.equal(r.body.careers.length, CAREER_DATASETS.length);
    const names = r.body.careers.map((c: { name: string }) => c.name).join('|');
    for (const n of ['Software Engineer', 'UX Designer', 'Financial Analyst']) assert.match(names, new RegExp(n));
    assert.deepEqual(Object.keys(r.body.careers[0]).sort(), ['category', 'description', 'id', 'name', 'source']);
  });
  it('returns the full model: capabilities connected to skills through requirements', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const r = await app.call('GET', `/api/careers/${SWE.id}`, { token });
    assert.equal(r.status, 200);
    const { career, capabilities, skills, requirements } = r.body;
    assert.equal(career.id, SWE.id); assert.equal(capabilities.length, SWE.capabilities.length);
    const all = SWE.capabilities.flatMap((c) => c.skills);
    assert.equal(skills.length, all.length); assert.equal(requirements.length, all.length);
    const capIds = new Set(capabilities.map((c: { id: string }) => c.id)), skillIds = new Set(skills.map((s: { id: string }) => s.id));
    for (const q of requirements) { assert.ok(capIds.has(q.capabilityId)); assert.ok(skillIds.has(q.skillId)); assert.equal(q.careerId, SWE.id); assert.ok(q.requiredLevel >= 1 && q.requiredLevel <= 5); assert.ok(q.importance >= 1 && q.importance <= 5); }
    for (const cap of SWE.capabilities) for (const s of cap.skills) { const q = requirements.find((x: { skillId: string }) => x.skillId === s.id); assert.equal(q.capabilityId, cap.id); assert.equal(q.requiredLevel, s.requiredLevel); }
  });
  it('returns career skills with capability and requirement', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const r = await app.call('GET', `/api/careers/${SWE.id}/skills`, { token });
    assert.equal(r.status, 200); assert.equal(r.body.careerId, SWE.id);
    const s = r.body.skills.find((x: { id: string }) => x.id === SKILL);
    assert.equal(s.capabilityId, SWE.capabilities[0].id); assert.equal(s.capabilityName, SWE.capabilities[0].name); assert.ok(s.requiredLevel >= 1);
  });
  it('404s unknown careers and 400s malformed ids', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    for (const p of ['/api/careers/nope', '/api/careers/nope/skills']) { const r = await app.call('GET', p, { token }); assert.equal(r.status, 404); assert.equal(r.body.error.code, 'career_not_found'); }
    assert.equal((await app.call('GET', '/api/careers/bad%20id!', { token })).status, 400);
  });
});

describe('user skills API', () => {
  it('requires authentication', async () => {
    const app = makeApp();
    assert.equal((await app.call('GET', '/api/me/skills')).status, 401);
    assert.equal((await app.call('GET', `/api/me/skills/${SKILL}`)).status, 401);
    assert.equal((await app.call('PUT', `/api/me/skills/${SKILL}`, { body: { level: 2 } })).status, 401);
    assert.equal((await app.call('DELETE', `/api/me/skills/${SKILL}`)).status, 401);
  });
  it('keeps NOT ASSESSED distinct from level 0', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    assert.deepEqual((await app.call('GET', '/api/me/skills', { token })).body.skills, []);
    const un = await app.call('GET', `/api/me/skills/${SKILL}`, { token });
    assert.equal(un.status, 200); assert.equal(un.body.assessed, false); assert.equal(un.body.level, null);
    const zero = await app.call('PUT', `/api/me/skills/${SKILL}`, { token, body: { level: 0 } });
    assert.equal(zero.status, 200); assert.equal(zero.body.assessed, true); assert.equal(zero.body.level, 0);
    assert.equal((await app.call('GET', `/api/me/skills/${SKILL}`, { token })).body.level, 0);
  });
  it('sets, updates, lists and clears own assessments', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    assert.equal((await app.call('PUT', `/api/me/skills/${SKILL}`, { token, body: { level: 2 } })).body.source, 'self');
    await app.call('PUT', `/api/me/skills/${SKILL}`, { token, body: { level: 4 } });
    await app.call('PUT', `/api/me/skills/${SKILL2}`, { token, body: { level: 1 } });
    const list = (await app.call('GET', '/api/me/skills', { token })).body.skills;
    assert.equal(list.length, 2); assert.equal(list.find((s: { skillId: string }) => s.skillId === SKILL).level, 4);
    assert.equal((await app.call('DELETE', `/api/me/skills/${SKILL}`, { token })).status, 204);
    assert.equal((await app.call('GET', `/api/me/skills/${SKILL}`, { token })).body.assessed, false);
    assert.equal((await app.call('DELETE', `/api/me/skills/${SKILL}`, { token })).status, 204); // idempotent
  });
  it('rejects bad levels and unknown skills', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    for (const level of [-1, 6, 2.5, '3', null, undefined]) { const r = await app.call('PUT', `/api/me/skills/${SKILL}`, { token, body: { level } }); assert.equal(r.status, 400, String(level)); assert.ok(r.body.error.fields.level); }
    assert.equal((await app.call('PUT', `/api/me/skills/${SKILL}`, { token, body: [] })).status, 400);
    const r = await app.call('PUT', '/api/me/skills/no:such-skill', { token, body: { level: 2 } });
    assert.equal(r.status, 404); assert.equal(r.body.error.code, 'skill_not_found');
    assert.equal((await app.call('GET', '/api/me/skills/no:such-skill', { token })).status, 404);
    assert.equal((await app.call('GET', '/api/me/skills/a%20b', { token })).status, 400);
  });
  it('isolates users and ignores a client-supplied userId', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    await app.call('PUT', `/api/me/skills/${SKILL}`, { token: a.token, body: { level: 5 } });
    assert.equal((await app.call('GET', `/api/me/skills/${SKILL}`, { token: b.token })).body.assessed, false);
    assert.deepEqual((await app.call('GET', '/api/me/skills', { token: b.token })).body.skills, []);
    await app.call('PUT', `/api/me/skills/${SKILL}`, { token: b.token, body: { level: 1, userId: a.id } });
    assert.equal((await app.call('GET', `/api/me/skills/${SKILL}`, { token: a.token })).body.level, 5);
    assert.equal((await app.call('GET', `/api/me/skills/${SKILL}`, { token: b.token })).body.level, 1);
    await app.call('DELETE', `/api/me/skills/${SKILL}`, { token: b.token });
    assert.equal((await app.call('GET', `/api/me/skills/${SKILL}`, { token: a.token })).body.level, 5);
  });
});

describe('evidence API', () => {
  it('requires authentication on every route', async () => {
    const app = makeApp(); const id = '11111111-1111-4111-8111-111111111111';
    for (const [m, p] of [['GET', '/api/evidence'], ['POST', '/api/evidence'], ['GET', `/api/evidence/${id}`], ['PUT', `/api/evidence/${id}`], ['DELETE', `/api/evidence/${id}`], ['POST', `/api/evidence/${id}/skills/${SKILL}`], ['DELETE', `/api/evidence/${id}/skills/${SKILL}`]])
      assert.equal((await app.call(m, p, { body: EV })).status, 401, `${m} ${p}`);
  });
  it('creates, lists, gets, updates and deletes own evidence', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const c = await app.call('POST', '/api/evidence', { token, body: { ...EV, url: 'https://example.com/x', date: '2025-03-04', organization: 'Acme' } });
    assert.equal(c.status, 201); assert.deepEqual(c.body.skillIds, [SKILL]); assert.equal(c.body.source, 'user'); assert.equal(c.body.url, 'https://example.com/x');
    assert.ok(!('userId' in c.body) && !('user_id' in c.body));
    const id = c.body.id;
    assert.equal((await app.call('GET', '/api/evidence', { token })).body.evidence.length, 1);
    assert.equal((await app.call('GET', `/api/evidence/${id}`, { token })).body.title, 'Built a CLI');
    const u = await app.call('PUT', `/api/evidence/${id}`, { token, body: { title: 'Renamed', strength: 'very_strong', url: null, skillIds: [SKILL, SKILL2] } });
    assert.equal(u.status, 200); assert.equal(u.body.title, 'Renamed'); assert.equal(u.body.strength, 'very_strong'); assert.equal(u.body.url, null); assert.equal(u.body.description, 'A small tool'); assert.equal(u.body.skillIds.length, 2);
    assert.equal((await app.call('DELETE', `/api/evidence/${id}`, { token })).status, 204);
    assert.equal((await app.call('GET', `/api/evidence/${id}`, { token })).status, 404);
    assert.equal((await app.call('DELETE', `/api/evidence/${id}`, { token })).status, 404);
  });
  it('accepts every frontend evidence type and strength', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    for (const type of ['Project', 'Internship', 'Work Experience', 'Certification', 'Course', 'Publication', 'Research', 'Assessment', 'Competition', 'Achievement', 'Volunteer Work', 'Portfolio', 'Case Study', 'Other'])
      assert.equal((await app.call('POST', '/api/evidence', { token, body: { ...EV, type } })).status, 201, type);
    for (const strength of ['weak', 'moderate', 'strong', 'very_strong']) assert.equal((await app.call('POST', '/api/evidence', { token, body: { ...EV, strength } })).status, 201, strength);
  });
  it('returns field-level validation errors', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const bad = async (body: unknown, field: string) => { const r = await app.call('POST', '/api/evidence', { token, body }); assert.equal(r.status, 400, field); assert.ok(r.body.error.fields[field], `${field}: ${JSON.stringify(r.body)}`); };
    await bad({}, 'title'); await bad({ ...EV, title: '  ' }, 'title'); await bad({ ...EV, title: 'x'.repeat(201) }, 'title');
    await bad({ ...EV, description: 'x'.repeat(2001) }, 'description'); await bad({ ...EV, type: 'Hobby' }, 'type'); await bad({ ...EV, strength: 'huge' }, 'strength');
    await bad({ ...EV, url: 'javascript:alert(1)' }, 'url'); await bad({ ...EV, url: 'ftp://x.com' }, 'url'); await bad({ ...EV, date: '2025-02-30' }, 'date'); await bad({ ...EV, date: 'yesterday' }, 'date');
    await bad({ ...EV, skillIds: 'abc' }, 'skillIds'); await bad({ ...EV, skillIds: ['no:such-skill'] }, 'skillIds'); await bad({ ...EV, skillIds: ['bad id!'] }, 'skillIds');
    assert.equal((await app.call('POST', '/api/evidence', { token, body: 'x' })).status, 400);
    assert.equal((await app.call('GET', '/api/evidence/not-a-uuid', { token })).status, 400);
    const ok = await app.call('POST', '/api/evidence', { token, body: EV });
    assert.equal((await app.call('PUT', `/api/evidence/${ok.body.id}`, { token, body: {} })).status, 400);
    assert.equal((await app.call('PUT', `/api/evidence/${ok.body.id}`, { token, body: { type: 'Hobby' } })).status, 400);
    assert.equal((await app.call('GET', '/api/evidence', { token })).body.evidence.length, 1); // failed requests stored nothing
  });
  it('never exposes internals in errors', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const r = await app.call('POST', '/api/evidence', { token, body: { ...EV, type: 'x' } });
    assert.ok(!/SELECT|INSERT|postgres|SECRETPW/i.test(JSON.stringify(r.body)));
  });
  it('isolates users: cross-user read, update and delete all look like 404', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const id = (await app.call('POST', '/api/evidence', { token: a.token, body: EV })).body.id;
    assert.deepEqual((await app.call('GET', '/api/evidence', { token: b.token })).body.evidence, []);
    for (const [m, body] of [['GET', undefined], ['PUT', { title: 'hacked' }], ['DELETE', undefined]] as const) { const r = await app.call(m, `/api/evidence/${id}`, { token: b.token, body }); assert.equal(r.status, 404, m); assert.equal(r.body.error.code, 'evidence_not_found'); }
    const unknown = await app.call('GET', '/api/evidence/22222222-2222-4222-8222-222222222222', { token: b.token });
    const other = (await app.call('GET', `/api/evidence/${id}`, { token: b.token })).body.error; assert.equal(unknown.body.error.code, other.code); assert.equal(unknown.body.error.message, other.message); // indistinguishable
    const mine = (await app.call('GET', `/api/evidence/${id}`, { token: a.token })).body; assert.equal(mine.title, 'Built a CLI');
    // a client-supplied userId in the body is ignored on create
    const c = await app.call('POST', '/api/evidence', { token: b.token, body: { ...EV, userId: a.id } });
    assert.equal((await app.call('GET', `/api/evidence/${c.body.id}`, { token: a.token })).status, 404);
    assert.equal((await app.call('GET', '/api/evidence', { token: a.token })).body.evidence.length, 1);
  });
});

describe('evidence <-> skill links', () => {
  it('links, rejects duplicates, and unlinks', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const id = (await app.call('POST', '/api/evidence', { token, body: { ...EV, skillIds: [] } })).body.id;
    const l = await app.call('POST', `/api/evidence/${id}/skills/${SKILL}`, { token });
    assert.equal(l.status, 201); assert.deepEqual(l.body.skillIds, [SKILL]);
    const dup = await app.call('POST', `/api/evidence/${id}/skills/${SKILL}`, { token });
    assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'conflict');
    assert.deepEqual((await app.call('GET', `/api/evidence/${id}`, { token })).body.skillIds, [SKILL]);
    const u = await app.call('DELETE', `/api/evidence/${id}/skills/${SKILL}`, { token });
    assert.equal(u.status, 200); assert.deepEqual(u.body.skillIds, []);
    assert.equal((await app.call('DELETE', `/api/evidence/${id}/skills/${SKILL}`, { token })).body.error.code, 'link_not_found');
  });
  it('rejects unknown skill, unknown evidence and malformed ids', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const id = (await app.call('POST', '/api/evidence', { token, body: EV })).body.id;
    assert.equal((await app.call('POST', `/api/evidence/${id}/skills/no:such-skill`, { token })).body.error.code, 'skill_not_found');
    assert.equal((await app.call('POST', `/api/evidence/33333333-3333-4333-8333-333333333333/skills/${SKILL}`, { token })).status, 404);
    assert.equal((await app.call('POST', `/api/evidence/nope/skills/${SKILL}`, { token })).status, 400);
    assert.equal((await app.call('POST', `/api/evidence/${id}/skills/bad%20id`, { token })).status, 400);
  });
  it("rejects linking or unlinking another user's evidence", async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const id = (await app.call('POST', '/api/evidence', { token: a.token, body: { ...EV, skillIds: [] } })).body.id;
    assert.equal((await app.call('POST', `/api/evidence/${id}/skills/${SKILL}`, { token: b.token })).status, 404);
    await app.call('POST', `/api/evidence/${id}/skills/${SKILL}`, { token: a.token });
    assert.equal((await app.call('DELETE', `/api/evidence/${id}/skills/${SKILL}`, { token: b.token })).status, 404);
    assert.deepEqual((await app.call('GET', `/api/evidence/${id}`, { token: a.token })).body.skillIds, [SKILL]);
  });
  it('does not dedupe-fail when skillIds repeat on create', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const r = await app.call('POST', '/api/evidence', { token, body: { ...EV, skillIds: [SKILL, SKILL] } });
    assert.equal(r.status, 201); assert.deepEqual(r.body.skillIds, [SKILL]);
  });
});

describe('profile target career (Stage 2 behaviour preserved)', () => {
  it('accepts a listed career and rejects an unknown one', async () => {
    const app = makeApp(); const { token } = await reg(app, 'a@x.com');
    const listed = (await app.call('GET', '/api/careers', { token })).body.careers[0].id;
    assert.equal((await app.call('PUT', '/api/profile', { token, body: { targetCareerId: listed } })).body.targetCareerId, listed);
    const bad = await app.call('PUT', '/api/profile', { token, body: { targetCareerId: 'nope' } });
    assert.equal(bad.status, 400); assert.ok(bad.body.error.fields.targetCareerId);
    assert.equal((await app.call('GET', '/api/profile', { token })).body.targetCareerId, listed);
  });
});
