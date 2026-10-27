import { provenanceOf } from '../domain/provenance';
import { AppError, conflict, notFound } from '../errors';
import { randomBytes } from 'node:crypto';
import type { AssessmentRecord, CareerModelRecord, CoreRepos, CustomCareerInput, EvidenceInput, EvidencePatch, EvidenceRecord } from '../repositories/core-types';
import { ValidationError } from '../validation';

// Same vocabulary as the frontend (src/types/index.ts). Do not change one without the other.
export const EVIDENCE_TYPES = ['Project', 'Internship', 'Work Experience', 'Certification', 'Course', 'Publication', 'Research', 'Assessment', 'Competition', 'Achievement', 'Volunteer Work', 'Portfolio', 'Case Study', 'Other'] as const;
export const EVIDENCE_STRENGTHS = ['weak', 'moderate', 'strong', 'very_strong'] as const;
export const SKILL_LEVEL_MIN = 0, SKILL_LEVEL_MAX = 5;

// Stable DTOs (no table/column names leak out).
export const assessmentView = (a: AssessmentRecord) => ({ skillId: a.skillId, assessed: true, level: a.level, source: a.source, assessedAt: a.assessedAt, updatedAt: a.updatedAt });
export const unassessedView = (skillId: string) => ({ skillId, assessed: false, level: null, source: null, assessedAt: null, updatedAt: null });
export const MAX_EVIDENCE_PER_USER = 500, MAX_EVIDENCE_PAGE = 200;
export const evidenceView = (e: EvidenceRecord) => ({ provenance: provenanceOf(e), id: e.id, title: e.title, description: e.description, type: e.type, url: e.url, date: e.date, organization: e.organization, strength: e.strength, source: e.source, skillIds: e.skillIds, createdAt: e.createdAt, updatedAt: e.updatedAt });

export class CoreService {
  constructor(private readonly repos: CoreRepos) {}

  listCareers(userId: string) { return this.repos.listCareers(userId).then((careers) => ({ careers })); }
  // Custom careers. The owner comes from the verified token; ids are generated here and never taken from the client except to KEEP
  // an existing id of the same career on update (so ratings and evidence links survive an edit).
  async createCareer(userId: string, input: CustomCareerInput) {
    const careerId = `cx-${randomBytes(6).toString('hex')}`;
    await this.repos.createCustomCareer(userId, careerId, this.withIds(careerId, input));
    return this.model(userId, careerId);
  }
  async updateCareer(userId: string, careerId: string, input: CustomCareerInput) {
    if (!(await this.repos.updateCustomCareer(userId, careerId, this.withIds(careerId, input)))) throw notFound('Career not found.', 'career_not_found'); // seeded, someone else's and missing look the same
    return this.model(userId, careerId);
  }
  async deleteCareer(userId: string, careerId: string) { if (!(await this.repos.deleteCustomCareer(userId, careerId))) throw notFound('Career not found.', 'career_not_found'); }
  private withIds(careerId: string, input: CustomCareerInput): CustomCareerInput {
    const prefix = `${careerId}:`; const used = new Set<string>();
    // Random, never a counter: a new skill must not reuse the id of a skill the user just removed (it would inherit that skill's ratings and evidence links).
    const fresh = (kind: string) => { let id: string; do { id = `${prefix}${kind}-${randomBytes(5).toString('hex')}`; } while (used.has(id)); return id; };
    const pick = (given: string | undefined, kind: string) => {
      if (given !== undefined) { if (!given.startsWith(prefix) || used.has(given)) throw new ValidationError({ id: 'Unknown or duplicate capability/skill id.' }); used.add(given); return given; }
      const id = fresh(kind); used.add(id); return id;
    };
    // Existing ids first so freshly generated ones can never collide with them.
    for (const c of input.capabilities) { if (c.id) pick(c.id, 'c'); }
    const caps = input.capabilities.map((c) => ({ ...c, id: c.id ?? pick(undefined, 'c') }));
    for (const c of caps) for (const sk of c.skills) if (sk.id) pick(sk.id, 's');
    return { ...input, capabilities: caps.map((c) => ({ ...c, skills: c.skills.map((sk) => ({ ...sk, id: sk.id ?? pick(undefined, 's') })) })) };
  }
  private async model(userId: string, careerId: string): Promise<CareerModelRecord> {
    const m = await this.repos.getCareerModel(userId, careerId);
    if (!m) throw notFound('Career not found.', 'career_not_found');
    return m;
  }
  async getCareer(userId: string, careerId: string) { return this.model(userId, careerId); }
  async getCareerSkills(userId: string, careerId: string) {
    const m = await this.model(userId, careerId);
    const caps = new Map(m.capabilities.map((c) => [c.id, c]));
    const skills = m.requirements.map((r) => {
      const s = m.skills.find((x) => x.id === r.skillId);
      return { id: r.skillId, name: s?.name ?? r.skillId, description: s?.description ?? '', category: s?.category ?? null, capabilityId: r.capabilityId, capabilityName: caps.get(r.capabilityId)?.name ?? '', requiredLevel: r.requiredLevel, importance: r.importance };
    });
    return { careerId: m.career.id, skills };
  }

  private async requireSkill(userId: string, skillId: string): Promise<void> {
    if ((await this.repos.visibleSkillIds(userId, [skillId])).length === 0) throw notFound('Skill not found.', 'skill_not_found');
  }
  async listAssessments(userId: string) { return { skills: (await this.repos.listAssessments(userId)).map(assessmentView) }; }
  async getAssessment(userId: string, skillId: string) {
    await this.requireSkill(userId, skillId);
    const a = await this.repos.getAssessment(userId, skillId);
    return a ? assessmentView(a) : unassessedView(skillId); // unassessed is NOT level 0
  }
  async setAssessment(userId: string, skillId: string, level: number, source: string) {
    await this.requireSkill(userId, skillId);
    return assessmentView(await this.repos.upsertAssessment(userId, skillId, level, source));
  }
  async clearAssessment(userId: string, skillId: string) {
    await this.requireSkill(userId, skillId);
    await this.repos.deleteAssessment(userId, skillId); // idempotent
  }

  private async checkSkills(userId: string, ids: string[]) {
    if (!ids.length) return;
    const ok = new Set(await this.repos.visibleSkillIds(userId, ids));
    const bad = ids.filter((i) => !ok.has(i));
    if (bad.length) throw new ValidationError({ skillIds: `Unknown skills: ${bad.join(', ')}.` });
  }
  // Newest first. `limit`/`offset` page through the list; `total` is the whole count so a client knows when it has everything.
  async listEvidence(userId: string, page: { limit?: number; offset?: number } = {}) {
    const rows = await this.repos.listEvidence(userId), limit = page.limit ?? MAX_EVIDENCE_PAGE, offset = page.offset ?? 0;
    return { evidence: rows.slice(offset, offset + limit).map(evidenceView), total: rows.length, limit, offset };
  }
  private async own(userId: string, id: string) {
    const e = await this.repos.getEvidence(userId, id);
    if (!e) throw notFound('Evidence not found.', 'evidence_not_found'); // identical for "missing" and "someone else's"
    return e;
  }
  async getEvidence(userId: string, id: string) { return evidenceView(await this.own(userId, id)); }
  async createEvidence(userId: string, input: EvidenceInput) {
    await this.checkSkills(userId, input.skillIds);
    if ((await this.repos.listEvidence(userId)).length >= MAX_EVIDENCE_PER_USER) throw new AppError(409, 'evidence_limit_reached', `You can keep up to ${MAX_EVIDENCE_PER_USER} evidence items. Delete one you no longer need first.`);
    return evidenceView(await this.repos.createEvidence(userId, input));
  }
  async updateEvidence(userId: string, id: string, patch: EvidencePatch) {
    if (patch.skillIds) await this.checkSkills(userId, patch.skillIds);
    const out = await this.repos.updateEvidence(userId, id, patch);
    if (!out) throw notFound('Evidence not found.', 'evidence_not_found');
    return evidenceView(out);
  }
  async deleteEvidence(userId: string, id: string) { if (!(await this.repos.deleteEvidence(userId, id))) throw notFound('Evidence not found.', 'evidence_not_found'); }
  async linkSkill(userId: string, evidenceId: string, skillId: string) {
    await this.own(userId, evidenceId);
    await this.requireSkill(userId, skillId);
    if (!(await this.repos.linkEvidenceSkill(userId, evidenceId, skillId))) throw conflict('This evidence is already linked to that skill.');
    return evidenceView(await this.own(userId, evidenceId));
  }
  async unlinkSkill(userId: string, evidenceId: string, skillId: string) {
    await this.own(userId, evidenceId);
    if (!(await this.repos.unlinkEvidenceSkill(userId, evidenceId, skillId))) throw notFound('That skill is not linked to this evidence.', 'link_not_found');
    return evidenceView(await this.own(userId, evidenceId));
  }
}
