import type { Profile, UserSettings } from '../types';
import type { ActionStore } from '../utils/actions';

// Pure comparison of data saved in this browser (legacy) with what the signed-in account already has on the server.
// Nothing here writes. "fill" = the account has nothing yet, so copying cannot overwrite anything. "conflict" = both sides have a different value:
// the user must choose; the default is always to keep the account's value.
export type Choice = 'server' | 'browser';
export interface FieldDiff { field: string; label: string; browser: string; account: string }
export interface ProfileDiff { fill: Partial<Profile>; fillLabels: string[]; conflicts: FieldDiff[] }
export interface ProgressDiff { careerId: string; fill: { actionId: string; status: 'in_progress' | 'completed' }[]; conflicts: { actionId: string; title: string; browser: string; account: string }[] }
export interface SettingsDiff { fill: Partial<UserSettings>; conflicts: FieldDiff[] }

const has = (v: string | null | undefined) => (v ?? '').trim() !== '';
const FIELDS: { key: 'stage' | 'experienceLevel' | 'experienceSummary' | 'education' | 'targetCareerId'; label: string }[] = [
  { key: 'targetCareerId', label: 'Target career' }, { key: 'experienceLevel', label: 'Experience level' }, { key: 'stage', label: 'Career stage' },
  { key: 'experienceSummary', label: 'Experience summary' }, { key: 'education', label: 'Education' },
];

// `accountIsNew`: the account's profile has never been completed, so its experience level (a default of "beginner") is not a real answer.
export function diffProfile(browser: Profile, account: Profile, canUseTarget: (id: string) => boolean): ProfileDiff {
  const fill: Partial<Profile> = {}, fillLabels: string[] = [], conflicts: FieldDiff[] = [];
  const accountIsNew = !account.onboardingComplete;
  for (const { key, label } of FIELDS) {
    const b = String(browser[key] ?? ''), a = String(account[key] ?? '');
    if (!has(b)) continue;
    if (key === 'targetCareerId' && !canUseTarget(b)) continue; // a browser-only career cannot be a target until it has been copied to the account
    if (!has(a) || (accountIsNew && key === 'experienceLevel')) { if (b !== a) { (fill as Record<string, string>)[key] = b; fillLabels.push(label); } }
    else if (a !== b) conflicts.push({ field: key, label, browser: b, account: a });
  }
  if (browser.onboardingComplete && accountIsNew && fillLabels.length) { fill.onboardingComplete = true; fill.completeness = browser.completeness; }
  return { fill, fillLabels, conflicts };
}

export function diffProgress(careerId: string, browser: ActionStore, account: ActionStore): ProgressDiff {
  const out: ProgressDiff = { careerId, fill: [], conflicts: [] };
  for (const [id, b] of Object.entries(browser)) {
    if (b.status === 'not_started') continue;
    const a = account[id];
    if (!a) out.fill.push({ actionId: id, status: b.status as 'in_progress' | 'completed' });
    else if (a.status !== b.status) out.conflicts.push({ actionId: id, title: b.action.title, browser: b.status, account: a.status });
  }
  return out;
}

// `accountSaved`: the server has settings the user saved (updatedAt set). Defaults the user never chose are not a conflict.
export function diffSettings(browser: UserSettings | null, account: UserSettings, accountSaved: boolean): SettingsDiff {
  const out: SettingsDiff = { fill: {}, conflicts: [] };
  if (!browser) return out;
  for (const [k, label] of [['reduceMotion', 'Reduce motion'], ['assistantSuggestions', 'Assistant suggested questions']] as const) {
    if (browser[k] === account[k]) continue;
    if (!accountSaved) out.fill[k] = browser[k];
    else out.conflicts.push({ field: k, label, browser: browser[k] ? 'On' : 'Off', account: account[k] ? 'On' : 'Off' });
  }
  return out;
}
