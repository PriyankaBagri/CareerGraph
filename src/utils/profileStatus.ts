import type { Profile, SkillAnalysis } from '../types';

// "How complete is my profile" from facts the user can see and change, not from a stored number. Each item is either done or not, and the missing ones are named.
export interface ProfileProgress { done: number; total: number; percent: number; missing: string[] }
export interface ProfileFacts { targetCareerId: string; education: string; experienceSummary: string }
export function profileProgress(p: Pick<Profile, 'targetCareerId' | 'education' | 'experienceSummary'>, skills: Pick<SkillAnalysis, 'assessed'>[] | null, evidenceCount: number | null): ProfileProgress {
  const items: [string, boolean | null][] = [
    ['a target career', !!p.targetCareerId],
    ['your education', !!p.education.trim()],
    ['a line about you', !!p.experienceSummary.trim()],
    ['a skill rating for your target career', skills === null ? null : skills.some((s) => s.assessed)],
    ['one piece of evidence', evidenceCount === null ? null : evidenceCount > 0],
  ];
  const known = items.filter(([, v]) => v !== null) as [string, boolean][];
  const done = known.filter(([, v]) => v).length;
  return { done, total: known.length, percent: known.length ? Math.round((done / known.length) * 100) : 0, missing: known.filter(([, v]) => !v).map(([n]) => n) };
}
// Ratings for the career the user is working on, versus ratings kept for other careers (they are per skill, and skills differ between careers).
export function ratingSummary(skills: Pick<SkillAnalysis, 'assessed'>[], allRatings: number): { forCareer: number; total: number; other: number } {
  const forCareer = skills.filter((s) => s.assessed).length;
  return { forCareer, total: skills.length, other: Math.max(0, allRatings - forCareer) };
}
