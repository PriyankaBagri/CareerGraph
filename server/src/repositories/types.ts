export interface UserRecord { id: string; email: string; name: string; passwordHash: string; createdAt: string; updatedAt: string }
export interface ProfileRecord {
  userId: string; targetCareerId: string | null; experienceSummary: string | null; educationSummary: string | null; aboutNote: string | null;
  stage: string; experienceLevel: string; onboardingComplete: boolean; completeness: number; createdAt: string; updatedAt: string;
}
// undefined = leave unchanged, null = clear.
export interface ProfilePatch {
  name?: string; targetCareerId?: string | null; experienceSummary?: string | null; educationSummary?: string | null; aboutNote?: string | null;
  stage?: string; experienceLevel?: string; onboardingComplete?: boolean; completeness?: number;
}

import type { CoreRepos } from './core-types';
import type { MentorshipRepos } from './mentorship-types';
import type { PaymentRepos } from './payment-types';
import type { ProgressRepos } from './progress-types';
export type AllRepos = Repos & CoreRepos & ProgressRepos & MentorshipRepos & PaymentRepos;

export interface Repos {
  // Creates the user AND their profile atomically. Throws a 409 conflict AppError if the email is taken.
  createUserWithProfile(input: { email: string; name: string; passwordHash: string }): Promise<{ user: UserRecord; profile: ProfileRecord }>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  getProfile(userId: string): Promise<ProfileRecord | null>;
  // Always scoped to userId. Returns null if the user has no profile.
  updateProfile(userId: string, patch: ProfilePatch): Promise<{ user: UserRecord; profile: ProfileRecord } | null>;
  seededCareerExists(careerId: string): Promise<boolean>;
}
