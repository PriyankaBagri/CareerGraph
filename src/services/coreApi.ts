// Typed client for the Backend Stage 3 endpoints (careers, skill assessments, evidence). NOT wired into the UI yet: no screen calls
// these, and BACKEND_FEATURES.careers stays false, so the app still runs entirely on local data. They exist so a later step can
// migrate one feature at a time. `VITE_API_URL` already ends in /api, so paths here start at /careers etc.
import type { ActionGuidance, Career, CareerSummary, Evidence, EvidenceInput, EvidenceStrength, EvidenceType } from '../types';
import { api } from './api';

export interface ApiCareerModel {
  career: CareerSummary & { evidenceExpectations: string[]; evaluationRules?: Record<string, unknown> | null };
  capabilities: { id: string; careerId: string; name: string; description: string; position: number }[];
  skills: { id: string; name: string; description: string; category: string | null }[];
  requirements: { careerId: string; skillId: string; capabilityId: string; requiredLevel: number; importance: number; position: number; minEvidence?: number | null }[];
}
export interface ApiAssessment { skillId: string; assessed: boolean; level: number | null; source: string | null; assessedAt: string | null; updatedAt: string | null }
export interface ApiProvenance { origin: 'user_provided' | 'system_derived'; verification: { status: 'unverified' | 'verified' }; label: string }
export interface ApiEvidence { provenance?: ApiProvenance; id: string; title: string; description: string; type: EvidenceType; url: string | null; date: string | null; organization: string | null; strength: EvidenceStrength; source: string; skillIds: string[]; createdAt: string; updatedAt: string }
export interface ApiEvidenceInput { title: string; description: string; type: EvidenceType; strength: EvidenceStrength; url?: string | null; date?: string | null; organization?: string | null; skillIds?: string[] }

// API model -> the frontend's existing Career shape. currentLevel is 0 here because the career model carries requirements only;
// the caller overlays the user's assessments (an unassessed skill has no entry, it is NOT level 0).
export function toCareer(m: ApiCareerModel, assessments: Record<string, number> = {}): Career {
  const skillName = new Map(m.skills.map((s) => [s.id, s.name]));
  const skillDesc = new Map(m.skills.map((s) => [s.id, s.description]));
  return {
    id: m.career.id, name: m.career.name, category: m.career.category, description: m.career.description, evidenceExpectations: m.career.evidenceExpectations,
    origin: { source: m.career.source as CareerSummary['source'] },
    capabilities: [...m.capabilities].sort((a, b) => a.position - b.position).map((cap) => ({
      id: cap.id, name: cap.name, description: cap.description || undefined,
      skills: m.requirements.filter((r) => r.capabilityId === cap.id).sort((a, b) => a.position - b.position)
        .map((r) => ({ id: r.skillId, name: skillName.get(r.skillId) ?? r.skillId, description: skillDesc.get(r.skillId) || undefined, currentLevel: assessments[r.skillId] ?? 0, requiredLevel: r.requiredLevel, evidenceIds: [] })),
    })),
  };
}

// Frontend Career -> request body for POST/PUT /careers. Ids are never sent for new items (the server assigns them); `keep` maps names of skills/capabilities
// that already exist on the server to their ids so an edit or regeneration keeps the user's ratings and evidence links for unchanged skills.
export interface ApiCareerInput { name: string; category: string; description: string; evidenceExpectations: string[]; capabilities: { id?: string; name: string; description: string; skills: { id?: string; name: string; requiredLevel: number; importance: number; minEvidence?: number | null; description?: string }[] }[]; evaluationRules?: Record<string, unknown> | null }
export function toApiCareerInput(c: Career, existing?: ApiCareerModel): ApiCareerInput {
  const norm = (x: string) => x.trim().toLowerCase();
  const capByName = new Map((existing?.capabilities ?? []).map((k) => [norm(k.name), k.id]));
  const skillByName = new Map((existing?.skills ?? []).map((k) => [norm(k.name), k.id]));
  const descById = new Map((existing?.skills ?? []).map((k) => [k.id, k.description]));
  const usedCaps = new Set<string>(), usedSkills = new Set<string>();
  // An update through this path (for example re-analysing a career with the same name) must not lose what the user already set on matching skills.
  const prior = new Map((existing?.requirements ?? []).map((r) => [r.skillId, r]));
  const claim = (m: Map<string, string>, used: Set<string>, name: string) => { const id = m.get(norm(name)); if (!id || used.has(id)) return undefined; used.add(id); return id; };
  return {
    name: c.name.trim().slice(0, 120), category: (c.category || 'Other').trim().slice(0, 60), description: (c.description ?? '').slice(0, 1000),
    evidenceExpectations: (c.evidenceExpectations ?? []).filter((e) => e.trim()).map((e) => e.slice(0, 200)).slice(0, 10),
    capabilities: c.capabilities.slice(0, 12).map((k) => ({
      id: claim(capByName, usedCaps, k.name), name: k.name.slice(0, 100), description: (k.description ?? '').slice(0, 500),
      skills: k.skills.slice(0, 12).map((sk) => ({ id: claim(skillByName, usedSkills, sk.name), name: sk.name.slice(0, 100), requiredLevel: Math.min(5, Math.max(1, Math.round(sk.requiredLevel))), importance: 3, description: (sk.description ?? '').slice(0, 600) })).map((sk) => { const p = sk.id ? prior.get(sk.id) : undefined; if (!sk.description && sk.id) sk = { ...sk, description: (descById.get(sk.id) ?? '').slice(0, 600) }; return p ? { ...sk, importance: p.importance, minEvidence: p.minEvidence ?? null } : sk; }),
    })),
    ...(existing?.career.evaluationRules ? { evaluationRules: existing.career.evaluationRules } : {}),
  };
}

// ---- Stage 4 analysis responses (server/src/domain/readiness.ts) ----
export interface ApiSkillBreakdown {
  skillId: string; name: string; capabilityId: string; capabilityName: string; requiredLevel: number; importance: number; assessed: boolean; currentLevel: number | null;
  status: 'meets' | 'below' | 'unassessed'; gap: number | null; evidenceCount: number; evidenceRequired?: number | null; evidencePoints: number; evidenceRatio: number; evidenceStatus: 'none' | 'thin' | 'sufficient';
  levelRatio: number | null; skillScore: number | null; weightShare: number | null; contribution: number | null;
}
export interface ApiCounts { total: number; assessed: number; unassessed: number; meets: number; below: number }
export interface ApiEvaluation { source: 'default' | 'custom'; description: string; rules: { levelWeight: number; evidenceFullFactor: number; evidenceThinBelow: number; strengthPoints?: Record<string, number> } }
export interface ApiReadiness { evaluation?: ApiEvaluation; careerId: string; careerName: string; state: 'not_assessed' | 'partial' | 'assessed' | 'no_requirements'; score: number | null; range: { min: number; max: number } | null; counts: ApiCounts; weights: { total: number; assessed: number; assessedShare: number }; skills: ApiSkillBreakdown[]; caveats: string[]; formula: string }
export interface ApiGaps { careerId: string; counts: ApiCounts; below: (ApiSkillBreakdown & { weightedGap: number })[]; unassessed: ApiSkillBreakdown[]; meets: ApiSkillBreakdown[]; caveats: string[] }
export interface ApiAction { id: string; rank: number; type: 'build_skill' | 'assess_skill' | 'add_evidence'; skillId: string; skillName: string; capabilityId: string; capabilityName: string; priority: 'high' | 'medium' | 'low'; priorityScore: number; reason: string; recommendation: string; currentLevel: number | null; targetLevel: number; completionCriterion: string; guidance?: ActionGuidance }
export interface ApiActions { careerId: string; careerName: string; actions: ApiAction[]; note: string; priorityCriteria?: string; evidenceExpectations?: string[] }

// ---- evidence mapping (explicit; null <-> undefined only) ----
export const toEvidence = (e: ApiEvidence, userId?: string): Evidence => ({
  id: e.id, userId, title: e.title, description: e.description, type: e.type, strength: e.strength, skillIds: [...e.skillIds],
  url: e.url ?? undefined, date: e.date ?? undefined, organization: e.organization ?? undefined, source: 'user',
  provenance: e.provenance ? { origin: e.provenance.origin, verification: e.provenance.verification.status, label: e.provenance.label } : undefined, createdAt: e.createdAt, updatedAt: e.updatedAt,
});
// Optional fields the user cleared are sent as null so the server clears them; absent would mean "unchanged".
export const toApiEvidenceInput = (i: EvidenceInput): ApiEvidenceInput => ({ title: i.title, description: i.description, type: i.type, strength: i.strength, url: i.url ?? null, date: i.date ?? null, organization: i.organization ?? null, skillIds: i.skillIds });

const seg = encodeURIComponent;
export interface ApiProfile { userId: string; name: string; email: string; targetCareerId: string | null; experienceSummary: string | null; educationSummary: string | null; aboutNote: string | null; stage: string; experienceLevel: string; onboardingComplete: boolean; completeness: number; createdAt: string; updatedAt: string }
export interface ApiProfilePatch { stage?: string; experienceLevel?: string; onboardingComplete?: boolean; completeness?: number; targetCareerId?: string | null; experienceSummary?: string | null; educationSummary?: string | null }
export interface ApiActionSnapshot { title: string; description: string; type: string; phase: string; priority: string; priorityScore: number; impact: string; effort: string; estimatedTime: string; reason: string; prerequisites: string[]; relatedSkillIds: string[]; relatedCapabilityIds: string[]; createdAt: string }
export interface ApiProgress { actionKey: string; careerId: string; status: 'in_progress' | 'completed'; updatedAt: string; completedAt: string | null; snapshot: ApiActionSnapshot }
export interface ApiSettings { reduceMotion: boolean; assistantSuggestions: boolean; updatedAt: string | null }

// GET /careers/:id/graph. The dashboard graph is assembled from the same readiness, evidence and action responses; tests check the two agree.
export interface ApiGraphNode { id: string; kind: 'career' | 'capability' | 'skill' | 'evidence' | 'action'; label: string; data: Record<string, unknown> }
export interface ApiGraph { careerId: string; careerName: string; readiness: { state: string; score: number | null }; nodes: ApiGraphNode[]; links: { source: string; target: string; kind: 'contains' | 'supports' | 'addresses' }[]; summary: Record<string, number>; notes: string[] }
export const coreApi = {
  getProfile: () => api.get<ApiProfile>('/profile'),
  putProfile: (patch: ApiProfilePatch) => api.put<ApiProfile>('/profile', patch),
  listProgress: async (careerId: string) => (await api.get<{ items: ApiProgress[] }>(`/careers/${seg(careerId)}/action-progress`)).items,
  putProgress: (careerId: string, actionKey: string, status: 'in_progress' | 'completed', action: Omit<ApiActionSnapshot, 'createdAt'>) => api.put<ApiProgress>(`/careers/${seg(careerId)}/action-progress/${seg(actionKey)}`, { status, action }),
  clearProgress: (careerId: string, actionKey: string) => api.request<void>('DELETE', `/careers/${seg(careerId)}/action-progress/${seg(actionKey)}`),
  getSettings: () => api.get<ApiSettings>('/settings'),
  putSettings: (patch: { reduceMotion?: boolean; assistantSuggestions?: boolean }) => api.put<ApiSettings>('/settings', patch),
  listCareers: async () => (await api.get<{ careers: CareerSummary[] }>('/careers')).careers,
  createCareer: (input: ApiCareerInput) => api.post<ApiCareerModel>('/careers', input),
  updateCareer: (id: string, input: ApiCareerInput) => api.put<ApiCareerModel>(`/careers/${seg(id)}`, input),
  deleteCareer: (id: string) => api.request<void>('DELETE', `/careers/${seg(id)}`),
  getCareer: (id: string) => api.get<ApiCareerModel>(`/careers/${seg(id)}`),
  listSkillAssessments: async () => (await api.get<{ skills: ApiAssessment[] }>('/me/skills')).skills,
  getSkillAssessment: (skillId: string) => api.get<ApiAssessment>(`/me/skills/${seg(skillId)}`),
  setSkillAssessment: (skillId: string, level: number) => api.put<ApiAssessment>(`/me/skills/${seg(skillId)}`, { level }),
  clearSkillAssessment: (skillId: string) => api.request<void>('DELETE', `/me/skills/${seg(skillId)}`),
  // The server pages this list (newest first, up to 200 per page). Read every page so a long list is never silently cut short.
  listEvidence: async (): Promise<ApiEvidence[]> => {
    const out: ApiEvidence[] = [];
    for (;;) {
      const page = await api.get<{ evidence: ApiEvidence[]; total?: number }>(`/evidence?limit=200&offset=${out.length}`);
      out.push(...page.evidence);
      if (page.evidence.length === 0 || out.length >= (page.total ?? out.length)) return out;
    }
  },
  getEvidence: (id: string) => api.get<ApiEvidence>(`/evidence/${seg(id)}`),
  createEvidence: (input: ApiEvidenceInput) => api.post<ApiEvidence>('/evidence', input),
  updateEvidence: (id: string, patch: Partial<ApiEvidenceInput>) => api.put<ApiEvidence>(`/evidence/${seg(id)}`, patch),
  deleteEvidence: (id: string) => api.request<void>('DELETE', `/evidence/${seg(id)}`),
  linkEvidenceSkill: (evidenceId: string, skillId: string) => api.post<ApiEvidence>(`/evidence/${seg(evidenceId)}/skills/${seg(skillId)}`),
  getReadiness: (careerId: string) => api.get<ApiReadiness>(`/careers/${seg(careerId)}/readiness`),
  getGaps: (careerId: string) => api.get<ApiGaps>(`/careers/${seg(careerId)}/gaps`),
  getGraph: (careerId: string) => api.get<ApiGraph>(`/careers/${seg(careerId)}/graph`),
  getActions: (careerId: string, limit = 10) => api.get<ApiActions>(`/careers/${seg(careerId)}/actions?limit=${limit}`),
  unlinkEvidenceSkill: (evidenceId: string, skillId: string) => api.request<ApiEvidence>('DELETE', `/evidence/${seg(evidenceId)}/skills/${seg(skillId)}`),
};
