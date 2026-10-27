import { randomUUID } from 'node:crypto';
import { CAREER_DATASETS } from '../domain/shared';
import type { AssessmentRecord, CareerModelRecord, CoreRepos, CustomCareerInput, EvidenceRecord } from './core-types';

// In-memory CoreRepos for tests. Mirrors the PostgreSQL behaviour: shared seeded careers, user-scoped assessments/evidence,
// unique evidence<->skill links, cascade on evidence delete.
export function createMemoryCoreRepos(now: () => Date = () => new Date()): CoreRepos & { evidence: Map<string, EvidenceRecord & { userId: string }>; assessments: Map<string, AssessmentRecord & { userId: string }> } {
  const models = new Map<string, CareerModelRecord>();
  for (const { career } of CAREER_DATASETS) {
    const m: CareerModelRecord = { career: { id: career.id, name: career.name, category: career.category, description: career.description, source: 'seed', evidenceExpectations: career.evidenceExpectations ?? [] }, capabilities: [], skills: [], requirements: [] };
    career.capabilities.forEach((cap, ci) => {
      m.capabilities.push({ id: cap.id, careerId: career.id, name: cap.name, description: cap.description ?? '', position: ci });
      cap.skills.forEach((s, si) => {
        m.skills.push({ id: s.id, name: s.name, description: '', category: cap.name });
        m.requirements.push({ careerId: career.id, skillId: s.id, capabilityId: cap.id, requiredLevel: s.requiredLevel, importance: 3, position: ci * 100 + si });
      });
    });
    models.set(career.id, m);
  }
  const owners = new Map<string, string>(); // custom careerId -> owner userId (seeded careers have no entry)
  const visible = (userId: string, id: string) => !owners.has(id) || owners.get(id) === userId;
  const build = (careerId: string, input: CustomCareerInput): CareerModelRecord => {
    const m: CareerModelRecord = { career: { id: careerId, name: input.name, category: input.category, description: input.description, source: 'custom', evidenceExpectations: [...input.evidenceExpectations], evaluationRules: input.evaluationRules ?? null }, capabilities: [], skills: [], requirements: [] };
    let pos = 0;
    input.capabilities.forEach((cap, ci) => { m.capabilities.push({ id: cap.id as string, careerId, name: cap.name, description: cap.description, position: ci }); for (const sk of cap.skills) { m.skills.push({ id: sk.id as string, name: sk.name, description: sk.description ?? '', category: cap.name }); m.requirements.push({ careerId, skillId: sk.id as string, capabilityId: cap.id as string, requiredLevel: sk.requiredLevel, importance: sk.importance, position: pos++, minEvidence: sk.minEvidence ?? null }); } });
    return m;
  };
  const evidence = new Map<string, EvidenceRecord & { userId: string }>();
  const assessments = new Map<string, AssessmentRecord & { userId: string }>();
  const copy = (e: EvidenceRecord & { userId: string }): EvidenceRecord => { const { userId: _u, ...rest } = e; return { ...rest, skillIds: [...rest.skillIds].sort() }; };
  const own = (userId: string, id: string) => { const e = evidence.get(id); return e && e.userId === userId ? e : undefined; };
  const t = () => now().toISOString();
  return {
    evidence, assessments,
    async createCustomCareer(userId, careerId, input) { models.set(careerId, build(careerId, input)); owners.set(careerId, userId); },
    async updateCustomCareer(userId, careerId, input) {
      if (owners.get(careerId) !== userId) return false;
      const old = models.get(careerId); const next = build(careerId, input); const keep = new Set(next.skills.map((x) => x.id));
      for (const sk of old?.skills ?? []) if (!keep.has(sk.id)) { for (const k of [...assessments.keys()]) if (k.endsWith(`|${sk.id}`)) assessments.delete(k); for (const e of evidence.values()) e.skillIds = e.skillIds.filter((x) => x !== sk.id); }
      models.set(careerId, next); return true;
    },
    async deleteCustomCareer(userId, careerId) {
      if (owners.get(careerId) !== userId) return false;
      for (const sk of models.get(careerId)?.skills ?? []) { for (const k of [...assessments.keys()]) if (k.endsWith(`|${sk.id}`)) assessments.delete(k); for (const e of evidence.values()) e.skillIds = e.skillIds.filter((x) => x !== sk.id); }
      models.delete(careerId); owners.delete(careerId); return true;
    },
    async listCareers(userId) { return [...models.values()].filter((m) => visible(userId, m.career.id)).map((m) => ({ id: m.career.id, name: m.career.name, category: m.career.category, description: m.career.description, source: m.career.source })); },
    async getCareerModel(userId, id) { const m = models.get(id); return m && visible(userId, id) ? structuredClone(m) : null; },
    async visibleSkillIds(userId, ids) { const ok = new Set<string>(); for (const m of models.values()) if (visible(userId, m.career.id)) for (const sk of m.skills) ok.add(sk.id); return ids.filter((i) => ok.has(i)); },
    async listAssessments(userId) { return [...assessments.values()].filter((a) => a.userId === userId).map(({ userId: _x, ...a }) => a).sort((a, b) => a.skillId.localeCompare(b.skillId)); },
    async getAssessment(userId, skillId) { const a = assessments.get(`${userId}|${skillId}`); if (!a) return null; const { userId: _x, ...rest } = a; return rest; },
    async upsertAssessment(userId, skillId, level, source) {
      const k = `${userId}|${skillId}`, prev = assessments.get(k);
      const rec = { userId, skillId, level, source, assessedAt: prev?.assessedAt ?? t(), updatedAt: t() };
      assessments.set(k, rec); const { userId: _x, ...rest } = rec; return rest;
    },
    async deleteAssessment(userId, skillId) { return assessments.delete(`${userId}|${skillId}`); },
    async listEvidence(userId) { return [...evidence.values()].filter((e) => e.userId === userId).map(copy).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async getEvidence(userId, id) { const e = own(userId, id); return e ? copy(e) : null; },
    async createEvidence(userId, i) {
      const rec = { id: randomUUID(), userId, title: i.title, description: i.description, type: i.type, url: i.url, date: i.date, organization: i.organization, strength: i.strength, source: 'user', skillIds: [...new Set(i.skillIds)], createdAt: t(), updatedAt: t() };
      evidence.set(rec.id, rec); return copy(rec);
    },
    async updateEvidence(userId, id, patch) {
      const e = own(userId, id); if (!e) return null;
      const { skillIds, ...fields } = patch;
      Object.assign(e, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
      if (skillIds) e.skillIds = [...new Set(skillIds)];
      e.updatedAt = t(); return copy(e);
    },
    async deleteEvidence(userId, id) { return own(userId, id) ? evidence.delete(id) : false; },
    async linkEvidenceSkill(userId, evidenceId, skillId) { const e = own(userId, evidenceId); if (!e || e.skillIds.includes(skillId)) return false; e.skillIds.push(skillId); e.updatedAt = t(); return true; },
    async unlinkEvidenceSkill(userId, evidenceId, skillId) { const e = own(userId, evidenceId); if (!e || !e.skillIds.includes(skillId)) return false; e.skillIds = e.skillIds.filter((x) => x !== skillId); return true; },
  };
}
