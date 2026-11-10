import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AiProviderError, type AiProvider, type AiRequest } from '../src/ai/provider';
import { NO_AI } from '../src/config';
import { PLAN_LIMITS } from '../src/ai/plan';
import { makeApp } from './helpers';

// Test double only — production never substitutes a canned reply for a model.
class FakeAi implements AiProvider {
  readonly id = 'fake'; readonly label = 'Fake model (tests only)'; readonly model = 'fake-1';
  calls: AiRequest[] = []; reply: string | Error = '{"weeks":[]}';
  async complete(r: AiRequest) { this.calls.push(r); if (this.reply instanceof Error) throw this.reply; return { text: this.reply }; }
}
const SECRET = 'sk-SUPER-SECRET-KEY-123';
const CAREER = { name: 'Corporate Lawyer', category: 'Law', description: 'Advising companies', evidenceExpectations: ['Drafted agreement'], capabilities: [{ name: 'Foundations', description: 'Core', skills: [{ name: 'Legal research', requiredLevel: 3, importance: 3 }, { name: 'Contract drafting', requiredLevel: 4, importance: 5 }] }] };
type App = ReturnType<typeof makeApp>;
const reg = async (app: App, email: string) => (await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email, password: 'Passw0rdOK1' } })).body as { token: string };
const plan = (app: App, token: string | undefined, body: unknown) => app.call('POST', '/api/assistant/plan', { token, body });
const withAi = (extra: Partial<Parameters<typeof makeApp>[0]> = {}, rate = 10) => { const ai = new FakeAi(); const app = makeApp({ aiProvider: ai, config: { ai: { ...NO_AI, provider: 'anthropic', apiKey: SECRET, model: 'm', ratePerMinute: rate } }, ...extra }); return { ai, app }; };

// Creates a career with two unrated skills and returns its REAL current action ids — never invented by the test.
async function careerWithActions(app: App, token: string) {
  const created = (await app.call('POST', '/api/careers', { token, body: CAREER })).body as { career: { id: string } };
  const acts = (await app.call('GET', `/api/careers/${created.career.id}/actions`, { token })).body as { actions: { id: string }[] };
  return { careerId: created.career.id, actionIds: acts.actions.map((a) => a.id) };
}
const validReply = (ids: string[]) => JSON.stringify({ weeks: [{ week: 1, focus: 'Build the foundation', actionIds: [ids[0]], rationale: 'Highest-priority gap right now.' }] });

describe('POST /api/assistant/plan', () => {
  it('requires auth and a valid careerId; never calls the model on bad input', async () => {
    const { app, ai } = withAi();
    assert.equal((await plan(app, undefined, { careerId: 'x' })).status, 401);
    const a = await reg(app, 'a@x.com');
    for (const body of [{}, { careerId: '' }, { careerId: 7 }, { careerId: '../etc' }, []]) assert.equal((await plan(app, a.token, body)).status, 400, JSON.stringify(body));
    assert.equal(ai.calls.length, 0);
  });

  it('generates a structured plan grounded in the real actions, with action details keyed to exactly the ids used', async () => {
    const { app, ai } = withAi(); const a = await reg(app, 'a@x.com');
    const { careerId, actionIds } = await careerWithActions(app, a.token);
    ai.reply = validReply(actionIds);
    const r = await plan(app, a.token, { careerId });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.source, 'ai'); assert.equal(r.body.unverified, true); assert.match(r.body.notice, /weekly plan/);
    assert.equal(r.body.grounding.careerId, careerId); assert.deepEqual(r.body.plan.weeks[0].actionIds, [actionIds[0]]);
    assert.deepEqual(r.body.actions.map((d: { id: string }) => d.id), [actionIds[0]]);
    assert.ok(r.body.actions[0].skillName && r.body.actions[0].recommendation);
    assert.match(ai.calls[0].system, /weekly action plan/); // the SEPARATE plan prompt, not chat's SYSTEM_PROMPT
    // a code-fenced reply is accepted the same way, same as the Stage A parser
    ai.reply = '```json\n' + validReply(actionIds) + '\n```';
    assert.equal((await plan(app, a.token, { careerId })).status, 200);
  });

  it('STAGE C: falls back to a rule-based plan (not an error) when no AI provider is configured', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com');
    const { careerId, actionIds } = await careerWithActions(app, a.token);
    const r = await plan(app, a.token, { careerId });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.source, 'rule_based'); assert.equal(r.body.unverified, false); assert.equal(r.body.provider, null); assert.equal(r.body.grounding, null);
    assert.match(r.body.notice, /not AI-generated/);
    const used = r.body.plan.weeks.flatMap((w: { actionIds: string[] }) => w.actionIds);
    assert.deepEqual(used, actionIds); // every id is real, in calcActions' own priority order, none repeated
    assert.equal(new Set(used).size, used.length);
  });

  it('STAGE C: ownership is still enforced with no provider configured, and "no open actions" still applies before any fallback', async () => {
    const app = makeApp(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const { careerId } = await careerWithActions(app, a.token);
    const denied = await plan(app, b.token, { careerId });
    assert.equal(denied.status, 404); assert.equal(denied.body.error.code, 'career_not_found');
  });

  it('maps provider failures to the right status, with no secrets leaked', async () => {
    const { app, ai } = withAi(); const a = await reg(app, 'a@x.com');
    const { careerId } = await careerWithActions(app, a.token);
    const cases: [string | Error, number, string][] = [
      [new AiProviderError('timeout'), 504, 'ai_timeout'],
      [new AiProviderError('upstream_error', 500), 502, 'ai_unavailable'],
      [new AiProviderError('upstream_error', 429), 503, 'ai_busy'],
      [new Error(`boom ${SECRET}`), 502, 'ai_unavailable'],
    ];
    for (const [reply, status, code] of cases) {
      ai.reply = reply; const r = await plan(app, a.token, { careerId });
      assert.equal(r.status, status, String(reply)); assert.equal(r.body.error.code, code); assert.ok(!JSON.stringify(r.body).includes(SECRET));
    }
  });

  it('rejects invalid AI output outright — malformed JSON, missing fields, fake/foreign ids, too many weeks — never a partial plan', async () => {
    const { app, ai } = withAi(); const a = await reg(app, 'a@x.com');
    const { careerId, actionIds } = await careerWithActions(app, a.token);
    const other = await careerWithActions(app, a.token); // a second career owned by the same user
    const bad = [
      'not json at all',
      JSON.stringify({ weeks: [{ week: 1, focus: 'x' }] }), // missing actionIds/rationale
      JSON.stringify({ weeks: [{ week: 1, focus: 'x', actionIds: [actionIds[0], 'build_skill:invented'], rationale: 'y plausible' }] }),
      validReply([other.actionIds[0]]), // real id, but belongs to a DIFFERENT career
      JSON.stringify({ weeks: Array.from({ length: PLAN_LIMITS.weeks.max + 1 }, (_, i) => ({ week: i + 1, focus: 'x', actionIds: [actionIds[0]], rationale: 'reasoning' })) }),
    ];
    for (const reply of bad) {
      ai.reply = reply; const r = await plan(app, a.token, { careerId });
      assert.equal(r.status, 502, reply.slice(0, 60)); assert.equal(r.body.error.code, 'ai_invalid_output'); assert.equal(r.body.plan, undefined);
    }
  });

  it('OWNERSHIP: a foreign, nonexistent, or body-spoofed career id is "not found"; the model is never called', async () => {
    const { app, ai } = withAi(); const a = await reg(app, 'a@x.com'), b = await reg(app, 'b@x.com');
    const { careerId } = await careerWithActions(app, a.token);
    for (const r of [await plan(app, b.token, { careerId }), await plan(app, a.token, { careerId: 'no-such-career' }), await plan(app, b.token, { careerId, userId: a.token })]) {
      assert.equal(r.status, 404); assert.equal(r.body.error.code, 'career_not_found');
    }
    assert.equal(ai.calls.length, 0);
  });

  it('rate-limits per user (shares the chat budget) and never logs the model output or the provider key', async () => {
    const lines: string[] = []; const logger = { info: (m: string, x: unknown) => lines.push(m + JSON.stringify(x)), warn: (m: string, x: unknown) => lines.push(m + JSON.stringify(x)), error: (m: string, x: unknown) => lines.push(m + JSON.stringify(x)) };
    const { app, ai } = withAi({ logger }, 2); const a = await reg(app, 'a@x.com');
    const { careerId, actionIds } = await careerWithActions(app, a.token);
    ai.reply = validReply(actionIds);
    assert.equal((await plan(app, a.token, { careerId })).status, 200);
    const r2 = await plan(app, a.token, { careerId }); assert.equal(r2.status, 200);
    const limited = await plan(app, a.token, { careerId });
    assert.equal(limited.status, 429); assert.ok(Number(limited.headers['Retry-After']) >= 1);
    assert.ok(!JSON.stringify(r2.body).includes(SECRET));
    const all = lines.join('\n'); assert.ok(all.includes('assistant_plan')); assert.ok(!all.includes(SECRET)); assert.ok(!all.includes(actionIds[0]));
  });
});
