import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcActions, calcGaps, calcReadiness, type EngineInput } from '../src/domain/readiness';
import { DEFAULT_RULES, parseRules, resolveRules } from '../src/domain/evaluation';
import { makeApp } from './helpers';

const input = (over: Partial<EngineInput> = {}): EngineInput => ({
  careerId: 'c', careerName: 'C',
  skills: [{ skillId: 's1', name: 'S1', capabilityId: 'k', capabilityName: 'K', requiredLevel: 4, importance: 5, position: 0 }, { skillId: 's2', name: 'S2', capabilityId: 'k', capabilityName: 'K', requiredLevel: 2, importance: 2, position: 1 }],
  assessments: { s1: 4, s2: 2 }, evidenceStrengths: { s1: ['strong', 'strong'], s2: ['weak'] }, ...over,
});

describe('evaluation rules: extensible, transparent, and identical to the old formula by default', () => {
  it('no rules = the built-in defaults, reported as such', () => {
    const r = calcReadiness(input());
    assert.equal(r.evaluation.source, 'default'); assert.deepEqual(r.evaluation.rules, DEFAULT_RULES);
    assert.match(r.evaluation.description, /0\.75 \* min\(level\/required, 1\) \+ 0\.25/);
    assert.deepEqual(calcReadiness(input({ rules: null })).score, r.score); assert.deepEqual(calcReadiness(input({ rules: {} })).evaluation.source, 'default');
  });
  it('a career-specific rule changes the result and says so', () => {
    const base = calcReadiness(input({ evidenceStrengths: {} }));
    const custom = calcReadiness(input({ evidenceStrengths: {}, rules: { levelWeight: 0.9 } }));
    assert.equal(base.score, 75); assert.equal(custom.score, 90); // with no evidence only the level share counts
    assert.equal(custom.evaluation.source, 'custom'); assert.equal(custom.evaluation.rules.levelWeight, 0.9); assert.match(custom.evaluation.description, /0\.9 \* min/);
  });
  it('strength points are configurable but never inverted', () => {
    const r = calcReadiness(input({ rules: { strengthPoints: { weak: 2 } } }));
    assert.equal(r.skills.find((s) => s.skillId === 's2')?.evidencePoints, 2);
    assert.ok(parseRules({ strengthPoints: { weak: 5, moderate: 1 } }).errors['evaluationRules.strengthPoints']);
  });
  it('rejects unknown keys, out-of-range values and non-objects; invalid stored data falls back to defaults', () => {
    for (const bad of [{ levelWeight: 0.1 }, { levelWeight: 'x' }, { nope: 1 }, { evidenceThinBelow: 2 }, { strengthPoints: { huge: 1 } }, { strengthPoints: { weak: 1.5 } }, [], 'x'])
      assert.ok(Object.keys(parseRules(bad).errors).length > 0, JSON.stringify(bad));
    assert.equal(resolveRules({ levelWeight: 0.1 }).source, 'default');
  });
  it('a per-skill minimum number of evidence items is a requirement, not a hidden score change', () => {
    const base = input(); const s1 = base.skills[0];
    const withMin = input({ skills: [{ ...s1, minEvidence: 3 }, base.skills[1]] });
    const a = calcReadiness(base), b = calcReadiness(withMin);
    assert.equal(b.score, a.score); // the score does not move
    assert.equal(a.skills[0].evidenceStatus, 'sufficient'); assert.equal(b.skills[0].evidenceStatus, 'thin'); assert.equal(b.skills[0].evidenceRequired, 3);
    const act = calcActions(withMin).find((x) => x.type === 'add_evidence' && x.skillId === 's1');
    assert.ok(act); assert.match(act.reason, /at least 3 evidence item\(s\) and 2 are linked/); assert.match(act.completionCriterion, /At least 3/);
    assert.equal(calcGaps(withMin).below.length, 0);
  });
});

describe('evaluation rules through the API', () => {
  const reg = async (app: ReturnType<typeof makeApp>, email: string) => (await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email, password: 'Passw0rdOK1' } })).body.token as string;
  const CAREER = { name: 'Corporate Lawyer', category: 'Law', description: '', evidenceExpectations: [], capabilities: [{ name: 'Foundations', skills: [{ name: 'Legal research', requiredLevel: 4, importance: 5, minEvidence: 2 }, { name: 'Drafting', requiredLevel: 3 }] }] };
  it('stores rules and minimum evidence with the career, echoes them, and applies them to readiness', async () => {
    const app = makeApp(); const t = await reg(app, 'a@x.com');
    const made = await app.call('POST', '/api/careers', { token: t, body: { ...CAREER, evaluationRules: { levelWeight: 0.9 } } }); assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.deepEqual(made.body.career.evaluationRules, { levelWeight: 0.9 }); assert.equal(made.body.requirements[0].minEvidence, 2); assert.equal(made.body.requirements[1].minEvidence, null);
    const id = made.body.career.id as string, sk = made.body.requirements[0].skillId as string;
    await app.call('PUT', `/api/me/skills/${encodeURIComponent(sk)}`, { token: t, body: { level: 4 } });
    const r = (await app.call('GET', `/api/careers/${id}/readiness`, { token: t })).body; assert.equal(r.evaluation.source, 'custom'); assert.equal(r.evaluation.rules.levelWeight, 0.9);
    assert.equal(r.skills.find((s: { skillId: string }) => s.skillId === sk).evidenceRequired, 2);
    const seeded = (await app.call('GET', '/api/careers/swe/readiness', { token: t })).body; assert.equal(seeded.evaluation.source, 'default');
  });
  it('validates rules and minEvidence on create and update, and edits can clear them', async () => {
    const app = makeApp(); const t = await reg(app, 'a@x.com');
    assert.equal((await app.call('POST', '/api/careers', { token: t, body: { ...CAREER, evaluationRules: { levelWeight: 7 } } })).status, 400);
    assert.equal((await app.call('POST', '/api/careers', { token: t, body: { ...CAREER, evaluationRules: { surprise: true } } })).status, 400);
    const bad = JSON.parse(JSON.stringify(CAREER)); bad.capabilities[0].skills[0].minEvidence = 50;
    assert.equal((await app.call('POST', '/api/careers', { token: t, body: bad })).status, 400);
    const made = (await app.call('POST', '/api/careers', { token: t, body: { ...CAREER, evaluationRules: { levelWeight: 0.9 } } })).body;
    const put = await app.call('PUT', `/api/careers/${made.career.id}`, { token: t, body: CAREER }); assert.equal(put.status, 200);
    assert.equal(put.body.career.evaluationRules, null);
  });
  it('rules are per career and owner-only: another user cannot set or read them, seeded careers cannot be given rules', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const made = (await app.call('POST', '/api/careers', { token: a, body: { ...CAREER, evaluationRules: { levelWeight: 0.9 } } })).body;
    assert.equal((await app.call('PUT', `/api/careers/${made.career.id}`, { token: b, body: CAREER })).status, 404);
    assert.equal((await app.call('GET', `/api/careers/${made.career.id}/readiness`, { token: b })).status, 404);
    assert.equal((await app.call('PUT', '/api/careers/swe', { token: a, body: { ...CAREER, evaluationRules: { levelWeight: 0.9 } } })).status, 404);
  });
});

describe('regression: description is optional (the editor sends an empty string)', () => {
  it('creates and edits a career with an empty or omitted description', async () => {
    const app = makeApp(); const t = (await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email: 'd@x.com', password: 'Passw0rdOK1' } })).body.token as string;
    const caps = [{ name: 'Foundations', skills: [{ name: 'Research', requiredLevel: 3 }] }];
    const a = await app.call('POST', '/api/careers', { token: t, body: { name: 'Archivist', category: 'Heritage', description: '', evidenceExpectations: [], capabilities: caps } });
    assert.equal(a.status, 201, JSON.stringify(a.body)); assert.equal(a.body.career.description, '');
    const b = await app.call('POST', '/api/careers', { token: t, body: { name: 'Curator', category: 'Heritage', capabilities: caps } }); assert.equal(b.status, 201, JSON.stringify(b.body));
    assert.equal((await app.call('PUT', `/api/careers/${a.body.career.id}`, { token: t, body: { name: 'Archivist', category: 'Heritage', description: '', capabilities: caps } })).status, 200);
    assert.equal((await app.call('POST', '/api/careers', { token: t, body: { name: 'X', category: 'Y', description: 'z'.repeat(1001), capabilities: caps } })).status, 400);
  });
});

describe('regression: the editor payload (empty optional fields) is accepted end to end', () => {
  it('create and update succeed with an empty or omitted career/capability description and no expectations', async () => {
    const app = makeApp();
    const t = (await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email: 'e@x.com', password: 'Passw0rdOK1' } })).body.token as string;
    const base = { name: 'Corporate Lawyer', category: 'Law', evidenceExpectations: [], capabilities: [{ name: 'Foundations', description: '', skills: [{ name: 'Legal research', requiredLevel: 4, importance: 3, minEvidence: null }] }] };
    for (const description of ['', undefined]) {
      const r = await app.call('POST', '/api/careers', { token: t, body: { ...base, ...(description === undefined ? {} : { description }) } });
      assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.career.description, '');
      assert.equal((await app.call('PUT', `/api/careers/${r.body.career.id}`, { token: t, body: { ...base, description: '' } })).status, 200);
    }
  });
  it('whitespace-only name/category and over-long description are still rejected', async () => {
    const app = makeApp();
    const t = (await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email: 'f@x.com', password: 'Passw0rdOK1' } })).body.token as string;
    const ok = { name: 'X Career', category: 'Law', description: '', evidenceExpectations: [], capabilities: [{ name: 'A', skills: [{ name: 'B', requiredLevel: 3 }] }] };
    for (const bad of [{ name: '   ' }, { category: '' }, { description: 'x'.repeat(1001) }]) assert.equal((await app.call('POST', '/api/careers', { token: t, body: { ...ok, ...bad } })).status, 400, JSON.stringify(bad).slice(0, 40));
  });
});
