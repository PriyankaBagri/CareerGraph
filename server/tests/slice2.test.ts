import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AiProvider, AiRequest } from '../src/ai/provider';
import { NO_AI } from '../src/config';
import { calcActions, PRIORITY_CRITERIA, type EngineInput } from '../src/domain/readiness';
import { makeApp } from './helpers';

class FakeAi implements AiProvider { // TEST DOUBLE
  readonly id = 'fake'; readonly label = 'Fake (tests only)'; readonly model = 'f1'; calls: AiRequest[] = [];
  async complete(r: AiRequest) { this.calls.push(r); return { text: 'ok' }; }
}
type App = ReturnType<typeof makeApp>;
const reg = async (app: App, email: string) => (await app.call('POST', '/api/auth/register', { body: { name: 'T', email, password: 'Passw0rdOK1' } })).body as { token: string };
const CAREER = (name: string, expectations: string[]) => ({ name, category: 'Law', description: '', evidenceExpectations: expectations, capabilities: [{ name: 'Foundations', skills: [{ name: 'Legal research', requiredLevel: 4, importance: 5, minEvidence: 2 }, { name: 'Drafting', requiredLevel: 3, importance: 2 }] }] });
const create = async (app: App, token: string, name = 'Corporate Lawyer', ex: string[] = ['A drafted agreement', 'A moot court record']) => { const r = await app.call('POST', '/api/careers', { token, body: CAREER(name, ex) }); assert.equal(r.status, 201, JSON.stringify(r.body)); return { id: r.body.career.id as string, skills: (r.body.requirements as { skillId: string }[]).map((x) => x.skillId) }; };

describe('GET /api/careers/:id/actions: ranking rule and evidence expectations', () => {
  it('returns the ranking rule and THIS career\'s own evidence expectations, cleaned', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    const c = await create(app, a.token, 'Corporate Lawyer', ['A drafted agreement', 'Moot\u0000 court\nrecord']);
    const r = await app.call('GET', `/api/careers/${c.id}/actions`, { token: a.token });
    assert.equal(r.status, 200); assert.equal(r.body.priorityCriteria, PRIORITY_CRITERIA);
    assert.deepEqual(r.body.evidenceExpectations, ['A drafted agreement', 'Moot  court record']);
    assert.ok(r.body.actions.length > 0 && r.body.actions.every((x: any) => x.completionCriterion && x.rank >= 1)); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it('ISOLATION: another user gets 404 for my custom career and learns none of its expectations', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const c = await create(app, a.token, 'A-PRIVATE', ['A-PRIVATE-EXPECTATION']);
    const r = await app.call('GET', `/api/careers/${c.id}/actions`, { token: b.token });
    assert.equal(r.status, 404); assert.ok(!JSON.stringify(r.body).includes('A-PRIVATE'));
    assert.equal((await app.call('GET', `/api/careers/${c.id}/actions`)).status, 401);
  });
  it('the published ranking rule matches the real scores (guards against the text drifting from calcActions)', () => {
    const input: EngineInput = { careerId: 'x', careerName: 'X', rules: undefined, assessments: { below: 1, meets: 4 }, evidenceStrengths: { meets: ['weak'] },
      skills: [
        { skillId: 'below', name: 'B', capabilityId: 'c', capabilityName: 'C', requiredLevel: 4, importance: 5, position: 1 },
        { skillId: 'un4', name: 'U4', capabilityId: 'c', capabilityName: 'C', requiredLevel: 4, importance: 3, position: 2 },
        { skillId: 'un2', name: 'U2', capabilityId: 'c', capabilityName: 'C', requiredLevel: 2, importance: 3, position: 3 },
        { skillId: 'meets', name: 'M', capabilityId: 'c', capabilityName: 'C', requiredLevel: 4, importance: 4, position: 4 }] };
    const by = Object.fromEntries(calcActions(input, 10).map((a) => [a.skillId, a]));
    assert.equal(by.below.priorityScore, 2 * 3 * 5); assert.equal(by.below.priority, 'high');           // 2 x gap x importance; gap 3
    assert.equal(by.un4.priorityScore, 3 + 1); assert.equal(by.un2.priorityScore, 3);                      // importance (+1 when required level >= 4)
    assert.equal(by.un4.priority, 'medium'); assert.equal(by.meets.priority, 'low');
    assert.ok(by.meets.priorityScore > 0 && by.meets.priorityScore <= 0.5 * 4);                           // 0.5 x importance x (1 - evidence credit)
    for (const phrase of ['2 x gap x importance', 'plus 1 when the required level is 4 or higher', '0.5 x importance x (1 - evidence credit)', 'Ties are broken by skill id']) assert.ok(PRIORITY_CRITERIA.includes(phrase), phrase);
    const order = Object.values(by).sort((x, y) => x.rank - y.rank).map((a) => a.skillId); assert.equal(order[0], 'below');
  });
});

describe('assistant grounding includes the engine\'s own explanation numbers (and only the caller\'s)', () => {
  const withAi = () => { const ai = new FakeAi(); const app = makeApp({ aiProvider: ai, config: { ai: { ...NO_AI, provider: 'anthropic', apiKey: 'k', model: 'm', ratePerMinute: 20 } } }); return { ai, app }; };
  const ctxOf = (r: AiRequest) => JSON.parse(/<career_data>\n([\s\S]*)\n<\/career_data>/.exec(r.system)![1]);
  it('sends per-skill scores, completion criteria, the ranking rule and evidence expectations, taken from the server', async () => {
    const { ai, app } = withAi(); const a = await reg(app, 'a@x.com'); const c = await create(app, a.token);
    await app.call('PUT', `/api/me/skills/${encodeURIComponent(c.skills[0])}`, { token: a.token, body: { level: 3 } });
    await app.call('POST', '/api/evidence', { token: a.token, body: { title: 'Memo', description: 'd', type: 'Project', strength: 'strong', skillIds: [c.skills[0]] } });
    const r = await app.call('POST', '/api/assistant/chat', { token: a.token, body: { careerId: c.id, messages: [{ role: 'user', content: 'Why is Legal research rated like this?' }] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = ctxOf(ai.calls[0]); const sk = d.skills.find((s: any) => s.name === 'Legal research'); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(sk.currentLevel, 3); assert.equal(sk.levelRatio, 0.75); assert.equal(sk.evidencePoints, 3); assert.equal(sk.evidenceRequired, 2); assert.equal(sk.evidenceStatus, 'thin');
    assert.ok(typeof sk.skillScore === 'number' && typeof sk.contribution === 'number');
    assert.ok(d.readiness.formula.includes('score = 100')); assert.equal(d.priorityCriteria, PRIORITY_CRITERIA);
    assert.deepEqual(d.evidenceExpectations, ['A drafted agreement', 'A moot court record']);
    assert.ok(d.topActions.every((x: any) => x.completionCriterion && typeof x.priorityScore === 'number')); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.match(ai.calls[0].system, /use ONLY the figures in career_data/);
  });
  it('another user\'s expectations and scores never reach my prompt', async () => {
    const { ai, app } = withAi(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    await create(app, a.token, 'A-PRIVATE', ['A-PRIVATE-EXPECTATION']);
    await app.call('POST', '/api/assistant/chat', { token: b.token, body: { careerId: 'swe', messages: [{ role: 'user', content: 'hi' }] } });
    assert.ok(!ai.calls[0].system.includes('A-PRIVATE'));
  });
});
