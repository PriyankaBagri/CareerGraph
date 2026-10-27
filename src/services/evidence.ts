import type { Evidence, EvidenceInput } from '../types';
import { api, mockDelay } from './api';
import { coreApi, toApiEvidenceInput, toEvidence } from './coreApi';
import { authService } from './auth';

// MOCK persistence, scoped to the signed-in user. For REST, replace bodies; keep signatures.
const key = (userId: string) => `careergraph:user:${userId}:evidence`;
function currentUserId(): string {
  const u = authService.getCurrentUser();
  if (!u) throw new Error('Not signed in');
  return u.id;
}
const load = (userId: string): Evidence[] => { try { const v = localStorage.getItem(key(userId)); return v ? (JSON.parse(v) as Evidence[]) : []; } catch { return []; } };
const save = (userId: string, list: Evidence[]) => localStorage.setItem(key(userId), JSON.stringify(list));

const useRemote = () => api.useBackend('evidence');
export const evidenceService = {
  // Read-only look at evidence stored in THIS browser for the signed-in user (used by the explicit "copy to my account" import). Never writes.
  peekLocalEvidence(): Evidence[] { return load(currentUserId()); },
  async getEvidence(): Promise<Evidence[]> { if (useRemote()) { const uid = currentUserId(); return (await coreApi.listEvidence()).map((e) => toEvidence(e, uid)); } return mockDelay(load(currentUserId()), 150); },
  async getEvidenceById(id: string): Promise<Evidence> {
    if (useRemote()) return toEvidence(await coreApi.getEvidence(id), currentUserId());
    const e = load(currentUserId()).find((x) => x.id === id);
    if (!e) throw new Error('Evidence not found');
    return mockDelay(e, 100);
  },
  // Link or unlink ONE skill on an existing evidence item. Backend mode uses the dedicated, ownership-checked endpoints; local mode rewrites the stored item.
  async setSkillLink(e: Evidence, skillId: string, link: boolean): Promise<Evidence> {
    if (useRemote()) { const uid = currentUserId(); return toEvidence(link ? await coreApi.linkEvidenceSkill(e.id, skillId) : await coreApi.unlinkEvidenceSkill(e.id, skillId), uid); }
    const skillIds = link ? [...new Set([...e.skillIds, skillId])] : e.skillIds.filter((x) => x !== skillId);
    return evidenceService.updateEvidence(e.id, { title: e.title, description: e.description, type: e.type, url: e.url, date: e.date, organization: e.organization, strength: e.strength, skillIds });
  },
  async createEvidence(input: EvidenceInput): Promise<Evidence> {
    if (useRemote()) return toEvidence(await coreApi.createEvidence(toApiEvidenceInput(input)), currentUserId());
    const userId = currentUserId();
    const now = new Date().toISOString();
    const e: Evidence = { ...input, id: `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, userId, source: 'user', createdAt: now, updatedAt: now };
    save(userId, [e, ...load(userId)]);
    return mockDelay(e, 200);
  },
  async updateEvidence(id: string, input: EvidenceInput): Promise<Evidence> {
    if (useRemote()) return toEvidence(await coreApi.updateEvidence(id, toApiEvidenceInput(input)), currentUserId());
    const userId = currentUserId();
    const list = load(userId);
    const cur = list.find((x) => x.id === id);
    if (!cur) throw new Error('Evidence not found');
    const next: Evidence = { ...cur, ...input, updatedAt: new Date().toISOString() };
    save(userId, list.map((x) => (x.id === id ? next : x)));
    return mockDelay(next, 200);
  },
  async deleteEvidence(id: string): Promise<void> {
    if (useRemote()) { await coreApi.deleteEvidence(id); return; }
    const userId = currentUserId();
    save(userId, load(userId).filter((x) => x.id !== id));
    await mockDelay(null, 150);
  },
};
