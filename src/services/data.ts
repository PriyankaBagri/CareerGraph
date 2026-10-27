import { authService } from './auth';
import { api } from './api';
import { coreApi } from './coreApi';

// Data controls. Everything is limited to the signed-in user's own keys (careergraph:user:<uid>:...); other users,
// accounts and the session are never touched. For a real backend these become API calls.
const uid = (): string => { const u = authService.getCurrentUser(); if (!u) throw new Error('Not signed in'); return u.id; };
function remove(match: (k: string) => boolean): number {
  const prefix = `careergraph:user:${uid()}:`;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix) && match(k)) keys.push(k); }
  keys.forEach((k) => localStorage.removeItem(k));
  return keys.length;
}

// Backend mode: also deletes the signed-in user's server-side evidence / assessments (scoped by the token; there is no way to name another user).
async function clearRemoteEvidence(): Promise<number> { const list = await coreApi.listEvidence(); for (const e of list) await coreApi.deleteEvidence(e.id); return list.length; }
async function clearRemoteAssessments(): Promise<number> { const list = await coreApi.listSkillAssessments(); for (const a of list) await coreApi.clearSkillAssessment(a.skillId); return list.length; }

// Progress is stored per career; clear it for every career the user can see (their own account's rows only, by token).
async function clearRemoteProgress(): Promise<number> {
  let n = 0;
  for (const c of await coreApi.listCareers()) for (const it of await coreApi.listProgress(c.id)) { await coreApi.clearProgress(c.id, it.actionKey); n++; }
  return n;
}
async function resetRemoteProfileAndSettings(): Promise<void> {
  await coreApi.putProfile({ onboardingComplete: false, completeness: 0, stage: '', targetCareerId: null, experienceSummary: null, educationSummary: null });
  await coreApi.putSettings({ reduceMotion: false, assistantSuggestions: true });
}

export const dataService = {
  async clearActionProgress(): Promise<number> { const n = api.useBackend('progress') ? await clearRemoteProgress() : 0; return n + remove((k) => k.endsWith(':actions')); },
  async clearEvidence(): Promise<number> { const n = api.useBackend('evidence') ? await clearRemoteEvidence() : 0; return n + remove((k) => k.endsWith(':evidence')); },
  async resetAll(): Promise<number> {
    let n = 0;
    if (api.useBackend('evidence')) n += await clearRemoteEvidence();
    if (api.useBackend('assessments')) n += await clearRemoteAssessments();
    if (api.useBackend('progress')) n += await clearRemoteProgress();
    if (api.useBackend('profile')) await resetRemoteProfileAndSettings();
    return n + remove(() => true);
  },
};
