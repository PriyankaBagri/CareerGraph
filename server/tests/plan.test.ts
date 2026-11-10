import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePlan, PLAN_LIMITS } from '../src/ai/plan';

const json = (o: unknown) => JSON.stringify(o);
const ACTIONS = ['build_skill:sql-joins', 'assess_skill:data-viz', 'add_evidence:stats-basics', 'build_skill:python-basics'];
const week = (n: number, over: Record<string, unknown> = {}) => ({ week: n, focus: `Week ${n} focus`, actionIds: [ACTIONS[(n - 1) % ACTIONS.length]], rationale: `Why week ${n}'s actions fit right now.`, ...over });
const goodPlan = (weeks = 3) => ({ weeks: Array.from({ length: weeks }, (_, i) => week(i + 1)) });
type GoodPlan = ReturnType<typeof goodPlan>;

describe('plan schema validation (Stage A)', () => {
  it('accepts a complete, well-formed plan, and the same plan wrapped in one code fence', () => {
    const r1 = parsePlan(json(goodPlan()), ACTIONS);
    assert.equal(r1.ok, true);
    assert.ok(r1.ok && r1.plan.weeks.length === 3 && r1.plan.weeks[0].week === 1 && r1.plan.weeks[0].actionIds[0] === ACTIONS[0]);
    const r2 = parsePlan('```json\n' + json(goodPlan()) + '\n```', ACTIONS);
    assert.equal(r2.ok, true);
  });

  it('accepts a week with an empty actionIds list when nothing suitable is left', () => {
    const p = goodPlan(1); p.weeks[0].actionIds = [];
    const r = parsePlan(json(p), ACTIONS);
    assert.ok(r.ok && r.plan.weeks[0].actionIds.length === 0);
  });

  it('accepts the same action id reused across two different weeks', () => {
    const p = goodPlan(2); p.weeks[1].actionIds = [p.weeks[0].actionIds[0]];
    const r = parsePlan(json(p), ACTIONS);
    assert.equal(r.ok, true);
  });

  it('accepts a Set of allowed action ids as well as a plain array', () => {
    const r = parsePlan(json(goodPlan(1)), new Set(ACTIONS));
    assert.equal(r.ok, true);
  });

  // ---- "Handle empty action lists honestly": no current actions at all means no plan can legitimately be produced,
  // whatever the AI returned. The caller (Stage B / C) decides what to do, e.g. route to the rule-based fallback.
  it('rejects outright when the user has no current actions for this career, without needing valid-looking AI output', () => {
    const r = parsePlan(json(goodPlan()), []);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.issues.join('|'), /no current actions/);
  });

  const bad = (name: string, raw: string | ((p: GoodPlan) => unknown), match: RegExp, actions: readonly string[] = ACTIONS) => it(`rejects: ${name}`, () => {
    const text = typeof raw === 'string' ? raw : json(raw(goodPlan()));
    const r = parsePlan(text, actions);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.issues.join('|'), match);
  });

  describe('malformed JSON', () => {
    bad('not JSON at all', 'Sure! Here is your plan: {', /not valid JSON/);
    bad('a JSON array instead of an object', '[]', /JSON object/);
    bad('a JSON string instead of an object', '"weeks"', /JSON object/);
    bad('truncated / cut-off output', json(goodPlan()).slice(0, 40), /not valid JSON/);
    bad('prose wrapped around otherwise-valid JSON', `Here is your plan: ${json(goodPlan())}`, /not valid JSON/);
  });

  describe('missing or mistyped fields', () => {
    bad('missing weeks entirely', () => ({ notes: 'oops' }), /weeks: required list/);
    bad('weeks is not an array', () => ({ weeks: 'week 1' }), /weeks: required list/);
    bad('a week missing focus', (p) => { delete (p.weeks[0] as Record<string, unknown>).focus; return p; }, /focus: required text/);
    bad('a week missing rationale', (p) => { delete (p.weeks[0] as Record<string, unknown>).rationale; return p; }, /rationale: required text/);
    bad('a week missing actionIds', (p) => { delete (p.weeks[0] as Record<string, unknown>).actionIds; return p; }, /actionIds: required list/);
    bad('a week missing the week number', (p) => { delete (p.weeks[0] as Record<string, unknown>).week; return p; }, /week: must be the whole number 1/);
    bad('week number as text', (p) => { (p.weeks[0] as Record<string, unknown>).week = '1'; return p; }, /week: must be the whole number 1/);
    bad('week numbers out of order', (p) => { p.weeks[1].week = 5; return p; }, /week: must be the whole number 2/);
    bad('week numbers not starting at 1', (p) => { for (const w of p.weeks) w.week += 1; return p; }, /week: must be the whole number/);
    bad('focus as a number', (p) => { (p.weeks[0] as Record<string, unknown>).focus = 42; return p; }, /focus: required text/);
    bad('actionIds as a string instead of a list', (p) => { (p.weeks[0] as Record<string, unknown>).actionIds = ACTIONS[0]; return p; }, /actionIds: required list/);
    bad('an entry in actionIds that is a number, not text', (p) => { (p.weeks[0].actionIds as unknown[]) = [42]; return p; }, /actionIds\[0\]: must be text/);
    bad('a week entry that is not an object', (p) => ({ weeks: [...p.weeks.slice(1), 'week three'] }), /weeks\[2\]: must be an object/);
    bad('an unexpected top-level field', (p) => ({ ...p, evil: true }), /unexpected field/);
    bad('an unexpected field on a week', (p) => { (p.weeks[0] as Record<string, unknown>).confidence = 0.9; return p; }, /unexpected field/);
    bad('too few weeks (zero)', () => ({ weeks: [] }), new RegExp(`${PLAN_LIMITS.weeks.min}-${PLAN_LIMITS.weeks.max} weeks`));
    bad('too many weeks', () => goodPlan(PLAN_LIMITS.weeks.max + 3), new RegExp(`${PLAN_LIMITS.weeks.min}-${PLAN_LIMITS.weeks.max} weeks`));
    bad('too many action ids in one week', (p) => { p.weeks[0].actionIds = Array.from({ length: PLAN_LIMITS.actionIdsPerWeek.max + 1 }, () => ACTIONS[0]); return p; }, /actionIds: must contain/);
    bad('a duplicate action id within the same week', (p) => { p.weeks[0].actionIds = [ACTIONS[0], ACTIONS[0]]; return p; }, /duplicate action id/);
    bad('an over-long focus', (p) => { p.weeks[0].focus = 'x'.repeat(PLAN_LIMITS.focus + 1); return p; }, new RegExp(`focus: must be 2-${PLAN_LIMITS.focus}`));
    bad('an over-long rationale', (p) => { p.weeks[0].rationale = 'x'.repeat(PLAN_LIMITS.rationale + 1); return p; }, new RegExp(`rationale: must be 5-${PLAN_LIMITS.rationale}`));
    bad('control characters in focus', (p) => { p.weeks[0].focus = 'Bad\u0000focus'; return p; }, /control characters/);
  });

  // ---- The explicit Stage A requirement: never silently replace, invent, or partially accept invalid action ids.
  describe('fake / foreign action ids', () => {
    bad('an action id that does not exist at all', (p) => { p.weeks[0].actionIds = ['build_skill:made-up-skill']; return p; }, /not one of this career's current actions/);
    bad("an action id that is real but belongs to a different career's action list", (p) => { p.weeks[0].actionIds = ['build_skill:sql-joins']; return p; }, /not one of this career's current actions/, ['assess_skill:data-viz']);
    it('rejects the WHOLE plan when only one action id (in one week) is fake, not just that one id', () => {
      const p = goodPlan(3); p.weeks[1].actionIds = [ACTIONS[0], 'build_skill:totally-invented'];
      const r = parsePlan(json(p), ACTIONS);
      assert.equal(r.ok, false);
    });
    it('never echoes the fake id back in the issues (safe to log)', () => {
      const p = goodPlan(1); p.weeks[0].actionIds = ['build_skill:SECRET-LEAKED-ID'];
      const r = parsePlan(json(p), ACTIONS);
      assert.ok(!r.ok && !r.issues.join('|').includes('SECRET-LEAKED-ID'));
    });
  });

  it('issues are capped and safe to return to a client', () => {
    const p = { weeks: Array.from({ length: PLAN_LIMITS.weeks.max + 5 }, () => ({})) };
    const r = parsePlan(json(p), ACTIONS);
    assert.ok(!r.ok && r.issues.length <= 30);
  });
});
