import { notFound } from '../errors';
import type { AllRepos, ProfilePatch, ProfileRecord, UserRecord } from '../repositories/types';
import { ValidationError } from '../validation';

export interface ProfileView {
  userId: string; name: string; email: string; targetCareerId: string | null;
  experienceSummary: string | null; educationSummary: string | null; aboutNote: string | null;
  stage: string; experienceLevel: string; onboardingComplete: boolean; completeness: number; createdAt: string; updatedAt: string;
}
export const profileView = (u: UserRecord, p: ProfileRecord): ProfileView => ({
  userId: u.id, name: u.name, email: u.email, targetCareerId: p.targetCareerId, experienceSummary: p.experienceSummary, educationSummary: p.educationSummary, aboutNote: p.aboutNote,
  stage: p.stage, experienceLevel: p.experienceLevel, onboardingComplete: p.onboardingComplete, completeness: p.completeness, createdAt: p.createdAt, updatedAt: p.updatedAt,
});

export class ProfileService {
  constructor(private readonly repos: AllRepos) {}
  // A career is a valid target when it is visible to THIS user: a shared (seeded) career or one of their own custom careers. Never someone else's.
  private async visible(userId: string, careerId: string): Promise<boolean> { return (await this.repos.getCareerModel(userId, careerId)) !== null; }
  async get(userId: string): Promise<ProfileView> {
    const [user, profile] = await Promise.all([this.repos.findUserById(userId), this.repos.getProfile(userId)]);
    if (!user || !profile) throw notFound('Profile not found.');
    // A target that is no longer visible (for example a custom career that was deleted) is reported as "no target" rather than as a dangling id.
    const stale = profile.targetCareerId !== null && !(await this.visible(userId, profile.targetCareerId));
    return profileView(user, stale ? { ...profile, targetCareerId: null } : profile);
  }
  // userId always comes from the verified token, never from the request body.
  async update(userId: string, patch: ProfilePatch): Promise<ProfileView> {
    if (patch.targetCareerId && !(await this.visible(userId, patch.targetCareerId))) throw new ValidationError({ targetCareerId: 'Unknown career.' });
    const out = await this.repos.updateProfile(userId, patch);
    if (!out) throw notFound('Profile not found.');
    return profileView(out.user, out.profile);
  }
}
