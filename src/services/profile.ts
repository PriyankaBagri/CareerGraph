import { DEMO_PROFILE } from '../data/profile';
import type { OnboardingInput, Profile } from '../types';
import { EXPERIENCE_LEVELS } from '../utils/constants';
import { api, mockDelay } from './api';
import { coreApi } from './coreApi';
import { toApiProfilePatch, toProfile } from './profileMap';

// Backend mode (VITE_API_URL set): profile details, target career and onboarding state live on the server under the signed-in user (GET/PUT /profile);
// skill ratings live there too. Browser-local profiles are only read by the explicit import (peekLocalProfile) and never used silently.
// Without VITE_API_URL the app runs on local demo data in localStorage.
const key = (userId: string) => `careergraph:user:${userId}:profile`;
const load = (userId: string): Profile | null => {
  try { const v = localStorage.getItem(key(userId)); if (v) return JSON.parse(v) as Profile; } catch { /* ignore */ }
  return userId === DEMO_PROFILE.userId ? DEMO_PROFILE : null;
};

// Only skills the user has actually rated are returned, so "unassessed" stays distinct from level 0.
async function remoteAssessments(): Promise<Profile['skillAssessments']> {
  return (await coreApi.listSkillAssessments()).filter((a) => a.assessed && a.level !== null).map((a) => ({ skillId: a.skillId, currentLevel: a.level as number }));
}

export const profileService = {
  // Read-only look at the ratings stored in THIS browser's profile for the user (used by the explicit "copy to my account" import). Never writes.
  peekLocalAssessments(userId: string): Profile['skillAssessments'] { return load(userId)?.skillAssessments ?? []; },
  // Read-only look at the profile saved in THIS browser (legacy data), for the explicit import. Never writes.
  peekLocalProfile(userId: string): Profile | null { const v = load(userId); return v && v.userId === userId && !v.isDemo ? v : null; },
  async getProfile(userId: string): Promise<Profile | null> {
    if (api.useBackend('profile')) return toProfile(await coreApi.getProfile(), await remoteAssessments());
    const local = load(userId);
    // Skill assessments live on the server when the backend is configured; the rest of the profile is still local (Stage 5 limitation).
    if (local && api.useBackend('assessments')) return { ...local, skillAssessments: await remoteAssessments() };
    return mockDelay(local, 150);
  },
  async saveProfile(profile: Profile): Promise<Profile> {
    if (api.useBackend('profile')) return profileService.updateProfile(profile.userId, profile);
    const saved = { ...profile, updatedAt: new Date().toISOString() };
    localStorage.setItem(key(profile.userId), JSON.stringify(saved));
    return mockDelay(saved, 200);
  },
  async updateProfile(userId: string, patch: Partial<Profile>): Promise<Profile> {
    if (api.useBackend('profile')) return toProfile(await coreApi.putProfile(toApiProfilePatch(patch)), await remoteAssessments());
    const current = load(userId);
    if (!current) throw new Error('Profile not found');
    const saved = await profileService.saveProfile({ ...current, ...patch });
    return api.useBackend('assessments') ? { ...saved, skillAssessments: await remoteAssessments() } : saved; // the server owns the ratings in backend mode
  },
  // The user's own assessment; the career's required level is never modified.
  async setSkillLevel(userId: string, skillId: string, level: number): Promise<Profile> {
    if (api.useBackend('assessments') && api.useBackend('profile')) { await coreApi.setSkillAssessment(skillId, level); return toProfile(await coreApi.getProfile(), await remoteAssessments()); }
    const cur = load(userId);
    if (!cur) throw new Error('Profile not found');
    if (api.useBackend('assessments')) { await coreApi.setSkillAssessment(skillId, level); return { ...cur, skillAssessments: await remoteAssessments() }; }
    return profileService.saveProfile({ ...cur, skillAssessments: [...cur.skillAssessments.filter((a) => a.skillId !== skillId), { skillId, currentLevel: level }] });
  },
  async completeOnboarding(userId: string, input: OnboardingInput): Promise<Profile> {
    const now = new Date().toISOString();
    const level = EXPERIENCE_LEVELS.find((l) => l.value === input.experienceLevel)?.label ?? '';
    let assessments = input.skillAssessments;
    if (api.useBackend('assessments')) { // save each rating on the server first (idempotent PUTs); a failure aborts onboarding so the user can retry
      for (const a of input.skillAssessments) await coreApi.setSkillAssessment(a.skillId, a.currentLevel);
      assessments = await remoteAssessments();
    }
    if (api.useBackend('profile')) {
      const done = await coreApi.putProfile(toApiProfilePatch({ stage: level, experienceLevel: input.experienceLevel, experienceSummary: input.headline ?? '', targetCareerId: input.targetCareerId, onboardingComplete: true, completeness: Math.min(100, 40 + assessments.length * 10) }));
      return toProfile(done, assessments);
    }
    return profileService.saveProfile({
      userId, stage: level, education: '', experienceSummary: input.headline ?? '', targetCareerId: input.targetCareerId,
      experienceLevel: input.experienceLevel, onboardingComplete: true, skillAssessments: assessments,
      completeness: Math.min(100, 40 + assessments.length * 10), lastAnalysis: now.slice(0, 10), createdAt: now, updatedAt: now,
    });
  },
};
