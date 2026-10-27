import type { Action, Career, DashboardView, ReadinessAssessment, ReadinessMetric, ReadinessReason, SkillAnalysis } from '../types';
import { readinessLabel } from './readiness';

// Descriptive comparison only: no scores across careers, no ordering, no winner.
// Each side is the SAME analysis the rest of the app uses (readiness, gaps, actions) computed for that career.
const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface CareerSide {
  career: Career; overall: number; assessment: ReadinessAssessment; readinessLabel: string; notAssessed: SkillAnalysis[]; metrics: ReadinessMetric[]; reasons: ReadinessReason[];
  skillGaps: SkillAnalysis[]; evidenceGaps: SkillAnalysis[]; combinedGaps: SkillAnalysis[]; onTrack: SkillAnalysis[];
  skillsWithEvidence: number; totalSkills: number; previewActions: Action[];
}
export interface SkillPair { name: string; a: SkillAnalysis; b: SkillAnalysis }
export interface Comparison { sharedSkills: SkillPair[]; onlyA: SkillAnalysis[]; onlyB: SkillAnalysis[]; sharedCapabilities: string[]; a: CareerSide; b: CareerSide }

export function summarizeSide(v: DashboardView): CareerSide {
  const by = (s: SkillAnalysis['status']) => v.skills.filter((x) => x.status === s);
  return { career: v.career, overall: v.readiness.overall, assessment: v.readiness.assessment, readinessLabel: readinessLabel(v.readiness), notAssessed: by('not_assessed'), metrics: v.readiness.metrics, reasons: v.readiness.reasons, skillGaps: by('skill_gap'), evidenceGaps: by('evidence_gap'), combinedGaps: by('combined_gap'), onTrack: by('on_track'),
    skillsWithEvidence: v.skills.filter((s) => s.evidenceCount > 0).length, totalSkills: v.skills.length, previewActions: v.actions.slice(0, 3) }; // generated actions only: never persisted
}

export function compareCareers(a: DashboardView, b: DashboardView): Comparison {
  const bByKey = new Map(b.skills.map((s) => [key(s.name), s]));
  const aKeys = new Set(a.skills.map((s) => key(s.name)));
  const sharedSkills = a.skills.filter((s) => bByKey.has(key(s.name))).map((s) => ({ name: s.name, a: s, b: bByKey.get(key(s.name)) as SkillAnalysis }));
  const bCaps = new Set(b.career.capabilities.map((c) => key(c.name)));
  return { sharedSkills, onlyA: a.skills.filter((s) => !bByKey.has(key(s.name))), onlyB: b.skills.filter((s) => !aKeys.has(key(s.name))),
    sharedCapabilities: a.career.capabilities.filter((c) => bCaps.has(key(c.name))).map((c) => c.name), a: summarizeSide(a), b: summarizeSide(b) };
}
