import type { Career, CareerDataset, Evidence, Gap, Readiness, ReadinessReason, SkillAnalysis } from '../types';
import { STRENGTH_WEIGHT } from './constants';
import { analyzeSkills } from './skills';

export const LEVELS = ['None', 'Beginner', 'Basic', 'Intermediate', 'Advanced', 'Expert'];
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (x: number) => Math.round(x * 100);

// levels: the user's assessments (skillId -> level). fallback: level for skills the user has not assessed (omit to keep dataset defaults).
export function applyLevels(d: CareerDataset, levels: Record<string, number>, fallback?: number): CareerDataset {
  if (!Object.keys(levels).length && fallback === undefined) return d;
  const level = (id: string, dflt: number) => levels[id] ?? fallback ?? dflt;
  return { ...d, career: { ...d.career, capabilities: d.career.capabilities.map((c) => ({ ...c, skills: c.skills.map((s) => ({ ...s, currentLevel: level(s.id, s.currentLevel) })) })) } };
}

// Evidence -> skill links come from evidence.skillIds. Skills' evidenceIds are derived here, so example and user evidence share one path.
export function withEvidence(d: CareerDataset, evidence: Evidence[]): CareerDataset {
  const ids = new Set(d.career.capabilities.flatMap((c) => c.skills.map((s) => s.id)));
  const rel = evidence.filter((e) => e.skillIds.some((id) => ids.has(id)));
  return { ...d, evidence: rel, career: { ...d.career, capabilities: d.career.capabilities.map((c) => ({ ...c, skills: c.skills.map((s) => ({ ...s, evidenceIds: rel.filter((e) => e.skillIds.includes(s.id)).map((e) => e.id) })) })) } };
}

// Meaningful = at least half of the career's skills have been rated by the user (or the profile is a demo that assumes all are).
export function assessmentOf(total: number, assessed: number | null): Readiness['assessment'] {
  if (assessed === null) return { state: 'assessed', assessed: total, total };
  const state = assessed < Math.ceil(total / 2) || assessed === 0 ? 'not_assessed' : assessed < total ? 'partial' : 'assessed';
  return { state, assessed, total };
}
export const readinessLabel = (r: Readiness): string => (r.assessment.state === 'not_assessed' ? 'Not assessed' : `${r.overall}%`);

export function calcReadiness(career: Career, evidence: Evidence[], assessedIds: Set<string> | null = null): Readiness {
  const strength = new Map(evidence.map((e) => [e.id, STRENGTH_WEIGHT[e.strength]]));
  const skills = career.capabilities.flatMap((c) => c.skills);
  const coverage = avg(skills.map((s) => (s.currentLevel >= s.requiredLevel ? 1 : 0)));
  const skillStrength = avg(skills.map((s) => Math.min(s.currentLevel / s.requiredLevel, 1)));
  const evStrength = avg(skills.map((s) => Math.min(1, s.evidenceIds.reduce((t, id) => t + (strength.get(id) ?? 0), 0) / (s.requiredLevel * 1.2))));
  const alignment = avg(career.capabilities.map((c) => avg(c.skills.map((s) => Math.min(s.currentLevel / s.requiredLevel, 1)))));
  const overall = pct(0.3 * coverage + 0.3 * skillStrength + 0.25 * evStrength + 0.15 * alignment);
  const sa = analyzeSkills(career, evidence, assessedIds);
  const assessment = assessmentOf(skills.length, assessedIds === null ? null : skills.filter((s) => assessedIds.has(s.id)).length);
  const reasons: ReadinessReason[] = [
    ...sa.filter((s) => s.status === 'on_track').slice(0, 2).map((s) => ({ tone: 'strong' as const, text: `${s.name} meets the required level with supporting evidence` })),
    ...sa.filter((s) => s.skillGap > 0).slice(0, 2).map((s) => ({ tone: 'developing' as const, text: `${s.name} is ${LEVELS[s.currentLevel]} vs ${LEVELS[s.requiredLevel]} required` })),
    ...sa.filter((s) => s.status === 'evidence_gap').slice(0, 1).map((s) => ({ tone: 'missing' as const, text: `${s.name} meets the required level, but evidence is ${s.evidenceCount ? 'thin' : 'missing'} (evidence gap)` })),
  ];
  return {
    overall, assessment,
    summary: assessment.state === 'not_assessed' ? 'Complete your skill assessment to see where you stand.' : overall >= 80 ? 'Career ready: remaining gaps are minor.' : overall >= 60 ? 'Strong foundation with several high-impact gaps remaining.' : 'Early stage: focus on the largest gaps first.',
    metrics: [
      { key: 'coverage', label: 'Requirement coverage', value: pct(coverage) },
      { key: 'strength', label: 'Skill strength', value: pct(skillStrength) },
      { key: 'evidence', label: 'Evidence strength', value: pct(evStrength) },
      { key: 'alignment', label: 'Experience alignment', value: pct(alignment) },
    ],
    reasons,
  };
}

const KIND_RANK = { combined: 0, skill: 1, evidence: 2 } as const;
export function calcGaps(skills: SkillAnalysis[]): Gap[] {
  return skills.filter((s) => s.status !== 'on_track' && s.status !== 'not_assessed').map((s): Gap => ({
    skillId: s.skillId, skillName: s.name, capabilityName: s.capabilityName, requiredLevel: s.requiredLevel, currentLevel: s.currentLevel, size: s.skillGap,
    impact: s.skillGap >= 2 ? 'high' : 'medium', evidenceCount: s.evidenceCount, kind: s.status === 'combined_gap' ? 'combined' : s.status === 'skill_gap' ? 'skill' : 'evidence',
  })).sort((a, b) => b.size - a.size || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.skillName.localeCompare(b.skillName));
}
