import type { Career, CoverageLevel, Evidence, SkillAnalysis, SkillStatus } from '../types';
import { STRENGTH_WEIGHT } from './constants';

// Evidence is "sufficient" when its weighted total reaches half of what the readiness formula treats as full coverage.
export const EVIDENCE_OK_RATIO = 0.5;

function nextAction(assessed: boolean, skillGap: number, count: number, evidenceGap: boolean): string {
  if (!assessed) return 'Set your current level to assess this skill.';
  if (skillGap > 0) return count === 0 ? 'Build the skill and document the result.' : 'Strengthen this skill further.';
  if (evidenceGap) return 'Add evidence demonstrating this skill.';
  return 'Maintain the skill and strengthen adjacent capabilities.';
}

// One derivation shared by Skills, Skill detail, gaps, actions and readiness reasons.
// `assessed`: ids of skills the user has actually rated (null = treat every skill as assessed, e.g. the demo profile).
// A skill the user has not rated is "not assessed": it is neither a gap nor on track, because CareerGraph does not know yet.
export function analyzeSkills(career: Career, evidence: Evidence[], assessed: Set<string> | null = null): SkillAnalysis[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return career.capabilities.flatMap((c) => c.skills.map((s): SkillAnalysis => {
    const ev = s.evidenceIds.map((id) => byId.get(id)).filter((e): e is Evidence => !!e).sort((a, b) => STRENGTH_WEIGHT[b.strength] - STRENGTH_WEIGHT[a.strength]);
    const ratio = Math.min(1, ev.reduce((t, e) => t + STRENGTH_WEIGHT[e.strength], 0) / (Math.max(s.requiredLevel, 1) * 1.2));
    const isAssessed = assessed === null || assessed.has(s.id);
    const skillGap = isAssessed ? Math.max(0, s.requiredLevel - s.currentLevel) : 0;
    const evidenceGap = ratio < EVIDENCE_OK_RATIO;
    const status: SkillStatus = !isAssessed ? 'not_assessed' : skillGap && evidenceGap ? 'combined_gap' : skillGap ? 'skill_gap' : evidenceGap ? 'evidence_gap' : 'on_track';
    const coverage: CoverageLevel = ev.length === 0 ? 'none' : ratio < EVIDENCE_OK_RATIO ? 'weak' : ratio < 0.8 ? 'moderate' : 'strong';
    return { assessed: isAssessed, skillId: s.id, name: s.name, capabilityId: c.id, capabilityName: c.name, careerName: career.name, requiredLevel: s.requiredLevel, currentLevel: s.currentLevel, skillGap, evidence: ev, evidenceCount: ev.length, strongest: ev[0]?.strength ?? null, coverage, status, nextAction: nextAction(isAssessed, skillGap, ev.length, evidenceGap) };
  }));
}
