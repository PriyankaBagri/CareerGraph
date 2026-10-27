import type { Career, Evidence, Profile } from '../types';
import { careerService } from './career';
import { api, ApiError } from './api';
import { coreApi, toApiCareerInput, toApiEvidenceInput } from './coreApi';
import { evidenceService } from './evidence';
import { profileService } from './profile';
import { actionService } from './actions';
import { toSnapshot } from './actionMap';
import { settingsService } from './settings';
import { diffProfile, diffProgress, diffSettings, type Choice, type ProfileDiff, type ProgressDiff, type SettingsDiff } from './reconcile';

// EXPLICIT, user-confirmed copy of data saved in this browser into the signed-in server account.
// Guarantees: never deletes or edits anything stored in the browser, never overwrites a server rating or record,
// skips anything the server already has (so running it again is safe), and keeps going after a single item fails.
export interface PendingImport {
  ratings: { skillId: string; currentLevel: number }[]; evidence: Evidence[]; careers: Career[]; keptOnServer: number; alreadyOnServer: number;
  profile: ProfileDiff | null; progress: ProgressDiff[]; settings: SettingsDiff;
}
// What the user decided for the places where this browser and the account disagree. Anything not listed keeps the ACCOUNT's value.
export type Resolutions = { profile?: Choice; progress?: Choice; settings?: Choice };
export const hasConflicts = (p: PendingImport) => !!p.profile?.conflicts.length || p.progress.some((x) => x.conflicts.length > 0) || p.settings.conflicts.length > 0;
export const hasAnything = (p: PendingImport) => p.ratings.length + p.evidence.length + p.careers.length > 0 || !!p.profile && (p.profile.fillLabels.length > 0 || p.profile.conflicts.length > 0) || p.progress.some((x) => x.fill.length + x.conflicts.length > 0) || Object.keys(p.settings.fill).length + p.settings.conflicts.length > 0;
export interface ImportResult { careersCopied: number; ratingsCopied: number; evidenceCopied: number; profileFields: number; actionsCopied: number; settingsCopied: number; skipped: number; failed: number; stopped: 'auth' | 'network' | null }

const norm = (s: string | null | undefined) => (s ?? '').trim();
export const fingerprint = (e: { title: string; description: string; type: string; strength: string; skillIds?: string[]; url?: string | null; date?: string | null; organization?: string | null }): string =>
  JSON.stringify([norm(e.title), norm(e.description), e.type, e.strength, [...(e.skillIds ?? [])].sort(), norm(e.url), norm(e.date).slice(0, 10), norm(e.organization)]);

async function serverState() {
  const [assess, ev] = await Promise.all([coreApi.listSkillAssessments(), coreApi.listEvidence()]);
  const rated = new Map(assess.filter((a) => a.assessed && a.level !== null).map((a) => [a.skillId, a.level as number]));
  const names = new Set((await coreApi.listCareers()).filter((c) => c.source !== 'seed').map((c) => c.name.trim().toLowerCase())); // careers the account already has
  const counts = new Map<string, number>();
  for (const e of ev) counts.set(fingerprint(e), (counts.get(fingerprint(e)) ?? 0) + 1);
  return { rated, counts, names };
}

// Read-only. Returns what WOULD be copied (nothing the server already has). Throws if the server cannot be read.
export async function findPending(userId: string): Promise<PendingImport> {
  const local = { ratings: profileService.peekLocalAssessments(userId), evidence: evidenceService.peekLocalEvidence() };
  const { rated, counts, names } = await serverState();
  const careers = careerService.peekLocalCustom().filter((c) => !names.has(c.name.trim().toLowerCase()));
  const ratings = local.ratings.filter((r) => !rated.has(r.skillId));
  const remaining = new Map(counts); // multiset: N identical local items match at most N identical server items
  const evidence: Evidence[] = [];
  for (const e of local.evidence) {
    const f = fingerprint(e); const n = remaining.get(f) ?? 0;
    if (n > 0) remaining.set(f, n - 1); else evidence.push(e);
  }
  const { profile, progress, settings } = await reconcileExtras(userId);
  return { ratings, evidence, careers, keptOnServer: local.ratings.length - ratings.length, alreadyOnServer: local.evidence.length - evidence.length, profile, progress, settings };
}

// Profile details, action progress and settings: compared field by field. Read-only.
async function reconcileExtras(userId: string): Promise<{ profile: ProfileDiff | null; progress: ProgressDiff[]; settings: SettingsDiff }> {
  const visible = new Set((await coreApi.listCareers()).map((c) => c.id));
  const localProfile = profileService.peekLocalProfile(userId);
  const profile = localProfile ? diffProfile(localProfile, await profileService.getProfile(userId) as Profile, (id) => visible.has(id)) : null;
  const progress: ProgressDiff[] = [];
  for (const careerId of actionService.peekLocalCareerIds(userId)) {
    if (!visible.has(careerId)) continue; // progress of a browser-only career can only be copied after the career itself is in the account
    const d = diffProgress(careerId, actionService.peekLocal(userId, careerId), await actionService.getStore(careerId));
    if (d.fill.length || d.conflicts.length) progress.push(d);
  }
  const server = await coreApi.getSettings();
  const settings = diffSettings(settingsService.peekLocal(userId), { reduceMotion: server.reduceMotion, assistantSuggestions: server.assistantSuggestions }, server.updatedAt !== null);
  return { profile: profile && (profile.fillLabels.length || profile.conflicts.length) ? profile : null, progress, settings };
}

let running = false;
export async function importBrowserData(userId: string, choices: Resolutions = {}): Promise<ImportResult> {
  if (running) throw new Error('An import is already running.');
  running = true;
  const r: ImportResult = { careersCopied: 0, ratingsCopied: 0, evidenceCopied: 0, profileFields: 0, actionsCopied: 0, settingsCopied: 0, skipped: 0, failed: 0, stopped: null };
  try {
    const p = await findPending(userId); // re-checked against the server right now, so a repeat or concurrent run copies nothing twice
    r.skipped = p.keptOnServer + p.alreadyOnServer + (choices.profile === 'browser' ? 0 : p.profile?.conflicts.length ?? 0) + (choices.progress === 'browser' ? 0 : p.progress.reduce((n, x) => n + x.conflicts.length, 0)) + (choices.settings === 'browser' ? 0 : p.settings.conflicts.length);
    const oldestFirst = [...p.evidence].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    // Careers first: ratings/evidence of local custom careers cannot be moved (their skill ids are local), only the career structure.
    const steps: (() => Promise<void>)[] = [
      ...p.careers.map((c) => async () => { await coreApi.createCareer(toApiCareerInput(c)); r.careersCopied++; }),
      ...p.ratings.map((x) => async () => { await coreApi.setSkillAssessment(x.skillId, x.currentLevel); r.ratingsCopied++; }),
      ...oldestFirst.map((e) => async () => { await coreApi.createEvidence(toApiEvidenceInput(e)); r.evidenceCopied++; }),
    ];
    // Profile, progress and settings: "fill" entries only add what the account is missing; conflicting values are applied ONLY when the user chose the browser's version.
    if (p.profile) {
      const prof = p.profile, patch = { ...prof.fill } as Record<string, unknown>;
      if (choices.profile === 'browser') for (const c of prof.conflicts) { const local = profileService.peekLocalProfile(userId); if (local) patch[c.field] = (local as unknown as Record<string, unknown>)[c.field]; }
      if (Object.keys(patch).length) steps.push(async () => { await profileService.updateProfile(userId, patch as Partial<Profile>); r.profileFields += Object.keys(patch).length; });
    }
    for (const d of p.progress) {
      const local = actionService.peekLocal(userId, d.careerId);
      const todo = [...d.fill.map((x) => x.actionId), ...(choices.progress === 'browser' ? d.conflicts.map((x) => x.actionId) : [])];
      for (const id of todo) steps.push(async () => { const e = local[id]; if (!e) return; await coreApi.putProgress(d.careerId, id, e.status as 'in_progress' | 'completed', toSnapshot({ ...e.action, status: e.status })); r.actionsCopied++; });
    }
    const sPatch = { ...p.settings.fill } as Record<string, boolean>;
    if (choices.settings === 'browser') for (const c of p.settings.conflicts) sPatch[c.field] = c.browser === 'On';
    if (Object.keys(sPatch).length) steps.push(async () => { await settingsService.set(sPatch); r.settingsCopied += Object.keys(sPatch).length; });
    for (const step of steps) {
      try { await step(); } catch (err) {
        if (err instanceof ApiError && err.status === 401) { r.stopped = 'auth'; break; }
        if (err instanceof ApiError && err.status === 0) { r.stopped = 'network'; break; }
        r.failed++; // e.g. validation: leave it in the browser, keep going
      }
    }
    return r;
  } finally { running = false; }
}
export const importAvailable = () => api.useBackend('evidence') && api.useBackend('assessments');
