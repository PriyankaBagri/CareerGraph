import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readinessService } from '../src/services/readiness';
import { analyze, ev, generate, seed, skillOf } from './helpers';

const UX = seed('ux');
const SK = 'ux:data-interpretation'; // required level 4 in the seed

describe('skill status', () => {
  it('skill gap with strong evidence', () => {
    const s = skillOf(analyze(UX, { [SK]: 3 }, [ev('e1', [SK], 'very_strong')]), SK);
    assert.equal(s.status, 'skill_gap'); assert.equal(s.skillGap, 1); assert.match(s.nextAction, /Strengthen/);
  });
  it('combined gap when level and evidence are both short', () => {
    const s = skillOf(analyze(UX, { [SK]: 3 }), SK);
    assert.equal(s.status, 'combined_gap'); assert.match(s.nextAction, /Build the skill/);
  });
  it('evidence gap when level is met but evidence is missing', () => {
    const v = analyze(UX, { [SK]: 4 });
    assert.equal(skillOf(v, SK).status, 'evidence_gap');
    assert.ok(v.readiness.reasons.some((r) => /evidence gap/.test(r.text)));
    assert.equal(v.gaps.find((g) => g.skillId === SK)?.kind, 'evidence');
  });
  it('on track with level met and strong evidence', () => {
    const v = analyze(UX, { [SK]: 4 }, [ev('e1', [SK], 'very_strong')]);
    const s = skillOf(v, SK);
    assert.equal(s.status, 'on_track'); assert.equal(s.strongest, 'very_strong'); assert.equal(s.coverage, 'strong');
    assert.ok(!v.gaps.some((g) => g.skillId === SK));
  });
});

describe('readiness and evidence effects', () => {
  it('is deterministic', () => assert.equal(JSON.stringify(analyze(UX)), JSON.stringify(analyze(UX))));
  it('adding, strengthening and deleting evidence changes readiness', () => {
    const base = analyze(UX, { [SK]: 4 });
    const weak = analyze(UX, { [SK]: 4 }, [ev('e1', [SK], 'weak')]);
    const strong = analyze(UX, { [SK]: 4 }, [ev('e1', [SK], 'very_strong')]);
    assert.ok(weak.readiness.overall > base.readiness.overall);
    assert.ok(strong.readiness.metrics[2].value > weak.readiness.metrics[2].value);
    assert.equal(JSON.stringify(analyze(UX, { [SK]: 4 }, [])), JSON.stringify(base)); // deleting returns to base
  });
  it('raising a skill level raises readiness and closes the gap', () => {
    const lo = analyze(UX, { [SK]: 3 }, [ev('e1', [SK], 'very_strong')]);
    const hi = analyze(UX, { [SK]: 4 }, [ev('e1', [SK], 'very_strong')]);
    assert.ok(hi.readiness.overall > lo.readiness.overall);
    assert.ok(!hi.gaps.some((g) => g.skillId === SK));
  });
  it('evidence for another career never counts', () => {
    const fin = seed('fin');
    assert.equal(analyze(fin, {}, [ev('e1', [SK], 'very_strong')]).evidence.length, 0);
    assert.equal(analyze(fin, {}, [ev('e1', [SK])]).readiness.overall, analyze(fin).readiness.overall);
  });
  it('example evidence is only included on request; unassessed skills start at 0 for real users', () => {
    assert.ok(readinessService.analyze(UX, {}, { includeExampleEvidence: true, userEvidence: [] }).evidence.every((e) => e.source === 'example'));
    assert.equal(analyze(UX).evidence.length, 0);
    assert.ok(analyze(UX).skills.every((s) => s.currentLevel === 0));
    assert.ok(readinessService.analyze(UX, {}, { includeExampleEvidence: true, userEvidence: [] }).skills.some((s) => s.currentLevel > 0));
  });
  it('never mutates the career definition', () => {
    const before = JSON.stringify(UX);
    analyze(UX, { [SK]: 5 }, [ev('e1', [SK])]);
    assert.equal(JSON.stringify(UX), before);
  });
  it('works for a generated career with the same engine', async () => {
    const ds = await generate('Corporate Lawyer');
    const sk = ds.career.capabilities[0].skills[1].id;
    const base = analyze(ds);
    const better = analyze(ds, { [sk]: 4 }, [ev('e1', [sk])]);
    assert.equal(base.skills.length, ds.career.capabilities.flatMap((c) => c.skills).length);
    assert.ok(better.readiness.overall > base.readiness.overall);
  });
});
