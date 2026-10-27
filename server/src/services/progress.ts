import { notFound } from '../errors';
import type { CoreRepos } from '../repositories/core-types';
import type { ActionSnapshot, ProgressRecord, ProgressRepos, SettingsPatch, SettingsRecord, StoredStatus } from '../repositories/progress-types';

// Action progress records ONLY what the user said ("in progress" / "completed"). It never changes a skill rating or evidence.
// Every call is scoped by the authenticated user id and requires the career to be visible to that user (shared, or their own custom career).
export class ProgressService {
  constructor(private readonly repos: CoreRepos & ProgressRepos) {}
  private async model(userId: string, careerId: string) {
    const m = await this.repos.getCareerModel(userId, careerId);
    if (!m) throw notFound('Career not found.', 'career_not_found');
    return m;
  }
  async list(userId: string, careerId: string): Promise<{ careerId: string; items: ProgressRecord[] }> {
    await this.model(userId, careerId);
    return { careerId, items: await this.repos.listProgress(userId, careerId) };
  }
  async set(userId: string, careerId: string, actionKey: string, status: StoredStatus, snapshot: ActionSnapshot): Promise<ProgressRecord> {
    const m = await this.model(userId, careerId);
    const skills = new Set(m.skills.map((s) => s.id)), caps = new Set(m.capabilities.map((c) => c.id));
    // References to skills/capabilities that are not part of this career are dropped, so a snapshot can never point into another career's (or user's) data.
    const clean: ActionSnapshot = { ...snapshot, relatedSkillIds: snapshot.relatedSkillIds.filter((x) => skills.has(x)), relatedCapabilityIds: snapshot.relatedCapabilityIds.filter((x) => caps.has(x)) };
    return this.repos.setProgress(userId, careerId, actionKey, status, clean);
  }
  async clear(userId: string, careerId: string, actionKey: string): Promise<void> {
    await this.model(userId, careerId);
    await this.repos.clearProgress(userId, careerId, actionKey); // idempotent: clearing something that is not saved is fine
  }
  getSettings(userId: string): Promise<SettingsRecord> { return this.repos.getSettings(userId); }
  updateSettings(userId: string, patch: SettingsPatch): Promise<SettingsRecord> { return this.repos.updateSettings(userId, patch); }
}
