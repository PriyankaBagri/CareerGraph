import { calcActions, calcGaps, calcReadiness, DEFAULT_ACTION_LIMIT, MAX_ACTION_LIMIT, PRIORITY_CRITERIA, type EngineInput } from '../domain/readiness';
import { notFound } from '../errors';
import { buildGuidance, splitSkillText, type SkillNotes } from '../domain/guidance';
import { buildCareerGraph, type ActionState } from '../domain/graph';
import type { CoreRepos } from '../repositories/core-types';
import type { ProgressRepos } from '../repositories/progress-types';

// Reads ONLY the authenticated user's assessments and evidence (every CoreRepos method is scoped by userId) and the career visible to them.
// No new tables or queries: it reuses the Stage 3 repositories, so isolation is inherited and already tested.
export class ReadinessService {
  constructor(private readonly repos: CoreRepos & Pick<ProgressRepos, 'listProgress'>) {}
  private async input(userId: string, careerId: string): Promise<EngineInput & { evidenceExpectations: string[]; notes: Map<string, SkillNotes> }> {
    const model = await this.repos.getCareerModel(userId, careerId);
    if (!model) throw notFound('Career not found.', 'career_not_found');
    const caps = new Map(model.capabilities.map((c) => [c.id, c]));
    const names = new Map(model.skills.map((s) => [s.id, s.name]));
    const skills = model.requirements.map((r) => ({ skillId: r.skillId, name: names.get(r.skillId) ?? r.skillId, capabilityId: r.capabilityId, capabilityName: caps.get(r.capabilityId)?.name ?? '', requiredLevel: r.requiredLevel, importance: r.importance, position: r.position, minEvidence: r.minEvidence ?? null }));
    const notes = new Map(model.skills.map((s) => [s.id, splitSkillText(String(s.description ?? '').slice(0, 1000))] as const));
    const inCareer = new Set(skills.map((s) => s.skillId));
    const [assessed, evidence] = await Promise.all([this.repos.listAssessments(userId), this.repos.listEvidence(userId)]);
    const assessments: Record<string, number> = {};
    for (const a of assessed) if (inCareer.has(a.skillId)) assessments[a.skillId] = a.level; // assessments of skills outside this career are ignored
    const evidenceStrengths: Record<string, string[]> = {};
    for (const e of evidence) for (const sid of e.skillIds) if (inCareer.has(sid)) (evidenceStrengths[sid] ??= []).push(e.strength);
    return { careerId: model.career.id, careerName: model.career.name, skills, assessments, evidenceStrengths, rules: model.career.evaluationRules ?? undefined,
      notes, evidenceExpectations: (model.career.evidenceExpectations ?? []).slice(0, 8).map((t) => String(t).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200)).filter(Boolean) };
  }
  async readiness(userId: string, careerId: string) { return calcReadiness(await this.input(userId, careerId)); }
  async gaps(userId: string, careerId: string) { return calcGaps(await this.input(userId, careerId)); }
  async actions(userId: string, careerId: string, limit = DEFAULT_ACTION_LIMIT) {
    const input = await this.input(userId, careerId);
    return { careerId: input.careerId, careerName: input.careerName, actions: calcActions(input, limit).map((a) => ({ ...a, guidance: buildGuidance(a, input.careerName, input.notes.get(a.skillId) ?? { description: '', evidenceNote: '' }, input.evidenceExpectations) })), priorityCriteria: PRIORITY_CRITERIA, evidenceExpectations: input.evidenceExpectations, note: 'Rule-based suggestions from your own assessments and evidence. They are not AI-generated and not a guarantee of any outcome.' };
  }
  // The same ranked actions plus the user's SAVED progress. Rows are never dropped, so the client decides how to show finished ones;
  // `history` lists saved progress that is not among the current actions (the gap closed, or it ranks below this limit).
  async roadmap(userId: string, careerId: string, limit = DEFAULT_ACTION_LIMIT) {
    const base = await this.actions(userId, careerId, limit);
    const progress = await this.repos.listProgress(userId, careerId);
    const byKey = new Map(progress.map((p) => [p.actionKey, p]));
    const actions = base.actions.map((a) => ({ ...a, status: (byKey.get(a.id)?.status ?? 'not_started') as ActionState, completedAt: byKey.get(a.id)?.completedAt ?? null }));
    const current = new Set(base.actions.map((a) => a.id));
    return {
      ...base, actions,
      summary: { open: actions.filter((a) => a.status !== 'completed').length, inProgress: actions.filter((a) => a.status === 'in_progress').length, completed: actions.filter((a) => a.status === 'completed').length },
      history: progress.filter((p) => !current.has(p.actionKey)).map((p) => ({ actionKey: p.actionKey, status: p.status, title: p.snapshot.title, completedAt: p.completedAt, updatedAt: p.updatedAt })),
    };
  }
  async graph(userId: string, careerId: string) {
    const [r, road, evidence] = await Promise.all([this.readiness(userId, careerId), this.roadmap(userId, careerId, MAX_ACTION_LIMIT), this.repos.listEvidence(userId)]);
    return buildCareerGraph(r, evidence.map((e) => ({ id: e.id, title: e.title, type: e.type, strength: e.strength, source: e.source, skillIds: e.skillIds })), road.actions);
  }
}
