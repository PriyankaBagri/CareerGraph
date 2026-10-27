import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blankDraft, draftFromCareer, draftFromModel, move, removedSkills, summarize, toModelInput, validateDraft, type CareerDraft, type ExistingModel } from '../src/utils/careerDraft';
import { seed } from './helpers';

const valid = (): CareerDraft => ({ name: 'Corporate Lawyer', category: 'Law', description: '', evidenceExpectations: ['Drafted agreement'], capabilities: [{ key: 'a', name: 'Foundations', description: '', skills: [{ key: 'b', name: 'Legal research', requiredLevel: 4, importance: 5, minEvidence: null }, { key: 'c', name: 'Drafting', requiredLevel: 3, importance: 3, minEvidence: null }] }], evaluationRules: null });
const existing: ExistingModel = {
  career: { name: 'Corporate Lawyer', category: 'Law', description: '', evidenceExpectations: [] },
  capabilities: [{ id: 'cx-1:c1', name: 'Foundations', description: '', position: 0 }],
  skills: [{ id: 'cx-1:s1', name: 'Legal research' }, { id: 'cx-1:s2', name: 'Drafting' }, { id: 'cx-1:s3', name: 'Moot court' }],
  requirements: [{ skillId: 'cx-1:s1', capabilityId: 'cx-1:c1', requiredLevel: 4, importance: 5, position: 0 }, { skillId: 'cx-1:s2', capabilityId: 'cx-1:c1', requiredLevel: 3, importance: 3, position: 1 }, { skillId: 'cx-1:s3', capabilityId: 'cx-1:c1', requiredLevel: 2, importance: 2, position: 2 }],
};

describe('career draft validation (any profession, same rules)', () => {
  it('accepts a valid draft and rejects a blank one with field-level messages', () => {
    assert.deepEqual(validateDraft(valid()), {});
    const e = validateDraft(blankDraft());
    assert.ok(e.name && e.category && e['cap.0.name'] && e['cap.0.skill.0.name']);
  });
  it('rejects duplicates, out-of-range levels and oversize structures', () => {
    const d = valid(); d.capabilities[0].skills[1].name = ' legal RESEARCH '; d.capabilities[0].skills[0].requiredLevel = 6; d.capabilities[0].skills[1].importance = 0;
    const e = validateDraft(d); assert.ok(e['cap.0.skill.1.name']); assert.ok(e['cap.0.skill.0.level']); assert.ok(e['cap.0.skill.1.importance']);
    const big = valid(); big.capabilities = Array.from({ length: 13 }, (_, i) => ({ key: String(i), name: `C${i}`, description: '', skills: [{ key: `s${i}`, name: `S${i}`, requiredLevel: 3, importance: 3, minEvidence: null }] }));
    assert.ok(validateDraft(big).capabilities);
  });
  it('catalog careers become a starting point with NO ids, so saving creates a new owned career', () => {
    const d = draftFromCareer(seed('swe').career);
    assert.ok(d.capabilities.length > 0); assert.ok(d.capabilities.every((c) => c.id === undefined && c.skills.every((s) => s.id === undefined)));
    assert.deepEqual(validateDraft(d), {});
  });
});
describe('saving keeps history where it can', () => {
  it('edits keep ids; a renamed or new skill has no id; removed skills are reported', () => {
    const d = draftFromModel(existing);
    d.capabilities[0].skills = [d.capabilities[0].skills[0], { key: 'n', name: 'Negotiation', requiredLevel: 3, importance: 3, minEvidence: null }];
    const input = toModelInput(d, existing);
    assert.equal(input.capabilities[0].id, 'cx-1:c1'); assert.equal(input.capabilities[0].skills[0].id, 'cx-1:s1'); assert.equal(input.capabilities[0].skills[1].id, undefined);
    assert.deepEqual(removedSkills(existing, input).sort(), ['Drafting', 'Moot court']);
  });
  it('a regenerated structure (no ids) re-attaches by name exactly once', () => {
    const d = valid(); d.capabilities[0].skills.push({ key: 'z', name: 'drafting', requiredLevel: 2, importance: 2, minEvidence: null }); // second "Drafting": must not claim the same id twice
    const input = toModelInput(d, existing);
    const ids = input.capabilities[0].skills.map((s) => s.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length); assert.equal(input.capabilities[0].id, 'cx-1:c1');
    assert.deepEqual(removedSkills(existing, input), ['Moot court']);
  });
  it('without an existing model nothing is claimed and nothing is removed', () => {
    const input = toModelInput(valid()); assert.ok(input.capabilities.every((c) => !('id' in c) && c.skills.every((s) => !('id' in s))));
    assert.deepEqual(removedSkills(undefined, input), []);
  });
});
describe('list helpers', () => {
  it('move is bounds-safe and immutable', () => {
    const a = [1, 2, 3]; assert.deepEqual(move(a, 0, 1), [2, 1, 3]); assert.equal(move(a, 0, -1), a); assert.equal(move(a, 2, 3), a); assert.deepEqual(a, [1, 2, 3]);
  });
  it('summarize counts capabilities and skills', () => assert.deepEqual(summarize(valid()), { capabilities: 1, skills: 2 }));
});

describe('evaluation settings in the editor model', () => {
  it('round-trips levelWeight and per-skill minimum evidence, and validates them', () => {
    const m: ExistingModel = { ...existing, career: { ...existing.career, evaluationRules: { levelWeight: 0.9, evidenceFullFactor: 2 } }, requirements: existing.requirements.map((r, i) => ({ ...r, minEvidence: i === 0 ? 2 : null })) };
    const d = draftFromModel(m);
    assert.equal(d.capabilities[0].skills[0].minEvidence, 2); assert.deepEqual(d.evaluationRules, { levelWeight: 0.9, evidenceFullFactor: 2 });
    const input = toModelInput(d, m); assert.equal(input.capabilities[0].skills[0].minEvidence, 2); assert.deepEqual(input.evaluationRules, { levelWeight: 0.9, evidenceFullFactor: 2 }); // untouched settings are kept
    assert.deepEqual(validateDraft(d), {});
    d.evaluationRules = { levelWeight: 0.2 }; d.capabilities[0].skills[1].minEvidence = 11;
    const e = validateDraft(d); assert.ok(e.levelWeight); assert.ok(e['cap.0.skill.1.minEvidence']);
  });
  it('defaults: no rules and no minimum are sent as null', () => {
    const input = toModelInput(valid()); assert.equal(input.evaluationRules, null); assert.equal(input.capabilities[0].skills[0].minEvidence, null);
  });
});

describe('regression: what the editor sends is what the server accepts', () => {
  it('a draft with empty optional fields validates and serialises with empty strings, not missing required values', () => {
    const d = valid(); d.description = ''; d.capabilities[0].description = ''; d.evidenceExpectations = [];
    assert.deepEqual(validateDraft(d), {});
    const input = toModelInput(d);
    assert.equal(input.description, ''); assert.equal(input.capabilities[0].description, ''); assert.deepEqual(input.evidenceExpectations, []);
  });
});

describe('evaluation settings in the draft', () => {
  it('validates ranges, keeps untouched settings, and round-trips minimum evidence', () => {
    const d = valid(); d.evaluationRules = { levelWeight: 0.9, strengthPoints: { weak: 1, moderate: 2, strong: 3, very_strong: 5 } }; d.capabilities[0].skills[0].minEvidence = 2;
    assert.deepEqual(validateDraft(d), {});
    const input = toModelInput(d); assert.deepEqual(input.evaluationRules, d.evaluationRules); assert.equal(input.capabilities[0].skills[0].minEvidence, 2); assert.equal(input.capabilities[0].skills[1].minEvidence, null);
    d.evaluationRules = { levelWeight: 0.2, evidenceFullFactor: 9, evidenceThinBelow: 0.95 }; d.capabilities[0].skills[1].minEvidence = 11;
    const e = validateDraft(d); assert.ok(e.levelWeight && e['rules.evidenceFullFactor'] && e['rules.evidenceThinBelow'] && e['cap.0.skill.1.minEvidence']);
    d.evaluationRules = {}; assert.equal(toModelInput(d).evaluationRules, null, 'empty settings mean defaults');
  });
});
