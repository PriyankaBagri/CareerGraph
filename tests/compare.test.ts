import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { authService } from '../src/services/auth';
import { careerService } from '../src/services/career';
import { careerIntelligenceService } from '../src/services/careerIntelligence';
import { profileService } from '../src/services/profile';
import { compareCareers } from '../src/utils/compare';
import { analyze, generate, rateAll, resetStorage, seed, store } from './helpers';

beforeEach(resetStorage);
const side = async (n: string) => { const ds = n.length <= 3 ? seed(n) : await generate(n); return analyze(ds, rateAll(ds)); };
const KEYS = ['a', 'b', 'onlyA', 'onlyB', 'sharedCapabilities', 'sharedSkills'];

describe('career comparison', () => {
  for (const [a, b] of [['Fashion Designer', 'ux'], ['Corporate Lawyer', 'UPSC Civil Services'], ['Product Manager', 'swe']] as const) {
    it(`${a} vs ${b}: separate, consistent, unranked`, async () => {
      const c = compareCareers(await side(a), await side(b));
      assert.deepEqual(Object.keys(c).sort(), KEYS);
      assert.equal(c.sharedSkills.length + c.onlyA.length, c.a.totalSkills);
      assert.equal(c.sharedSkills.length + c.onlyB.length, c.b.totalSkills);
      for (const s of [c.a, c.b]) {
        assert.equal(s.skillGaps.length + s.evidenceGaps.length + s.combinedGaps.length + s.onTrack.length + s.notAssessed.length, s.totalSkills);
        assert.ok(s.previewActions.every((x) => x.careerId === s.career.id));
        assert.ok(!('rank' in s) && !('winner' in s) && !('score' in s));
      }
      assert.notEqual(c.a.career.id, c.b.career.id);
    });
  }
  it('identifies shared skills within a domain and none across unrelated domains', async () => {
    const same = compareCareers(await side('Fashion Designer'), await side('Architect'));
    assert.ok(same.sharedSkills.length >= 6 && same.sharedCapabilities.length >= 3);
    assert.equal(compareCareers(await side('Corporate Lawyer'), await side('Teacher')).sharedSkills.length, 0);
  });
});

describe('exploration safety, custom careers and isolation', () => {
  it('exploring and comparing writes nothing to the profile or roadmap', async () => {
    await authService.login('alex@example.com', 'Password1', true);
    const profile = JSON.stringify(await profileService.getProfile('u1'));
    const before = store().keys().length;
    compareCareers(await side('Fashion Designer'), await side('ux'));
    assert.equal(JSON.stringify(await profileService.getProfile('u1')), profile);
    assert.equal(store().keys().length, before);
    assert.equal((await profileService.getProfile('u1'))?.targetCareerId, 'ux');
  });
  it('persists custom careers once, per user', async () => {
    await authService.login('alex@example.com', 'Password1', true);
    for (const n of ['Fashion Designer', 'Corporate Lawyer', 'Fashion Designer']) await careerService.saveCustomCareer(await careerIntelligenceService.generateCareerModel({ name: n }));
    const list = await careerService.list();
    assert.equal(list.filter((c) => c.name === 'Fashion Designer').length, 1, 'duplicate reused');
    assert.equal(list.filter((c) => c.source === 'custom').length, 2);
    const id = list.find((c) => c.name === 'Fashion Designer')?.id ?? '';
    assert.ok((await careerService.getDataset(id)).career.capabilities.length > 0);
    await authService.logout();
    await authService.signUp('Bea Tester', 'bea@example.com', 'Password1');
    assert.equal((await careerService.list()).filter((c) => c.source !== 'seed').length, 0);
    await assert.rejects(() => careerService.getDataset(id));
    await authService.logout();
    await authService.login('alex@example.com', 'Password1', true);
    assert.equal((await careerService.list()).filter((c) => c.source === 'custom').length, 2, 'restored');
  });
  it('profile and skill levels are user-scoped', async () => {
    await authService.login('alex@example.com', 'Password1', true);
    await profileService.setSkillLevel('u1', 'ux:data-interpretation', 4);
    await authService.logout();
    const bea = await authService.signUp('Bea Tester', 'bea@example.com', 'Password1');
    assert.equal(await profileService.getProfile(bea.id), null);
    assert.equal((await profileService.getProfile('u1'))?.skillAssessments.find((a) => a.skillId === 'ux:data-interpretation')?.currentLevel, 4);
  });
});
