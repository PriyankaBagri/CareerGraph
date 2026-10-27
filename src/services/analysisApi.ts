// Backend analysis: loads the career model, readiness, gaps and actions from the Stage 3/4 endpoints and maps them onto the
// DashboardView the UI already renders. Explicit mapping only: nothing is invented. An unassessed skill stays unassessed (never level 0),
// and fields the server does not provide (effort, time estimate) are left undefined rather than made up.
import type { Action, ActionType, DashboardView, Evidence, Gap, Readiness, ReadinessReason, RoadmapPhase, SkillAnalysis, SkillStatus } from '../types';
import { STRENGTH_WEIGHT } from '../utils/constants';
import { LEVELS } from '../utils/readiness';
import { coreApi, toCareer, type ApiAction, type ApiActions, type ApiCareerModel, type ApiGaps, type ApiReadiness, type ApiSkillBreakdown } from './coreApi';

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);
const level = (n: number) => LEVELS[Math.min(5, Math.max(0, Math.round(n)))];
export const RULE_BASED_NOTE = 'A rule-based estimate of your position against this career, from your own ratings and evidence. It does not predict hiring or job success.';

const ACTION_TYPE: Record<ApiAction['type'], ActionType> = { build_skill: 'build_skill', assess_skill: 'other', add_evidence: 'create_evidence' };
// Grouping for the roadmap view only (presentation): assess first, then build, then evidence.
const ACTION_PHASE: Record<ApiAction['type'], RoadmapPhase> = { assess_skill: 'foundation', build_skill: 'skill_building', add_evidence: 'evidence_building' };

export function mapSkills(model: ApiCareerModel, r: ApiReadiness, actions: ApiAction[], evidence: Evidence[]): SkillAnalysis[] {
  const bySkill = new Map(actions.map((a) => [a.skillId, a]));
  return r.skills.map((b: ApiSkillBreakdown): SkillAnalysis => {
    const ev = evidence.filter((e) => e.skillIds.includes(b.skillId)).sort((x, y) => STRENGTH_WEIGHT[y.strength] - STRENGTH_WEIGHT[x.strength]);
    const status: SkillStatus = b.status === 'unassessed' ? 'not_assessed' : b.status === 'below' ? (b.evidenceStatus === 'sufficient' ? 'skill_gap' : 'combined_gap') : b.evidenceStatus === 'sufficient' ? 'on_track' : 'evidence_gap';
    const next = bySkill.get(b.skillId)?.recommendation
      ?? (status === 'not_assessed' ? 'Set your current level to assess this skill.' : status === 'on_track' ? 'Maintain the skill and strengthen adjacent capabilities.' : 'See the suggested next actions.');
    return {
      assessed: b.assessed, skillId: b.skillId, name: b.name, capabilityId: b.capabilityId, capabilityName: b.capabilityName, careerName: model.career.name,
      requiredLevel: b.requiredLevel, currentLevel: b.currentLevel ?? 0, skillGap: b.gap ?? 0, evidence: ev, evidenceCount: ev.length, strongest: ev[0]?.strength ?? null,
      coverage: b.evidenceStatus === 'none' ? 'none' : b.evidenceStatus === 'thin' ? 'weak' : b.evidenceRatio < 0.8 ? 'moderate' : 'strong', status, nextAction: next,
      breakdown: { importance: b.importance, levelRatio: b.levelRatio, evidencePoints: b.evidencePoints, evidenceRatio: b.evidenceRatio, evidenceRequired: b.evidenceRequired ?? null, evidenceStatus: b.evidenceStatus, skillScore: b.skillScore, contribution: b.contribution, weightShare: b.weightShare },
    };
  });
}

export function mapReadiness(r: ApiReadiness, g: ApiGaps): Readiness {
  const c = r.counts, rated = r.skills.filter((s) => s.assessed);
  const state: Readiness['assessment']['state'] = r.state === 'assessed' ? 'assessed' : r.state === 'partial' ? 'partial' : 'not_assessed';
  const reasons: ReadinessReason[] = [
    ...g.meets.filter((s) => s.evidenceStatus === 'sufficient').slice(0, 2).map((s) => ({ tone: 'strong' as const, text: `${s.name} meets the required level with supporting evidence` })),
    ...g.below.slice(0, 2).map((s) => ({ tone: 'developing' as const, text: `${s.name} is ${level(s.currentLevel ?? 0)} vs ${level(s.requiredLevel)} required` })),
    ...g.meets.filter((s) => s.evidenceStatus !== 'sufficient').slice(0, 1).map((s) => ({ tone: 'missing' as const, text: `${s.name} meets the required level, but evidence is ${s.evidenceStatus === 'none' ? 'missing' : 'thin'} (evidence gap)` })),
    ...(c.unassessed > 0 && c.assessed > 0 ? [{ tone: 'missing' as const, text: `${c.unassessed} skill${c.unassessed === 1 ? ' is' : 's are'} not assessed yet, so they are not counted either way` }] : []),
  ];
  return {
    overall: r.score ?? 0, assessment: { state, assessed: c.assessed, total: c.total },
    summary: state === 'not_assessed' ? 'Complete your skill assessment to see where you stand.' : `A rule-based estimate from ${c.assessed} of ${c.total} rated skills.`,
    metrics: [
      { key: 'coverage', label: 'Skills assessed', value: c.total ? pct(c.assessed / c.total) : 0 },
      { key: 'target', label: 'Rated skills at target level', value: c.assessed ? pct(c.meets / c.assessed) : 0 },
      { key: 'weight', label: 'Importance weight assessed', value: pct(r.weights.assessedShare) },
      { key: 'evidence', label: 'Rated skills with sufficient evidence', value: rated.length ? pct(rated.filter((s) => s.evidenceStatus === 'sufficient').length / rated.length) : 0 },
    ],
    reasons, backend: { score: r.score, range: r.range, caveats: r.caveats, assessedWeightShare: r.weights.assessedShare, evaluation: r.evaluation ? { source: r.evaluation.source, description: r.evaluation.description, rules: r.evaluation.rules } : undefined, formula: r.formula },
  };
}

export function mapGaps(g: ApiGaps, evidence: Evidence[]): Gap[] {
  return g.below.map((s): Gap => ({
    skillId: s.skillId, skillName: s.name, capabilityName: s.capabilityName, requiredLevel: s.requiredLevel, currentLevel: s.currentLevel ?? 0, size: s.gap ?? 0,
    impact: (s.gap ?? 0) >= 2 ? 'high' : 'medium', evidenceCount: evidence.filter((e) => e.skillIds.includes(s.skillId)).length, kind: s.evidenceStatus === 'sufficient' ? 'skill' : 'combined',
  }));
}

export function mapActions(a: ApiActions, careerId: string): Action[] {
  return a.actions.map((x): Action => ({
    id: x.id, careerId, type: ACTION_TYPE[x.type], phase: ACTION_PHASE[x.type], status: 'not_started', createdAt: '', updatedAt: '',
    title: x.guidance?.title ?? (x.type === 'build_skill' ? `Raise ${x.skillName} to ${level(x.targetLevel)}` : x.type === 'assess_skill' ? `Assess your ${x.skillName} level` : `Add evidence for ${x.skillName}`),
    description: x.guidance ? x.guidance.outcome : `${x.recommendation} Done when: ${x.completionCriterion}`, reason: x.reason, priority: x.priority, priorityScore: x.priorityScore, impact: x.priority,
    relatedSkillIds: [x.skillId], relatedCapabilityIds: [x.capabilityId], prerequisites: [],
    detail: { kind: x.type, skillName: x.skillName, recommendation: x.recommendation, completionCriterion: x.completionCriterion, currentLevel: x.currentLevel, targetLevel: x.targetLevel, rank: x.rank, guidance: x.guidance }, // effort / estimatedTime: not provided by the server, so left undefined
  }));
}

export function mapRemoteAnalysis(model: ApiCareerModel, readiness: ApiReadiness, gaps: ApiGaps, actions: ApiActions, evidence: Evidence[]): DashboardView {
  const levels: Record<string, number> = {};
  for (const s of readiness.skills) if (s.assessed && s.currentLevel !== null) levels[s.skillId] = s.currentLevel;
  const base = toCareer(model, levels);
  const mine = evidence.filter((e) => base.capabilities.some((c) => c.skills.some((s) => e.skillIds.includes(s.id))));
  const career = { ...base, capabilities: base.capabilities.map((c) => ({ ...c, skills: c.skills.map((s) => ({ ...s, evidenceIds: mine.filter((e) => e.skillIds.includes(s.id)).map((e) => e.id) })) })) };
  return { career, evidence: mine, readiness: mapReadiness(readiness, gaps), skills: mapSkills(model, readiness, actions.actions, evidence), gaps: mapGaps(gaps, evidence), actions: mapActions(actions, model.career.id), evidenceIsExample: false,
    guidance: actions.priorityCriteria ? { priorityCriteria: actions.priorityCriteria, evidenceExpectations: actions.evidenceExpectations ?? [] } : undefined };
}

// Four independent GETs. The user is identified only by the Bearer token; nothing user-specific is sent in the URL or body.
export async function loadRemoteAnalysis(careerId: string, evidence: Evidence[]): Promise<DashboardView> {
  const [model, readiness, gaps, actions] = await Promise.all([coreApi.getCareer(careerId), coreApi.getReadiness(careerId), coreApi.getGaps(careerId), coreApi.getActions(careerId, 10)]);
  return mapRemoteAnalysis(model, readiness, gaps, actions, evidence);
}
