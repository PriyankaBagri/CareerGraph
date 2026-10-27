import type { ExperienceLevel } from '../types';
export const EXPERIENCE_LEVELS: { value: ExperienceLevel; label: string; hint: string }[] = [
  { value: 'beginner', label: 'Beginner', hint: 'Just starting out' },
  { value: 'early', label: 'Early Career', hint: 'Up to about 2 years' },
  { value: 'intermediate', label: 'Intermediate', hint: 'Solid, independent experience' },
  { value: 'experienced', label: 'Experienced', hint: 'Deep, senior-level experience' },
];
export const ASSESSMENT_LABELS = ['Not started', 'Familiar', 'Working knowledge', 'Proficient', 'Strong'];

import type { EvidenceStrength, EvidenceType } from '../types';
// Evidence types are data: add an entry here (and to EvidenceType) to extend.
export const EVIDENCE_TYPES: EvidenceType[] = ['Project', 'Work Experience', 'Internship', 'Course', 'Certification', 'Competition', 'Publication', 'Portfolio', 'Case Study', 'Research', 'Assessment', 'Achievement', 'Volunteer Work', 'Other'];
// CareerGraph's internal evidence-quality model (not an objective truth). Weight feeds the readiness calculation.
export const STRENGTH_LEVELS: { value: EvidenceStrength; label: string; weight: number; meaning: string }[] = [
  { value: 'weak', label: 'Weak', weight: 1, meaning: 'Shows exposure to the skill but little demonstration.' },
  { value: 'moderate', label: 'Moderate', weight: 2, meaning: 'Demonstrates practical application of the skill.' },
  { value: 'strong', label: 'Strong', weight: 3, meaning: 'Substantial application with a concrete outcome.' },
  { value: 'very_strong', label: 'Very strong', weight: 4, meaning: 'Deep application, strong outcomes and highly relevant proof.' },
];
export const STRENGTH_ORDER: EvidenceStrength[] = STRENGTH_LEVELS.map((l) => l.value);
export const STRENGTH_WEIGHT = Object.fromEntries(STRENGTH_LEVELS.map((l) => [l.value, l.weight])) as Record<EvidenceStrength, number>;
export const STRENGTH_LABEL = Object.fromEntries(STRENGTH_LEVELS.map((l) => [l.value, l.label])) as Record<EvidenceStrength, string>;

import type { CoverageLevel, SkillStatus } from '../types';
export const SKILL_STATUS: Record<SkillStatus, { label: string; symbol: string; tone: string }> = {
  on_track: { label: 'On track', symbol: '✓', tone: 'border-ok text-ok' },
  skill_gap: { label: 'Skill gap', symbol: '△', tone: 'border-warn text-warn' },
  evidence_gap: { label: 'Evidence gap', symbol: '◇', tone: 'border-warn text-warn' },
  combined_gap: { label: 'Skill + evidence gap', symbol: '!', tone: 'border-bad text-bad' },
  not_assessed: { label: 'Not assessed', symbol: '○', tone: 'border-sand text-bark2' },
};
export const COVERAGE_LABEL: Record<CoverageLevel, string> = { none: 'None', weak: 'Weak', moderate: 'Moderate', strong: 'Strong' };
export const COVERAGE_RANK: Record<CoverageLevel, number> = { none: 0, weak: 1, moderate: 2, strong: 3 };
