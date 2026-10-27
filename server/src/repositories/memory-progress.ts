import type { ActionSnapshot, ProgressRecord, ProgressRepos, SettingsRecord } from './progress-types';

export function createMemoryProgressRepos(now: () => Date = () => new Date()): ProgressRepos & { progress: Map<string, ProgressRecord & { userId: string }>; settings: Map<string, SettingsRecord> } {
  const progress = new Map<string, ProgressRecord & { userId: string }>(), settings = new Map<string, SettingsRecord>();
  const k = (u: string, c: string, a: string) => `${u}\u0000${c}\u0000${a}`;
  const clone = (r: ProgressRecord & { userId: string }): ProgressRecord => { const { userId: _u, ...rest } = r; return structuredClone(rest); };
  return {
    progress, settings,
    async listProgress(userId, careerId) { return [...progress.values()].filter((r) => r.userId === userId && r.careerId === careerId).map(clone); },
    async setProgress(userId, careerId, actionKey, status, snapshot: ActionSnapshot) {
      const t = now().toISOString();
      const rec = { userId, careerId, actionKey, status, updatedAt: t, completedAt: status === 'completed' ? t : null, snapshot: structuredClone(snapshot) };
      progress.set(k(userId, careerId, actionKey), rec);
      return clone(rec);
    },
    async clearProgress(userId, careerId, actionKey) { return progress.delete(k(userId, careerId, actionKey)); },
    async getSettings(userId) { return { ...(settings.get(userId) ?? { reduceMotion: false, assistantSuggestions: true, updatedAt: null }) }; },
    async updateSettings(userId, patch) {
      const cur = settings.get(userId) ?? { reduceMotion: false, assistantSuggestions: true, updatedAt: null };
      const next: SettingsRecord = { reduceMotion: patch.reduceMotion ?? cur.reduceMotion, assistantSuggestions: patch.assistantSuggestions ?? cur.assistantSuggestions, updatedAt: now().toISOString() };
      settings.set(userId, next);
      return { ...next };
    },
  };
}
