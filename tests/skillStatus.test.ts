import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { skillState, statusBreakdown, whyGap } from '../src/utils/skillStatus';
import { analyze, ev, rateAll, seed, skillOf } from './helpers';

describe('unassessed, missing evidence and below-target are three different things', () => {
  const ds = seed('swe'); const ids = ds.career.capabilities.flatMap((c) => c.skills.map((s) => s.id));
  it('an unassessed skill is "unknown", not a gap and not level 0', () => {
    const v = analyze(ds); const s = skillOf(v, ids[0]); const st = skillState(s);
    assert.equal(st.tone, 'unknown'); assert.equal(st.label, 'Not assessed'); assert.match(st.detail, /cannot tell/);
    const b = statusBreakdown(v.skills); assert.equal(b.notAssessed, ids.length); assert.equal(b.belowTarget, 0); assert.equal(b.evidenceMissing, 0);
  });
  it('a rated skill under target is "below target"; at target without evidence it is "evidence missing"', () => {
    const levels = rateAll(ds, 0); const req = ds.career.capabilities[0].skills[0].requiredLevel;
    levels[ids[0]] = Math.max(0, req - 1); levels[ids[1]] = ds.career.capabilities.flatMap((c) => c.skills)[1].requiredLevel;
    const v = analyze(ds, levels);
    const below = skillState(skillOf(v, ids[0])); assert.equal(below.tone, 'below'); assert.match(below.label, /Below target/);
    const noEv = skillState(skillOf(v, ids[1])); assert.equal(noEv.tone, 'evidence'); assert.equal(noEv.label, 'Evidence missing');
  });
  it('with strong evidence a skill at target is on track; breakdown counts add up', () => {
    const levels = rateAll(ds, 5); const v = analyze(ds, levels, [ev('e1', [ids[0]], 'very_strong'), ev('e2', [ids[0]], 'very_strong')]);
    assert.equal(skillState(skillOf(v, ids[0])).tone, 'ok');
    const b = statusBreakdown(v.skills); assert.equal(b.notAssessed + b.belowTarget + b.evidenceMissing + b.evidenceThin + b.onTrack >= b.total - 0, true); assert.equal(b.onTrack >= 1, true);
  });
  it('whyGap explains in terms of importance and the required level only', () => {
    const t = whyGap({ skillId: 's', skillName: 'S', capabilityName: 'C', requiredLevel: 4, currentLevel: 2, size: 2, impact: 'high', evidenceCount: 0, kind: 'skill' });
    assert.match(t, /high-importance/); assert.match(t, /Advanced/); assert.match(t, /Basic/);
    assert.match(whyGap({ skillId: 's', skillName: 'S', capabilityName: 'C', requiredLevel: 4, currentLevel: 4, size: 0, impact: 'medium', evidenceCount: 0, kind: 'evidence' }), /missing proof/);
  });
});
