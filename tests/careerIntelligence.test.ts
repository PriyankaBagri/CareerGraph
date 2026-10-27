import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { careerIntelligenceService as S } from '../src/services/careerIntelligence';
import { generate } from './helpers';

const NAMES = ['Fashion Designer', 'Corporate Lawyer', 'UPSC Civil Services', 'Product Manager', 'Architect', 'Teacher', 'Clinical Researcher', 'Wildlife Documentary Producer'];

describe('career intelligence', () => {
  it('validates input with friendly messages', () => {
    assert.equal(S.validateInput({ name: '' }), 'Enter a career or professional goal.');
    assert.equal(S.validateInput({ name: '   ' }), 'Enter a career or professional goal.');
    assert.ok(S.validateInput({ name: 'a' }));
    assert.ok(S.validateInput({ name: 'x'.repeat(81) }));
    assert.equal(S.validateInput({ name: '  Architect ' }), null);
  });

  it('generates a valid, normalized Career for arbitrary input', async () => {
    for (const n of NAMES) {
      const { career } = await generate(n);
      assert.ok(career.id.startsWith('custom-'), n);
      assert.equal(career.origin?.source, 'custom');
      assert.ok(career.capabilities.length >= 3 && career.capabilities.every((c) => c.skills.length > 0), n);
      const ids = career.capabilities.flatMap((c) => c.skills.map((s) => s.id));
      assert.equal(new Set(ids).size, ids.length, `unique skill ids: ${n}`);
      assert.ok(career.capabilities.flatMap((c) => c.skills).every((s) => s.requiredLevel >= 1 && s.requiredLevel <= 5 && s.currentLevel === 0));
      assert.ok((career.evidenceExpectations?.length ?? 0) > 0);
      assert.ok((await S.validateCareerModel(career)).valid);
    }
  });

  it('produces different models for unrelated careers and uses the optional description', async () => {
    const law = (await generate('Corporate Lawyer', 'work with large companies')).career;
    const fashion = (await generate('Fashion Designer')).career;
    const upsc = (await generate('UPSC Civil Services')).career;
    const unknown = (await generate('Wildlife Documentary Producer')).career;
    assert.notEqual(law.category, fashion.category);
    assert.notEqual(upsc.category, law.category);
    assert.ok(law.description.includes('work with large companies'));
    assert.ok(unknown.capabilities.length >= 3, 'unknown careers still get a usable generic model');
    assert.ok(!JSON.stringify(fashion).match(/C\+\+|GitHub|React/));
  });

  it('rejects unusable models and refuses bad input', async () => {
    const { career } = await generate('Teacher');
    assert.equal((await S.validateCareerModel({ ...career, capabilities: [] })).valid, false);
    assert.equal((await S.validateCareerModel({ ...career, capabilities: [{ ...career.capabilities[0], skills: [] }] })).valid, false);
    await assert.rejects(() => S.generateCareerModel({ name: '' }));
  });

  it('searchCareers goes through the provider interface', async () => {
    const hits = await S.searchCareers('design');
    assert.ok(hits.some((c) => c.id === 'ux'));
  });
});
