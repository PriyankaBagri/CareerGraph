import type { ExperienceLevel, Profile } from '../types';
import type { ApiProfile, ApiProfilePatch } from './coreApi';

const LEVELS: ExperienceLevel[] = ['beginner', 'early', 'intermediate', 'experienced'];
const level = (v: string): ExperienceLevel => (LEVELS as string[]).includes(v) ? (v as ExperienceLevel) : 'beginner';

// Server profile -> the frontend Profile shape. A missing target is '' (the existing "no target" value); ratings are overlaid by the caller.
export function toProfile(p: ApiProfile, skillAssessments: Profile['skillAssessments']): Profile {
  return {
    userId: p.userId, stage: p.stage, education: p.educationSummary ?? '', experienceSummary: p.experienceSummary ?? '', targetCareerId: p.targetCareerId ?? '',
    experienceLevel: level(p.experienceLevel), onboardingComplete: p.onboardingComplete, skillAssessments, completeness: p.completeness,
    lastAnalysis: p.updatedAt.slice(0, 10), createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}
// Frontend patch -> request body. Only fields the server stores are sent (ratings go through /me/skills, never through the profile).
export function toApiProfilePatch(patch: Partial<Profile>): ApiProfilePatch {
  const out: ApiProfilePatch = {};
  if (patch.stage !== undefined) out.stage = patch.stage.slice(0, 60);
  if (patch.experienceLevel !== undefined) out.experienceLevel = patch.experienceLevel;
  if (patch.onboardingComplete !== undefined) out.onboardingComplete = patch.onboardingComplete;
  if (patch.completeness !== undefined) out.completeness = Math.max(0, Math.min(100, Math.round(patch.completeness)));
  if (patch.targetCareerId !== undefined) out.targetCareerId = patch.targetCareerId || null;
  if (patch.experienceSummary !== undefined) out.experienceSummary = patch.experienceSummary.slice(0, 1000) || null;
  if (patch.education !== undefined) out.educationSummary = patch.education.slice(0, 500) || null;
  return out;
}
