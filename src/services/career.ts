import { CAREER_DATASETS } from '../data/careers';
import type { Career, CareerDataset, CareerSummary } from '../types';
import { api, mockDelay } from './api';
import { coreApi, toApiCareerInput, toCareer } from './coreApi';
import { authService } from './auth';

// Seed careers are bundled demo data. Custom careers are stored per user (MOCK persistence; REST later).
// Both are normalized to the same Career shape, so nothing downstream cares where a career came from.
const key = (userId: string) => `careergraph:user:${userId}:custom-careers`;
const loadCustom = (): Career[] => {
  const u = authService.getCurrentUser();
  if (!u) return [];
  try { const v = localStorage.getItem(key(u.id)); return v ? (JSON.parse(v) as Career[]) : []; } catch { return []; }
};
const summary = (c: Career): CareerSummary => ({ id: c.id, name: c.name, category: c.category, description: c.description, source: c.origin?.source ?? 'seed' });

export const careerService = {
  // Custom (generated/user-made) careers exist only in this browser until a later stage; they are analysed locally.
  // Read-only look at careers saved in THIS browser for the signed-in user (used by the explicit "copy to my account" import).
  peekLocalCustom(): Career[] { return loadCustom(); },
  isLocalCustom(id: string): boolean { return loadCustom().some((c) => c.id === id); },
  async list(): Promise<CareerSummary[]> {
    // Backend careers (seeded + the user's own) plus this browser's local custom careers, which the server does not know yet.
    if (api.useBackend('careers')) { const remote = await coreApi.listCareers(); const ids = new Set(remote.map((c) => c.id)); return [...remote, ...loadCustom().filter((c) => !ids.has(c.id)).map(summary)]; }
    return mockDelay([...CAREER_DATASETS.map((d) => summary(d.career)), ...loadCustom().map(summary)], 100);
  },
  async getDataset(id: string): Promise<CareerDataset> {
    if (api.useBackend('careers') && !careerService.isLocalCustom(id)) return { career: toCareer(await coreApi.getCareer(id)), evidence: [] }; // levels/evidence come from their own endpoints
    const seed = CAREER_DATASETS.find((x) => x.career.id === id);
    if (seed) return mockDelay(structuredClone(seed));
    const custom = loadCustom().find((c) => c.id === id);
    if (!custom) throw new Error('Career not found');
    return mockDelay({ career: structuredClone(custom), evidence: [] }); // custom careers carry no example evidence
  },
  // Backend mode: the career is saved to the signed-in user's account (the server assigns the id and enforces ownership). A career with the same
  // name that the user already owns is UPDATED in place, keeping ratings and evidence links for skills whose names are unchanged.
  // Local mode (no backend configured): stored in this browser, as before. The RETURNED career carries the id to use from then on.
  async saveCustomCareer(career: Career): Promise<Career> {
    if (api.useBackend('careers')) {
      const mine = (await coreApi.listCareers()).find((c) => c.source !== 'seed' && c.name.trim().toLowerCase() === career.name.trim().toLowerCase());
      if (mine) { const existing = await coreApi.getCareer(mine.id); return toCareer(await coreApi.updateCareer(mine.id, toApiCareerInput(career, existing))); }
      return toCareer(await coreApi.createCareer(toApiCareerInput(career)));
    }
    const u = authService.getCurrentUser();
    if (!u) throw new Error('Not signed in');
    localStorage.setItem(key(u.id), JSON.stringify([career, ...loadCustom().filter((c) => c.id !== career.id)]));
    return mockDelay(career, 150);
  },
  // Removes a custom career. Backend mode: server-side and owner-only (its skills' ratings and links go with it; evidence is kept). Local careers: this browser only.
  async deleteCustomCareer(id: string): Promise<void> {
    const local = careerService.isLocalCustom(id);
    if (!local && api.useBackend('careers')) { await coreApi.deleteCareer(id); return; }
    const u = authService.getCurrentUser();
    if (!u) throw new Error('Not signed in');
    localStorage.setItem(key(u.id), JSON.stringify(loadCustom().filter((c) => c.id !== id)));
  },
};
