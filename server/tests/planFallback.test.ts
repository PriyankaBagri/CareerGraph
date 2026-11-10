import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcActions, type EngineInput, type EngineSkill } from '../src/domain/readiness';
import { buildFallbackPlan } from '../src/domain/planFallback';
import { PLAN_LIMITS } from '../src/ai/plan';

const sk = (id: string, req: number, imp: number, pos = 0): EngineSkill => ({ skillId: id, name: id.toUpperCase(), capabilityId: 'c1', capabilityName: 'Cap', requiredLevel: req, importance: imp, position: pos });
const inp = (skills: EngineSkill[], assessments: Record<string, number> = {}): EngineInput => ({ careerId: 'x', careerName: 'X', skills, assessments, evidenceStrengths: {} });
// 7 unassessed skills of varying importance -> calcActions ranks them highest-importance-first.
const manySkills = Array.from({ length: 7 }, (_, i) => sk(`s${i}`, 3, (i % 5) + 1, i));

describe('buildFallbackPlan (deterministic, non-AI)', () => {
  it('is deterministic: identical input gives identical output', () => {
    const actions = calcActions(inp(manySkills), 10);
    assert.deepEqual(buildFallbackPlan(actions), buildFallbackPlan(actions));
  });

  it('uses only real action ids, in their original (highest-priority-first) order, with no duplicates', () => {
    const actions = calcActions(inp(manySkills), 10);
    const plan = buildFallbackPlan(actions);
    const used = plan.weeks.flatMap((w) => w.actionIds);
    assert.deepEqual(used, actions.map((a) => a.id)); // same order calcActions ranked them in, nothing skipped or reordered
    assert.equal(new Set(used).size, used.length); // no action repeated across weeks
  });

  it('distributes across multiple weeks and respects PLAN_LIMITS bounds', () => {
    const actions = calcActions(inp(manySkills), 10);
    const plan = buildFallbackPlan(actions);
    assert.ok(plan.weeks.length > 1);
    assert.ok(plan.weeks.length <= PLAN_LIMITS.weeks.max);
    for (const w of plan.weeks) assert.ok(w.actionIds.length <= PLAN_LIMITS.actionIdsPerWeek.max && w.actionIds.length > 0);
  });

  it('one action produces one week containing exactly that action', () => {
    const actions = calcActions(inp([sk('solo', 3, 5)]), 10);
    const plan = buildFallbackPlan(actions);
    assert.equal(plan.weeks.length, 1); assert.deepEqual(plan.weeks[0].actionIds, [actions[0].id]);
  });

  it('focus and rationale are short, plain text (no placeholders, within PLAN_LIMITS field sizes)', () => {
    const actions = calcActions(inp(manySkills), 10);
    for (const w of buildFallbackPlan(actions).weeks) {
      assert.ok(w.focus.length > 0 && w.focus.length <= PLAN_LIMITS.focus);
      assert.ok(w.rationale.length > 0 && w.rationale.length <= PLAN_LIMITS.rationale);
    }
  });
});
