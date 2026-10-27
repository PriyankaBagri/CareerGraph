import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeApp } from './helpers';

type App = ReturnType<typeof makeApp>;
const reg = async (app: App, email: string) => { const r = await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email, password: 'Passw0rdOK1' } }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body as { token: string }; };
const LAW = {
  name: 'Corporate Lawyer', category: 'Law', description: 'Advising companies', evidenceExpectations: ['Drafted agreement', 'Moot court'],
  capabilities: [
    { name: 'Legal Foundations', description: 'Core knowledge', skills: [{ name: 'Legal research', requiredLevel: 4, importance: 5 }, { name: 'Contract drafting', requiredLevel: 4 }] },
    { name: 'Practice', skills: [{ name: 'Negotiation', requiredLevel: 3 }] },
  ],
};
const skillIds = (b: { requirements: { skillId: string }[] }) => b.requirements.map((r) => r.skillId);

describe('custom careers (any profession through the same model)', () => {
  it('creates, lists and loads a career for its owner only, using the shared Career -> Capability -> Skill model', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const made = await app.call('POST', '/api/careers', { token: a.token, body: LAW }); assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = made.body.career.id as string; assert.match(id, /^cx-/); assert.equal(made.body.career.source, 'custom');
    assert.equal(made.body.capabilities.length, 2); assert.equal(made.body.requirements.length, 3); assert.ok(skillIds(made.body as never).every((s) => s.startsWith(`${id}:`)));
    assert.ok(made.body.requirements.some((r: { importance: number }) => r.importance === 5) && made.body.requirements.some((r: { importance: number }) => r.importance === 3));
    assert.ok((await app.call('GET', '/api/careers', { token: a.token })).body.careers.some((c: { id: string }) => c.id === id));
    assert.ok(!(await app.call('GET', '/api/careers', { token: b.token })).body.careers.some((c: { id: string }) => c.id === id));
    assert.equal((await app.call('GET', `/api/careers/${id}`, { token: b.token })).status, 404);
  });
  it('the readiness, gaps and actions engine works on a custom career, and unassessed stays unassessed', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    const id = (await app.call('POST', '/api/careers', { token: a.token, body: LAW })).body.career.id as string;
    const r0 = await app.call('GET', `/api/careers/${id}/readiness`, { token: a.token }); assert.equal(r0.status, 200); assert.equal(r0.body.state, 'not_assessed'); assert.equal(r0.body.score, null);
    const first = (await app.call('GET', `/api/careers/${id}`, { token: a.token })).body.requirements[0].skillId as string;
    assert.equal((await app.call('PUT', `/api/me/skills/${encodeURIComponent(first)}`, { token: a.token, body: { level: 2 } })).status, 200);
    const gaps = await app.call('GET', `/api/careers/${id}/gaps`, { token: a.token }); assert.equal(gaps.body.below.length, 1); assert.equal(gaps.body.unassessed.length, 2);
    assert.ok((await app.call('GET', `/api/careers/${id}/actions`, { token: a.token })).body.actions.length > 0);
  });
  it('another user cannot rate, link evidence to, read the analysis of, edit or delete someone else\'s career', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const made = (await app.call('POST', '/api/careers', { token: a.token, body: LAW })).body; const id = made.career.id as string; const sk = made.requirements[0].skillId as string;
    assert.equal((await app.call('PUT', `/api/me/skills/${encodeURIComponent(sk)}`, { token: b.token, body: { level: 3 } })).status, 404);
    assert.equal((await app.call('POST', '/api/evidence', { token: b.token, body: { title: 't', description: 'd', type: 'Project', strength: 'weak', skillIds: [sk] } })).status, 400);
    for (const p of ['readiness', 'gaps', 'actions']) assert.equal((await app.call('GET', `/api/careers/${id}/${p}`, { token: b.token })).status, 404);
    assert.equal((await app.call('PUT', `/api/careers/${id}`, { token: b.token, body: LAW })).status, 404);
    assert.equal((await app.call('DELETE', `/api/careers/${id}`, { token: b.token })).status, 404);
    assert.equal((await app.call('GET', `/api/careers/${id}`, { token: a.token })).status, 200); // untouched
  });
  it('seeded careers cannot be edited or deleted by anyone', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'); const seeded = (await app.call('GET', '/api/careers', { token: a.token })).body.careers.find((c: { source: string }) => c.source === 'seed').id;
    assert.equal((await app.call('PUT', `/api/careers/${seeded}`, { token: a.token, body: LAW })).status, 404); assert.equal((await app.call('DELETE', `/api/careers/${seeded}`, { token: a.token })).status, 404);
  });
  it('editing keeps ratings and evidence links for kept skills, drops removed skills, and refuses foreign ids', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    const m = (await app.call('POST', '/api/careers', { token: a.token, body: LAW })).body; const id = m.career.id as string;
    const [s1, s2] = [m.requirements[0].skillId, m.requirements[1].skillId] as string[];
    await app.call('PUT', `/api/me/skills/${encodeURIComponent(s1)}`, { token: a.token, body: { level: 4 } }); await app.call('PUT', `/api/me/skills/${encodeURIComponent(s2)}`, { token: a.token, body: { level: 1 } });
    const ev = await app.call('POST', '/api/evidence', { token: a.token, body: { title: 'Memo', description: 'd', type: 'Project', strength: 'strong', skillIds: [s1, s2] } }); assert.equal(ev.status, 201);
    const cap0 = m.capabilities[0];
    const edit = { ...LAW, name: 'Corporate Counsel', capabilities: [{ id: cap0.id, name: 'Legal Foundations', skills: [{ id: s1, name: 'Legal research (renamed)', requiredLevel: 5 }] }, { name: 'New area', skills: [{ name: 'Brand new skill', requiredLevel: 2 }] }] };
    const upd = await app.call('PUT', `/api/careers/${id}`, { token: a.token, body: edit }); assert.equal(upd.status, 200, JSON.stringify(upd.body));
    assert.equal(upd.body.career.name, 'Corporate Counsel'); const ids = skillIds(upd.body as never); assert.ok(ids.includes(s1) && !ids.includes(s2) && ids.length === 2);
    const mine = (await app.call('GET', '/api/me/skills', { token: a.token })).body.skills as { skillId: string }[]; assert.deepEqual(mine.map((x) => x.skillId), [s1]); // s2's rating went with the skill
    const evAfter = (await app.call('GET', `/api/evidence/${ev.body.id}`, { token: a.token })).body; assert.deepEqual(evAfter.skillIds, [s1]); // evidence itself kept
    const foreign = { ...edit, capabilities: [{ name: 'X', skills: [{ id: 'swe:testing', name: 'hijack', requiredLevel: 2 }] }] };
    assert.equal((await app.call('PUT', `/api/careers/${id}`, { token: a.token, body: foreign })).status, 400);
  });
  it('deleting removes the career, its skills, ratings and links, but keeps the user\'s evidence', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    const m = (await app.call('POST', '/api/careers', { token: a.token, body: LAW })).body; const id = m.career.id as string; const s1 = m.requirements[0].skillId as string;
    await app.call('PUT', `/api/me/skills/${encodeURIComponent(s1)}`, { token: a.token, body: { level: 3 } });
    const ev = (await app.call('POST', '/api/evidence', { token: a.token, body: { title: 'Memo', description: 'd', type: 'Project', strength: 'strong', skillIds: [s1] } })).body;
    assert.equal((await app.call('DELETE', `/api/careers/${id}`, { token: a.token })).status, 204); assert.equal((await app.call('GET', `/api/careers/${id}`, { token: a.token })).status, 404);
    assert.equal((await app.call('GET', '/api/me/skills', { token: a.token })).body.skills.length, 0);
    const kept = await app.call('GET', `/api/evidence/${ev.id}`, { token: a.token }); assert.equal(kept.status, 200); assert.deepEqual(kept.body.skillIds, []);
    assert.equal((await app.call('DELETE', `/api/careers/${id}`, { token: a.token })).status, 404); // second delete: nothing left
  });
  it('validates input: structure, limits, levels, and requires authentication', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'); const bad = (body: unknown) => app.call('POST', '/api/careers', { token: a.token, body });
    assert.equal((await app.call('POST', '/api/careers', { body: LAW })).status, 401);
    for (const body of [{}, { ...LAW, name: '' }, { ...LAW, capabilities: [] }, { ...LAW, capabilities: [{ name: 'c', skills: [] }] }, { ...LAW, capabilities: [{ name: 'c', skills: [{ name: 's', requiredLevel: 9 }] }] }, { ...LAW, capabilities: [{ name: 'c', skills: [{ name: 's', requiredLevel: 2, importance: 0 }] }] }, { ...LAW, evidenceExpectations: 'x' }, { ...LAW, capabilities: Array.from({ length: 13 }, () => ({ name: 'c', skills: [{ name: 's', requiredLevel: 2 }] })) }]) {
      const r = await bad(body); assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80)); assert.ok(r.body.error);
    }
    const r = await bad({ ...LAW, id: 'swe', userId: 'someone-else', source: 'seed' }); assert.equal(r.status, 201); assert.match(r.body.career.id, /^cx-/); assert.equal(r.body.career.source, 'custom'); // client-supplied id/owner/source are ignored
  });
});

import { readFileSync } from 'node:fs';
describe('PostgreSQL visibility rule (static check; behavior verified separately against a real PostgreSQL)', () => {
  it('only seeded careers or the owner\'s own careers are visible; an ownerless custom career is visible to nobody', () => {
    const src = readFileSync(new URL('../src/repositories/pg-core.ts', import.meta.url), 'utf8');
    assert.match(src, /const VISIBLE = `\(c\.source = 'seed' OR EXISTS \(SELECT 1 FROM custom_careers cc WHERE cc\.career_id = c\.id AND cc\.user_id = \$1\)\)`/);
    assert.doesNotMatch(src, /NOT EXISTS \(SELECT 1 FROM custom_careers cc WHERE cc\.career_id = c\.id\) OR/);
  });
});
