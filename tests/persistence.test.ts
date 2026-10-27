import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeApp } from '../server/tests/helpers';
import { api } from '../src/services/api';
import { actionService } from '../src/services/actions';
import { authService } from '../src/services/auth';
import { careerService } from '../src/services/career';
import { findPending, importBrowserData } from '../src/services/browserData';
import { dataService } from '../src/services/data';
import { profileService } from '../src/services/profile';
import { settingsService } from '../src/services/settings';
import { diffProfile, diffProgress, diffSettings } from '../src/services/reconcile';
import { toApiProfilePatch, toProfile } from '../src/services/profileMap';
import type { Action, Career, Profile } from '../src/types';
import { resetStorage, store } from './helpers';

// IN-MEMORY integration (real frontend services + real backend pipeline, fake fetch). Not PostgreSQL, not a browser.
let backend: ReturnType<typeof makeApp>, real: typeof fetch;
beforeEach(() => {
  resetStorage(); backend = makeApp({ now: () => new Date() }); real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    const r = await backend.call(init?.method ?? 'GET', String(url).replace('http://api.test', ''), { body: init?.body ? JSON.parse(String(init.body)) : undefined, token: h.Authorization?.replace('Bearer ', '') });
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  api.setBase('http://api.test/api');
});
afterEach(() => { globalThis.fetch = real; api.setToken(null); api.setUnauthorizedHandler(null); api.setBase(''); settingsService.clearCache(); });

const action = (id: string, careerId: string, over: Partial<Action> = {}): Action => ({ id, careerId, title: `Do ${id}`, description: 'd', type: 'build_skill', relatedSkillIds: [], relatedCapabilityIds: [], reason: 'r', priority: 'high', priorityScore: 60, impact: 'high', effort: 'medium', status: 'not_started', prerequisites: [], phase: 'skill_building', createdAt: '', updatedAt: '', ...over });
const customCareer = (name: string): Career => ({ id: 'tmp', name, category: 'Law', description: 'd', evidenceExpectations: [], origin: { source: 'custom' }, capabilities: [{ id: 'c1', name: 'Core', skills: [{ id: 's1', name: 'Research', currentLevel: 0, requiredLevel: 4, evidenceIds: [] }] }] });

describe('profile, target career, action progress and settings are stored on the server', () => {
  it('survive logout/login and a fresh browser, and a custom career can be the target', async () => {
    const u = await authService.signUp('Ada', 'ada@example.com', 'Passw0rdOK1');
    assert.equal((await profileService.getProfile(u.id))?.onboardingComplete, false); // new account: onboarding, not a demo profile
    const saved = await careerService.saveCustomCareer(customCareer('Corporate Lawyer'));
    await profileService.updateProfile(u.id, { targetCareerId: saved.id, stage: 'Early Career', experienceLevel: 'early', onboardingComplete: true, experienceSummary: 'Two years' });
    await actionService.setStatus(saved.id, action('act:assess:x', saved.id), 'completed');
    await settingsService.set({ reduceMotion: true });
    await authService.logout(); settingsService.clearCache(); resetStorage(); // "another device": nothing in this browser
    await authService.login('ada@example.com', 'Passw0rdOK1', true);
    const p = await profileService.getProfile(u.id) as Profile;
    assert.equal(p.targetCareerId, saved.id); assert.equal(p.onboardingComplete, true); assert.equal(p.stage, 'Early Career'); assert.equal(p.experienceSummary, 'Two years');
    assert.equal((await actionService.getStore(saved.id))['act:assess:x'].status, 'completed');
    assert.equal(settingsService.get().reduceMotion, false, 'not loaded yet: defaults, never another user\'s values');
    assert.equal((await settingsService.load()).reduceMotion, true);
    assert.equal(store().keys().filter((k) => k.includes(':actions') || k.includes(':settings') || k.includes(':profile')).length, 0, 'nothing is written to browser storage in backend mode');
  });
  it('two users never see each other\'s profile, progress or settings', async () => {
    const a = await authService.signUp('A User', 'a@example.com', 'Passw0rdOK1');
    await profileService.updateProfile(a.id, { onboardingComplete: true, targetCareerId: 'swe', stage: 'Mine' });
    await actionService.setStatus('swe', action('act:1', 'swe'), 'in_progress');
    await settingsService.set({ assistantSuggestions: false });
    await authService.logout(); settingsService.clearCache();
    const b = await authService.signUp('B User', 'b@example.com', 'Passw0rdOK1');
    const pb = await profileService.getProfile(b.id) as Profile;
    assert.equal(pb.onboardingComplete, false); assert.equal(pb.targetCareerId, ''); assert.equal(pb.stage, '');
    assert.deepEqual(await actionService.getStore('swe'), {});
    assert.equal((await settingsService.load()).assistantSuggestions, true);
  });
  it('a failed save is reported (never a silent local fallback)', async () => {
    const u = await authService.signUp('Ada', 'ada@example.com', 'Passw0rdOK1');
    await assert.rejects(() => profileService.updateProfile(u.id, { targetCareerId: 'cx-does-not-exist' }));
    const up = globalThis.fetch; globalThis.fetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    try {
      await assert.rejects(() => actionService.setStatus('swe', action('act:1', 'swe'), 'completed'));
      await assert.rejects(() => settingsService.set({ reduceMotion: true }));
    } finally { globalThis.fetch = up; }
    assert.equal(settingsService.get().reduceMotion, false);
    assert.equal(store().keys().filter((k) => k.endsWith(':actions') || k.endsWith(':settings')).length, 0);
  });
  it('"not started" clears the saved row; progress is kept as history when the gap closes', async () => {
    await authService.signUp('Ada', 'ada@example.com', 'Passw0rdOK1');
    const a = action('act:1', 'swe');
    await actionService.setStatus('swe', a, 'completed');
    assert.equal((await actionService.getStore('swe'))['act:1'].action.title, 'Do act:1');
    assert.deepEqual(await actionService.setStatus('swe', a, 'not_started'), {});
  });
  it('Reset all removes the account\'s progress and returns the profile to onboarding, but keeps custom careers', async () => {
    const u = await authService.signUp('Ada', 'ada@example.com', 'Passw0rdOK1');
    const saved = await careerService.saveCustomCareer(customCareer('Corporate Lawyer'));
    await profileService.updateProfile(u.id, { onboardingComplete: true, targetCareerId: 'swe' });
    await actionService.setStatus('swe', action('act:1', 'swe'), 'completed');
    await dataService.resetAll();
    const p = await profileService.getProfile(u.id) as Profile;
    assert.equal(p.onboardingComplete, false); assert.equal(p.targetCareerId, '');
    assert.deepEqual(await actionService.getStore('swe'), {});
    assert.ok((await careerService.list()).some((c) => c.id === saved.id));
  });
});

describe('explicit reconciliation of legacy browser data', () => {
  const localProfile = (u: string, over: Partial<Profile> = {}): Profile => ({ userId: u, stage: 'Legacy stage', education: 'BA', experienceSummary: 'Legacy summary', targetCareerId: 'swe', experienceLevel: 'intermediate', onboardingComplete: true, skillAssessments: [], completeness: 80, lastAnalysis: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over });
  const putLocal = (u: string, p: Profile) => store().setItem(`careergraph:user:${u}:profile`, JSON.stringify(p));
  const putLocalActions = (u: string, careerId: string, a: Action, status: 'in_progress' | 'completed') => store().setItem(`careergraph:user:${u}:career:${careerId}:actions`, JSON.stringify({ [a.id]: { status, updatedAt: '2026-01-02T00:00:00Z', action: { ...a, status } } }));

  it('findPending is read-only and fills only what the account is missing', async () => {
    const u = await authService.signUp('Ada', 'ada@example.com', 'Passw0rdOK1');
    putLocal(u.id, localProfile(u.id)); putLocalActions(u.id, 'swe', action('act:1', 'swe'), 'completed');
    await settingsService.set({}).catch(() => undefined);
    const before = JSON.stringify(store().keys().sort().map((k) => [k, store().getItem(k)]));
    const p = await findPending(u.id);
    assert.equal(JSON.stringify(store().keys().sort().map((k) => [k, store().getItem(k)])), before, 'nothing in the browser changed');
    assert.deepEqual(p.profile?.conflicts, []); assert.ok(p.profile?.fillLabels.includes('Target career'));
    assert.deepEqual(p.progress[0].fill, [{ actionId: 'act:1', status: 'completed' }]);
    assert.equal((await profileService.getProfile(u.id))?.onboardingComplete, false, 'server profile untouched until the user confirms');
  });
  it('copies on confirm, keeps the browser copy, and a second run copies nothing (no duplicates)', async () => {
    const u = await authService.signUp('Ada', 'ada@example.com', 'Passw0rdOK1');
    putLocal(u.id, localProfile(u.id)); putLocalActions(u.id, 'swe', action('act:1', 'swe'), 'in_progress');
    const r = await importBrowserData(u.id);
    assert.ok(r.profileFields > 0); assert.equal(r.actionsCopied, 1); assert.equal(r.failed, 0);
    const p = await profileService.getProfile(u.id) as Profile; assert.equal(p.targetCareerId, 'swe'); assert.equal(p.onboardingComplete, true); assert.equal(p.stage, 'Legacy stage');
    assert.ok(store().getItem(`careergraph:user:${u.id}:profile`), 'browser copy kept');
    const again = await importBrowserData(u.id); assert.equal(again.profileFields + again.actionsCopied + again.settingsCopied, 0);
  });
  it('conflicts keep the ACCOUNT\'s value by default and only change when the user picks the browser\'s version', async () => {
    const u = await authService.signUp('Ada', 'ada@example.com', 'Passw0rdOK1');
    await profileService.updateProfile(u.id, { stage: 'Account stage', onboardingComplete: true, targetCareerId: 'fin', experienceLevel: 'early', experienceSummary: 'Account summary' });
    await actionService.setStatus('swe', action('act:1', 'swe'), 'completed');
    putLocal(u.id, localProfile(u.id)); putLocalActions(u.id, 'swe', action('act:1', 'swe'), 'in_progress');
    const pending = await findPending(u.id);
    assert.deepEqual(pending.profile?.conflicts.map((c) => c.field).sort(), ['experienceLevel', 'experienceSummary', 'stage', 'targetCareerId']);
    assert.equal(pending.progress[0].conflicts[0].account, 'completed');
    await importBrowserData(u.id); // no choices = keep the account
    let p = await profileService.getProfile(u.id) as Profile; assert.equal(p.stage, 'Account stage'); assert.equal(p.targetCareerId, 'fin');
    assert.equal((await actionService.getStore('swe'))['act:1'].status, 'completed');
    await importBrowserData(u.id, { profile: 'browser', progress: 'browser' });
    p = await profileService.getProfile(u.id) as Profile; assert.equal(p.stage, 'Legacy stage'); assert.equal(p.targetCareerId, 'swe');
    assert.equal((await actionService.getStore('swe'))['act:1'].status, 'in_progress');
  });
  it('another user\'s browser data is never read', async () => {
    const a = await authService.signUp('A User', 'a@example.com', 'Passw0rdOK1'); putLocal(a.id, localProfile(a.id));
    await authService.logout();
    const b = await authService.signUp('B User', 'b@example.com', 'Passw0rdOK1');
    const p = await findPending(b.id); assert.equal(p.profile, null);
  });
});

describe('pure reconciliation and mapping', () => {
  const base: Profile = { userId: 'u', stage: '', education: '', experienceSummary: '', targetCareerId: '', experienceLevel: 'beginner', onboardingComplete: false, skillAssessments: [], completeness: 0, lastAnalysis: '', createdAt: '', updatedAt: '' };
  it('a browser-only career cannot be copied as a target', () => {
    const d = diffProfile({ ...base, targetCareerId: 'local-career', stage: 'S' }, base, (id) => id === 'swe');
    assert.equal(d.fill.targetCareerId, undefined); assert.equal(d.fill.stage, 'S');
  });
  it('identical values are neither fills nor conflicts', () => {
    const p = { ...base, stage: 'S', onboardingComplete: true };
    const d = diffProfile(p, p, () => true); assert.deepEqual(d.conflicts, []); assert.deepEqual(d.fillLabels, []);
  });
  it('settings: unsaved server defaults are filled, saved values conflict', () => {
    assert.deepEqual(diffSettings({ reduceMotion: true, assistantSuggestions: true }, { reduceMotion: false, assistantSuggestions: true }, false).fill, { reduceMotion: true });
    assert.equal(diffSettings({ reduceMotion: true, assistantSuggestions: true }, { reduceMotion: false, assistantSuggestions: true }, true).conflicts.length, 1);
  });
  it('progress: equal status is skipped', () => {
    const e = { status: 'completed' as const, updatedAt: '', action: action('a', 'swe') };
    const d = diffProgress('swe', { a: e }, { a: e }); assert.deepEqual([d.fill, d.conflicts], [[], []]);
  });
  it('profile mapping: empty target is null on the way out and "" on the way in; limits are respected', () => {
    assert.deepEqual(toApiProfilePatch({ targetCareerId: '', education: '', stage: 'x'.repeat(100) }).targetCareerId, null);
    assert.equal(toApiProfilePatch({ stage: 'x'.repeat(100) }).stage?.length, 60);
    assert.equal(toProfile({ userId: 'u', name: 'n', email: 'e', targetCareerId: null, experienceSummary: null, educationSummary: null, aboutNote: null, stage: '', experienceLevel: 'weird', onboardingComplete: false, completeness: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }, []).targetCareerId, '');
  });
});

describe('evidence provenance labels (UI)', () => {
  it('user-entered evidence is never labelled verified; verified needs the server\'s verified record; examples stay demo', async () => {
    const { provenanceBadge } = await import('../src/utils/provenance');
    assert.match(provenanceBadge({ source: 'user' }).text, /not verified/);
    assert.match(provenanceBadge({ source: 'user', provenance: { origin: 'user_provided', verification: 'unverified', label: 'x' } }).text, /not verified/);
    assert.equal(provenanceBadge({ source: 'user', provenance: { origin: 'user_provided', verification: 'verified', label: 'by Registrar' } }).text, 'Independently verified');
    assert.equal(provenanceBadge({ source: 'example' }).text, 'Demo example');
  });
  it('evidence created through the API comes back labelled self-reported', async () => {
    await authService.signUp('Ada', 'ada@example.com', 'Passw0rdOK1');
    const { evidenceService } = await import('../src/services/evidence');
    const created = await evidenceService.createEvidence({ title: 'Case study', description: 'd', type: 'Project', skillIds: [], strength: 'strong' });
    assert.equal(created.provenance?.verification, 'unverified'); assert.equal(created.provenance?.origin, 'user_provided');
  });
});
