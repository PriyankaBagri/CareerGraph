export const ACTION_STATUSES = ['in_progress', 'completed'] as const;
export const ACTION_PHASES = ['foundation', 'skill_building', 'evidence_building', 'career_readiness'] as const;
export const LEVEL3 = ['high', 'medium', 'low'] as const;
export type StoredStatus = (typeof ACTION_STATUSES)[number];

/** A snapshot of the generated action the user acted on. Kept as history even after the gap that produced it closes. */
export interface ActionSnapshot {
  title: string; description: string; type: string; phase: string; priority: string; priorityScore: number; impact: string; effort: string;
  estimatedTime: string; reason: string; prerequisites: string[]; relatedSkillIds: string[]; relatedCapabilityIds: string[]; createdAt: string;
}
export interface ProgressRecord { actionKey: string; careerId: string; status: StoredStatus; updatedAt: string; completedAt: string | null; snapshot: ActionSnapshot }
export interface SettingsRecord { reduceMotion: boolean; assistantSuggestions: boolean; updatedAt: string | null }
export type SettingsPatch = { reduceMotion?: boolean; assistantSuggestions?: boolean };

// Every method takes the authenticated userId first and scopes by it. "not_started" is represented by NO row.
export interface ProgressRepos {
  listProgress(userId: string, careerId: string): Promise<ProgressRecord[]>;
  setProgress(userId: string, careerId: string, actionKey: string, status: StoredStatus, snapshot: ActionSnapshot): Promise<ProgressRecord>;
  clearProgress(userId: string, careerId: string, actionKey: string): Promise<boolean>;
  getSettings(userId: string): Promise<SettingsRecord>;
  updateSettings(userId: string, patch: SettingsPatch): Promise<SettingsRecord>;
}
