import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { kindFor, splitSkillText } from '../src/domain/guidance';
import { makeApp } from './helpers';

type App = ReturnType<typeof makeApp>;
interface G { kind: string; kindLabel: string; title: string; whyItMatters: string; whyNow: string; outcome: string; steps: string[]; prerequisites: string[]; effort: { text: string; isEstimate: boolean; basis: string }; resources: { note: string; searchTerms: string[] }; definitionOfDone: string[]; evidenceToSubmit: string; ratingNote: string; basis: string }
interface A { id: string; type: string; skillId: string; skillName: string; priority: string; reason: string; guidance: G }
const reg = async (app: App, email: string) => (await app.call('POST', '/api/auth/register', { body: { name: 'T', email, password: 'Passw0rdOK1' } })).body as { token: string };
const sk = (name: string, requiredLevel: number, description = '') => ({ name, requiredLevel, importance: 4, description });
const CAREER = {
  name: 'Data Analyst', category: 'Data', description: 'd', evidenceExpectations: ['A small analysis you published'],
  capabilities: [{ name: 'Querying', description: 'c', skills: [
    sk('Writing queries', 4, 'Asking a database questions.\n\nEvidence to show: A repository with five working queries'), sk('Cleaning data', 4), sk('Basic statistics', 3), sk('Reading charts', 2), sk('Unrated thing', 3)] }],
};
async function setup(app: App) {
  const { token } = await reg(app, 'a@example.com');
  const m = (await app.call('POST', '/api/careers', { token, body: CAREER })).body as { career: { id: string }; skills: { id: string; name: string }[] };
  const id = (n: string) => m.skills.find((s) => s.name === n)?.id as string;
  const rate = (n: string, level: number) => app.call('PUT', `/api/me/skills/${encodeURIComponent(id(n))}`, { token, body: { level } });
  await rate('Writing queries', 2); await rate('Cleaning data', 3); await rate('Basic statistics', 0); await rate('Reading charts', 2); // 'Unrated thing' stays unrated
  return { token, careerId: m.career.id, id, rate };
}
const actions = async (app: App, token: string, careerId: string) => ((await app.call('GET', `/api/careers/${careerId}/actions?limit=10`, { token })).body as { actions: A[] }).actions;

describe('action guidance is complete, honest and tied to the real gap', () => {
  it('every action carries the full guidance structure', async () => {
    const app = makeApp(); const { token, careerId } = await setup(app); const acts = await actions(app, token, careerId); assert.ok(acts.length >= 4);
    for (const a of acts) {
      const g = a.guidance;
      assert.ok(g.title.length > 5 && g.whyItMatters.length > 20 && g.whyNow.length > 20 && g.outcome.length > 10, a.id);
      assert.ok(g.steps.length >= 3 && g.steps.every((s) => s.length > 8), a.id);
      assert.ok(g.prerequisites.length >= 1 && g.definitionOfDone.length >= 1 && g.evidenceToSubmit.length > 10 && g.ratingNote.length > 20, a.id);
      assert.match(g.basis, /Template guidance/); assert.match(g.basis, /not verified/);
      assert.equal(g.effort.isEstimate, true); assert.match(g.effort.basis, /estimate/i); assert.ok(g.effort.text.length > 3);
      assert.ok(g.title.includes(a.skillName), `title names the skill: ${g.title}`);
      assert.ok(g.whyItMatters.includes('Data Analyst'));
    }
  });
  it('is not a vague label: titles/steps differ per skill and the plain "Learn SQL" style never appears', async () => {
    const app = makeApp(); const { token, careerId } = await setup(app); const acts = await actions(app, token, careerId);
    assert.equal(new Set(acts.map((a) => a.guidance.title)).size, acts.length);
    for (const a of acts) assert.ok(!/^(Improve|Learn|Build projects)\b[^]{0,15}$/i.test(a.guidance.title));
  });
  it('picks the task size from the CURRENT level: basics first, a portfolio project only once the student is already at working level', async () => {
    const app = makeApp(); const { token, careerId, id } = await setup(app); const by = (n: string) => actions(app, token, careerId).then((l) => l.find((a) => a.skillId === id(n)));
    assert.equal((await by('Basic statistics'))?.guidance.kind, 'foundation'); // rated 0, needs 3
    assert.equal((await by('Writing queries'))?.guidance.kind, 'practice'); // rated 2, next level 3
    assert.equal((await by('Cleaning data'))?.guidance.kind, 'portfolio'); // rated 3, next level 4
    assert.deepEqual(['foundation', 'practice', 'portfolio', 'assess', 'evidence'].length, 5);
    assert.equal(kindFor({ type: 'build_skill', currentLevel: 0, targetLevel: 5 }), 'foundation'); assert.equal(kindFor({ type: 'build_skill', currentLevel: 1, targetLevel: 5 }), 'foundation');
    assert.equal(kindFor({ type: 'build_skill', currentLevel: 4, targetLevel: 5 }), 'portfolio');
  });
  it('an unrated skill gets a self-check, never a gap-closing plan, and is not treated as zero', async () => {
    const app = makeApp(); const { token, careerId, id } = await setup(app); const acts = await actions(app, token, careerId);
    const mine = acts.filter((a) => a.skillId === id('Unrated thing')); assert.deepEqual(mine.map((a) => a.type), ['assess_skill']);
    assert.equal(mine[0].guidance.kind, 'assess'); assert.match(mine[0].guidance.whyNow, /does not know/); assert.ok(!/gap of/.test(mine[0].guidance.whyNow));
    // rated 0 is a real rating and IS a gap; unrated is not
    assert.equal(acts.find((a) => a.skillId === id('Basic statistics'))?.type, 'build_skill');
    const gaps = (await app.call('GET', `/api/careers/${careerId}/gaps`, { token })).body as { below: { skillId: string }[]; unassessed: { skillId: string }[] };
    assert.ok(gaps.unassessed.some((s) => s.skillId === id('Unrated thing'))); assert.ok(!gaps.below.some((s) => s.skillId === id('Unrated thing')));
  });
  it('the explanation matches the real numbers for the skill (levels, gap, priority)', async () => {
    const app = makeApp(); const { token, careerId, id } = await setup(app); const a = (await actions(app, token, careerId)).find((x) => x.skillId === id('Writing queries')) as A;
    assert.match(a.guidance.whyNow, /Basic \(2\)/); assert.match(a.guidance.whyNow, /Advanced \(4\)/); assert.match(a.guidance.whyNow, /gap of 2/); assert.match(a.guidance.whyItMatters, /“Querying”/);
  });
  it("uses the skill's own description and evidence note, and falls back to the career's evidence expectations", async () => {
    const app = makeApp(); const { token, careerId, id } = await setup(app); const acts = await actions(app, token, careerId);
    const q = acts.find((x) => x.skillId === id('Writing queries')) as A; assert.match(q.guidance.whyItMatters, /Asking a database questions\./);
    assert.match(q.guidance.evidenceToSubmit, /A repository with five working queries/); assert.ok(!q.guidance.whyItMatters.includes('Evidence to show'));
    const c = acts.find((x) => x.skillId === id('Cleaning data')) as A; assert.match(c.guidance.evidenceToSubmit, /A small analysis you published/);
  });
  it('invents no links, certifications or salaries; effort is labelled an estimate; resources are search hints only', async () => {
    const app = makeApp(); const { token, careerId } = await setup(app); const text = JSON.stringify(await actions(app, token, careerId));
    assert.ok(!/https?:\/\//.test(text)); assert.ok(!/certif|salary|\$\d|guarantee/i.test(text.replace(/certificate is usually weaker/g, '')));
    for (const a of await actions(app, token, careerId)) { assert.match(a.guidance.resources.note, /No links are included/); assert.ok(a.guidance.resources.searchTerms.length >= 1); }
  });
  it('seeded careers with no skill descriptions still get complete guidance', async () => {
    const app = makeApp(); const { token } = await reg(app, 'b@example.com');
    const list = (await app.call('GET', '/api/careers', { token })).body as { careers: { id: string }[] }; const acts = await actions(app, token, list.careers[0].id);
    assert.ok(acts.length > 0); for (const a of acts) assert.ok(a.guidance.steps.length >= 3 && a.guidance.definitionOfDone.length >= 1);
  });
  it('splitSkillText separates the plain description from the evidence note', () => {
    assert.deepEqual(splitSkillText('Plain.\n\nEvidence to show: A thing'), { description: 'Plain.', evidenceNote: 'A thing' });
    assert.deepEqual(splitSkillText('Only text'), { description: 'Only text', evidenceNote: '' });
  });
});

describe('completing an action: persistence, honesty and isolation', () => {
  const ACTION = { title: 'T', description: 'D', type: 'skill', phase: 'foundation', priority: 'high', priorityScore: 10, impact: 'high', effort: 'medium', estimatedTime: '', reason: 'R', prerequisites: [], relatedSkillIds: [], relatedCapabilityIds: [] };
  it('persists across reloads, never changes ratings or readiness, and keeps the action (the gap is still real)', async () => {
    const app = makeApp(); const { token, careerId } = await setup(app); const [first] = await actions(app, token, careerId);
    const snap = async () => JSON.stringify([(await app.call('GET', '/api/me/skills', { token })).body, (await app.call('GET', `/api/careers/${careerId}/readiness`, { token })).body]);
    const before = await snap();
    const put = await app.call('PUT', `/api/careers/${careerId}/action-progress/${encodeURIComponent(first.id)}`, { token, body: { status: 'completed', action: { ...ACTION, relatedSkillIds: [first.skillId] } } }); assert.equal(put.status, 200);
    assert.equal(await snap(), before); // completion is a statement, not a rating or a score
    const reload = (await app.call('GET', `/api/careers/${careerId}/action-progress`, { token })).body as { items: { actionKey: string; status: string }[] };
    const rows = reload.items; assert.ok(rows.some((r) => r.actionKey === first.id && r.status === 'completed'));
    const road = (await app.call('GET', `/api/careers/${careerId}/actions`, { token })).body as { actions: (A & { status: string })[] };
    const again = road.actions.find((a) => a.id === first.id); assert.equal(again?.status, 'completed'); assert.ok(again?.guidance.steps.length);
  });
  it('another user cannot read guidance, progress or readiness for this career, and cannot save progress on it', async () => {
    const app = makeApp(); const { careerId, token: a } = await setup(app); const b = (await reg(app, 'b@example.com')).token; const [first] = await actions(app, a, careerId);
    for (const path of ["actions", "readiness", 'gaps', 'action-progress']) assert.equal((await app.call('GET', `/api/careers/${careerId}/${path}`, { token: b })).status, 404, path);
    assert.equal((await app.call('PUT', `/api/careers/${careerId}/action-progress/${encodeURIComponent(first.id)}`, { token: b, body: { status: 'completed', action: ACTION } })).status, 404);
    assert.equal((await app.call('GET', `/api/careers/${careerId}/actions`)).status, 401);
  });
});
