import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { actionService } from '../src/services/actions';
import { authService } from '../src/services/auth';
import { dataService } from '../src/services/data';
import { evidenceService } from '../src/services/evidence';
import { profileService } from '../src/services/profile';
import { settingsService } from '../src/services/settings';
import { analyze, resetStorage, seed, store } from './helpers';

beforeEach(resetStorage);
const input = { title: 'Case study', description: 'd', type: 'Project' as const, skillIds: ['ux:data-interpretation'], strength: 'strong' as const };
const userKeys = (uid: string) => store().keys().filter((k) => k.startsWith(`careergraph:user:${uid}:`));

describe('settings', () => {
  it('has defaults, persists per user and never leaks to another user', async () => {
    assert.deepEqual(settingsService.get(), { reduceMotion: false, assistantSuggestions: true });
    await authService.login('alex@example.com', 'Password1', true);
    await settingsService.set({ reduceMotion: true });
    assert.equal(settingsService.get().reduceMotion, true);
    await authService.logout();
    await authService.signUp('Bea Tester', 'bea@example.com', 'Password1');
    assert.equal(settingsService.get().reduceMotion, false);
    await authService.logout();
    await authService.login('alex@example.com', 'Password1', true);
    assert.equal(settingsService.get().reduceMotion, true);
    await assert.rejects(async () => { resetStorage(); await settingsService.set({ reduceMotion: true }); });
  });
});

describe('data controls and integrity', () => {
  async function seedUser(email: string, name: string) {
    await authService.signUp(name, email, 'Password1');
    const u = authService.getCurrentUser()!;
    await evidenceService.createEvidence(input);
    await actionService.setStatus('ux', analyze(seed('ux')).actions[0], 'completed');
    settingsService.set({ reduceMotion: true });
    return u.id;
  }
  it('clearActionProgress / clearEvidence / resetAll only touch the signed-in user', async () => {
    const a = await seedUser('a@example.com', 'User A');
    await authService.logout();
    const b = await seedUser('b@example.com', 'User B');
    const bBefore = userKeys(b).length, aBefore = userKeys(a).length;
    assert.ok(bBefore >= 3 && aBefore >= 3);
    assert.equal(await dataService.clearActionProgress(), 1);
    assert.equal((await evidenceService.getEvidence()).length, 1, 'evidence kept');
    assert.equal(await dataService.clearEvidence(), 1);
    assert.equal((await evidenceService.getEvidence()).length, 0);
    assert.equal(userKeys(a).length, aBefore, 'user A untouched');
    await dataService.resetAll();
    assert.equal(userKeys(b).length, 0);
    assert.equal(userKeys(a).length, aBefore, 'user A still untouched');
    assert.ok(store().getItem('careergraph:users'), 'accounts survive a data reset');
    assert.ok(authService.getCurrentUser(), 'session survives a data reset');
    await authService.logout(); await authService.login('a@example.com', 'Password1', true);
    assert.equal((await evidenceService.getEvidence()).length, 1, 'user A data intact after logout/login');
  });
  it('profile edits persist per user; target career changes only through updateProfile', async () => {
    await authService.login('alex@example.com', 'Password1', true);
    const before = await profileService.getProfile('u1');
    assert.equal(before?.targetCareerId, 'ux');
    analyze(seed('fin')); // exploring does not touch the profile
    assert.equal((await profileService.getProfile('u1'))?.targetCareerId, 'ux');
    await profileService.updateProfile('u1', { education: 'MA, Design', experienceLevel: 'intermediate' });
    const after = await profileService.getProfile('u1');
    assert.equal(after?.education, 'MA, Design'); assert.equal(after?.experienceLevel, 'intermediate'); assert.equal(after?.targetCareerId, 'ux');
    await profileService.updateProfile('u1', { targetCareerId: 'fin' });
    assert.equal((await profileService.getProfile('u1'))?.targetCareerId, 'fin');
    await authService.logout();
    const bea = await authService.signUp('Bea Tester', 'bea@example.com', 'Password1');
    assert.equal(await profileService.getProfile(bea.id), null);
  });
  it('action progress stays scoped by user and career after a reset of another career', async () => {
    await authService.login('alex@example.com', 'Password1', true);
    await actionService.setStatus('ux', analyze(seed('ux')).actions[0], 'completed');
    await actionService.setStatus('fin', analyze(seed('fin')).actions[0], 'in_progress');
    assert.equal(Object.keys(await actionService.getStore('ux')).length, 1);
    assert.equal(Object.keys(await actionService.getStore('fin')).length, 1);
    await dataService.clearActionProgress();
    assert.deepEqual(await actionService.getStore('ux'), {}); assert.deepEqual(await actionService.getStore('fin'), {});
  });
});
