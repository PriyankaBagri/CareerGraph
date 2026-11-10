import { randomUUID } from 'node:crypto';
import { conflict } from '../errors';
import { createMemoryCoreRepos } from './memory-core';
import { createMemoryMentorshipRepos } from './memory-mentorship';
import { createMemoryPaymentRepos } from './memory-payments';
import { createMemoryProgressRepos } from './memory-progress';
import type { ProfilePatch, ProfileRecord, Repos, UserRecord } from './types';

// In-memory Repos used by tests. Mirrors the PostgreSQL behaviour (unique email, one profile per user, user-scoped updates).
export function createMemoryRepos(seededCareerIds: string[], now: () => Date = () => new Date()): Repos & ReturnType<typeof createMemoryCoreRepos> & ReturnType<typeof createMemoryProgressRepos> & ReturnType<typeof createMemoryMentorshipRepos> & ReturnType<typeof createMemoryPaymentRepos> & { users: Map<string, UserRecord>; profiles: Map<string, ProfileRecord> } {
  const users = new Map<string, UserRecord>(), profiles = new Map<string, ProfileRecord>();
  const mentorship = createMemoryMentorshipRepos(now);
  return {
    ...createMemoryCoreRepos(now),
    ...createMemoryProgressRepos(now),
    ...mentorship,
    ...createMemoryPaymentRepos(mentorship.bookings, now),
    users, profiles,
    async createUserWithProfile({ email, name, passwordHash }) {
      if ([...users.values()].some((u) => u.email === email)) throw conflict('An account with this email already exists.');
      const t = now().toISOString();
      const user: UserRecord = { id: randomUUID(), email, name, passwordHash, createdAt: t, updatedAt: t };
      const profile: ProfileRecord = { userId: user.id, targetCareerId: null, experienceSummary: null, educationSummary: null, aboutNote: null, stage: '', experienceLevel: 'beginner', onboardingComplete: false, completeness: 0, createdAt: t, updatedAt: t };
      users.set(user.id, user); profiles.set(user.id, profile);
      return { user: { ...user }, profile: { ...profile } };
    },
    async findUserByEmail(email) { const u = [...users.values()].find((x) => x.email === email); return u ? { ...u } : null; },
    async findUserById(id) { const u = users.get(id); return u ? { ...u } : null; },
    async getProfile(userId) { const p = profiles.get(userId); return p ? { ...p } : null; },
    async updateProfile(userId, patch: ProfilePatch) {
      const u = users.get(userId), p = profiles.get(userId);
      if (!u || !p) return null;
      const t = now().toISOString();
      if (patch.name !== undefined) { u.name = patch.name; u.updatedAt = t; }
      for (const k of ['targetCareerId', 'experienceSummary', 'educationSummary', 'aboutNote'] as const) if (patch[k] !== undefined) p[k] = patch[k] as string | null;
      if (patch.stage !== undefined) p.stage = patch.stage;
      if (patch.experienceLevel !== undefined) p.experienceLevel = patch.experienceLevel;
      if (patch.onboardingComplete !== undefined) p.onboardingComplete = patch.onboardingComplete;
      if (patch.completeness !== undefined) p.completeness = patch.completeness;
      p.updatedAt = t;
      return { user: { ...u }, profile: { ...p } };
    },
    async seededCareerExists(id) { return seededCareerIds.includes(id); },
  };
}
