import { ApiError } from '../services/api';
import type { Evidence } from '../types';

// Evidence the user can still link to a skill: their OWN items (never demo examples) that are not already linked to it.
export const linkableEvidence = (items: Evidence[] | null, skillId: string): Evidence[] =>
  (items ?? []).filter((e) => e.source === 'user' && !e.skillIds.includes(skillId)).sort((a, b) => a.title.localeCompare(b.title));

// Re-fetch key for analysis: includes the linked skills, because linking/unlinking changes readiness without necessarily changing `updatedAt`.
export const evidenceKey = (items: Evidence[]): string => items.map((e) => `${e.id}:${e.updatedAt}:${[...e.skillIds].sort().join('|')}`).join(',');

// Plain-language outcome of a failed link/unlink. `gone` = the item or link no longer exists, so the list should be reloaded.
export function linkError(e: unknown, link: boolean): { message: string; gone: boolean } {
  const verb = link ? 'link' : 'unlink';
  if (!(e instanceof ApiError)) return { message: `Couldn't ${verb} that evidence. Please try again.`, gone: false };
  switch (e.code) {
    case 'timeout': return { message: `The server took too long to answer. The change may or may not have been saved, so the list has been refreshed. Check it and try again if needed.`, gone: true };
    case 'network_error': return { message: `Couldn't reach the server, so nothing was changed. Check your connection and try again.`, gone: false };
    case 'conflict': return { message: 'That evidence is already linked to this skill.', gone: true };
    case 'evidence_not_found': return { message: 'That evidence no longer exists. The list has been refreshed.', gone: true };
    case 'link_not_found': return { message: 'That evidence was not linked to this skill. The list has been refreshed.', gone: true };
    case 'skill_not_found': return { message: "That skill isn't part of your account's careers any more.", gone: false };
    case 'token_expired': case 'invalid_token': case 'token_missing': return { message: 'Your session has ended. Please sign in again.', gone: false };
    default: return { message: e.status >= 500 ? `The server had a problem, so the evidence was not ${link ? 'linked' : 'unlinked'}. Please try again.` : `Couldn't ${verb} that evidence. Please try again.`, gone: false };
  }
}
