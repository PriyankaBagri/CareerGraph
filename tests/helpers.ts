// Test helpers. No framework beyond node:test; `tsx` runs the TypeScript directly.
import type { CareerDataset, Evidence, EvidenceStrength } from '../src/types';
import { CAREER_DATASETS } from '../src/data/careers';
import { careerIntelligenceService } from '../src/services/careerIntelligence';
import { readinessService } from '../src/services/readiness';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), keys: () => [...m.keys()], get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null }; };
export type Mem = ReturnType<typeof memory>;
export function resetStorage() { Object.assign(globalThis, { localStorage: memory(), sessionStorage: memory() }); }
export const store = () => (globalThis as unknown as { localStorage: Mem }).localStorage;

export const seed = (id: string): CareerDataset => { const d = CAREER_DATASETS.find((x) => x.career.id === id); if (!d) throw new Error(`no seed ${id}`); return d; };
export const generate = async (name: string, description?: string): Promise<CareerDataset> => ({ career: await careerIntelligenceService.generateCareerModel({ name, description }), evidence: [] });
export const ev = (id: string, skillIds: string[], strength: EvidenceStrength = 'strong'): Evidence => ({ id, title: id, description: 'd', type: 'Project', skillIds, strength, source: 'user', createdAt: '', updatedAt: '' });
// Real user path: unassessed skills start at 0, no example evidence.
export const analyze = (ds: CareerDataset, levels: Record<string, number> = {}, userEvidence: Evidence[] = []) => readinessService.analyze(ds, levels, { includeExampleEvidence: false, userEvidence, unassessedLevel: 0 });
// Rate every skill of a career (a fully assessed user).
export const rateAll = (ds: CareerDataset, level = 2): Record<string, number> => Object.fromEntries(ds.career.capabilities.flatMap((c) => c.skills.map((s) => [s.id, level])));
export const skillOf = (v: ReturnType<typeof analyze>, id: string) => { const s = v.skills.find((x) => x.skillId === id); if (!s) throw new Error(`no skill ${id}`); return s; };
