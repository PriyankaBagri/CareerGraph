import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEMO_PROFILE } from '../src/data/profile';
import { readinessService } from '../src/services/readiness';
import type { AssistantContext, CareerDataset } from '../src/types';
import { buildRoadmap } from '../src/utils/actions';
import { answerQuestion, buildAssistantContext, suggestedPrompts } from '../src/utils/assistant';
import { readinessLabel } from '../src/utils/readiness';
import { shortLabel } from '../src/utils/text';
import { analyze, ev, generate, rateAll, seed } from './helpers';

const UX = seed('ux');
const ids = (ds: CareerDataset) => ds.career.capabilities.flatMap((c) => c.skills.map((s) => s.id));
const ctx = (ds: CareerDataset, levels: Record<string, number>): AssistantContext => { const v = analyze(ds, levels); return buildAssistantContext(v, v.actions, buildRoadmap(ds.career.id, v.actions), DEMO_PROFILE); };

describe('readiness semantics: not assessed vs assessed', () => {
  it('a user who has rated nothing is "Not assessed", never 0%', () => {
    const v = analyze(UX);
    assert.equal(v.readiness.assessment.state, 'not_assessed');
    assert.equal(readinessLabel(v.readiness), 'Not assessed');
    assert.ok(v.skills.every((s) => s.status === 'not_assessed' && !s.assessed));
    assert.equal(v.gaps.length, 0, 'unrated skills are not gaps');
    assert.deepEqual(v.actions.map((a) => a.id), [`act:assess:${UX.career.id}`], 'the one action is to complete the assessment');
    assert.match(v.actions[0].title, /Complete your skill assessment/);
  });
  it('low but assessed readiness shows a number', () => {
    const v = analyze(UX, rateAll(UX, 1));
    assert.equal(v.readiness.assessment.state, 'assessed');
    assert.match(readinessLabel(v.readiness), /^\d+%$/);
    assert.ok(v.gaps.length > 0);
  });
  it('partial and meaningful thresholds', () => {
    const all = ids(UX);
    const rate = (n: number) => Object.fromEntries(all.slice(0, n).map((id) => [id, 3]));
    assert.equal(analyze(UX, rate(Math.ceil(all.length / 2) - 1)).readiness.assessment.state, 'not_assessed');
    assert.equal(analyze(UX, rate(Math.ceil(all.length / 2))).readiness.assessment.state, 'partial');
    assert.equal(analyze(UX, rate(all.length)).readiness.assessment.state, 'assessed');
    const partial = analyze(UX, rate(Math.ceil(all.length / 2)));
    assert.ok(partial.skills.some((s) => s.status === 'not_assessed') && partial.skills.some((s) => s.assessed));
  });
  it('the demo profile assumes assessed skills; real users do not', () => {
    const demo = readinessService.analyze(UX, {}, { includeExampleEvidence: true, userEvidence: [], assumeAssessed: true });
    assert.equal(demo.readiness.assessment.state, 'assessed');
    assert.equal(analyze(UX).readiness.assessment.state, 'not_assessed');
  });
  it('evidence on an unrated skill counts as coverage but does not make it a gap or on track', () => {
    const sk = ids(UX)[0];
    const s = analyze(UX, {}, [ev('e1', [sk], 'very_strong')]).skills.find((x) => x.skillId === sk);
    assert.equal(s?.status, 'not_assessed'); assert.equal(s?.evidenceCount, 1); assert.equal(s?.coverage, 'strong');
  });
  it('rating a skill removes it from "not assessed" and can create a real gap', () => {
    const sk = ids(UX)[0];
    assert.ok(['skill_gap', 'combined_gap'].includes(analyze(UX, { [sk]: 0 }).skills.find((x) => x.skillId === sk)!.status));
  });
  it('works for generated careers too', async () => {
    const ds = await generate('Architect');
    assert.equal(analyze(ds).readiness.assessment.state, 'not_assessed');
    assert.equal(analyze(ds, rateAll(ds)).readiness.assessment.state, 'assessed');
  });
});

describe('actions are concrete', () => {
  it('skill actions state an expected outcome and potential evidence', async () => {
    const ds = await generate('Fashion Designer');
    const acts = analyze(ds, rateAll(ds, 1)).actions.filter((a) => a.id.startsWith('act:skill:'));
    assert.ok(acts.length > 0);
    assert.ok(acts.every((a) => /Expected outcome/.test(a.description) && /Potential evidence/.test(a.description)));
    assert.ok(analyze(ds, rateAll(ds, 0)).actions.some((a) => /applied task/.test(a.title)), 'learning step is outcome-oriented');
  });
});

describe('assistant honesty and structure', () => {
  it('does not invent a score for an unassessed career', () => {
    const c = ctx(UX, {});
    const a = answerQuestion('Why is my readiness low?', c);
    assert.match(a.text, /has not been assessed/); assert.ok(!/\d+%/.test(a.text.replace(/\d+ of \d+/g, '')));
    assert.match(suggestedPrompts(c)[0], /not assessed/);
    assert.match(answerQuestion('What is my biggest gap?', c).text, /not assessed|No gaps can be identified/);
  });
  it('renders multi-action answers as separate items, never one concatenated string', () => {
    const c = ctx(UX, {});
    const sk = ids(UX)[0];
    const v = analyze(UX, rateAll(UX, 1), [ev('Case study', [sk], 'strong')]);
    const rated = buildAssistantContext(v, v.actions, buildRoadmap(UX.career.id, v.actions), DEMO_PROFILE);
    for (const q of ['What should I work on next?', 'What is my biggest gap?', 'Which evidence helps me most?']) {
      const a = answerQuestion(q, rated);
      const parts = a.items?.length ? a.items.map((i) => i.title) : a.references.map((r) => r.label);
      assert.ok(parts.length >= 2, q); // list answers use items; evidence answers use separate references
      assert.equal(new Set(parts).size, parts.length, 'distinct, separately rendered entries');
      assert.ok((a.items ?? []).every((i) => i.title && !/action:|skill:|\]\[|\[action/.test(i.title + (i.detail ?? ''))));
      assert.ok(!/action:/i.test(a.text));
    }
    assert.ok(c.actions.length >= 1);
  });
  it('uses the current career only (no previous-career leakage)', async () => {
    const a = ctx(UX, rateAll(UX, 1)), b = ctx(seed('fin'), rateAll(seed('fin'), 1));
    const ta = JSON.stringify(answerQuestion('What should I work on next?', a)), tb = JSON.stringify(answerQuestion('What should I work on next?', b));
    assert.ok(!ta.includes('Financial Analyst') && !tb.includes('UX Designer'));
    assert.notEqual(ta, tb);
  });
});

describe('graph labels', () => {
  it('shortens long labels with an ellipsis and keeps short ones', () => {
    assert.equal(shortLabel('Short', 10), 'Short');
    const s = shortLabel('A very long evidence title that would run past its column', 30);
    assert.ok(s.length <= 30 && s.endsWith('…'));
  });
});
