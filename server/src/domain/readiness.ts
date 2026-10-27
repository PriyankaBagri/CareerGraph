// Stage 4 readiness engine: PURE and DETERMINISTIC (no I/O, no clock, no randomness, no AI). Same inputs always give the same output.
// It describes a user's self-assessed position against a career's requirements. It is not a prediction of hiring or job success.
//
// FORMULA (documented in server/README.md; keep the two in sync)
//   For each ASSESSED required skill i:
//     levelRatio_i    = min(level_i / requiredLevel_i, 1)            (requiredLevel_i <= 0 counts as 1)
//     evidencePoints_i= sum of STRENGTH_POINTS over the user's evidence linked to the skill
//     evidenceRatio_i = min(evidencePoints_i / (requiredLevel_i * 1.2), 1)   (same scale as the frontend; requiredLevel floor 1)
//     skillScore_i    = 0.75 * levelRatio_i + 0.25 * evidenceRatio_i
//   weight_i = importance_i (1..5)
//   score    = 100 * sum(weight_i * skillScore_i) / sum(weight_i)       over assessed skills ONLY
//   Unassessed skills are UNKNOWN: they are not counted as level 0 in `score`.
//   range.min = same sum divided by the weight of ALL skills (unassessed treated as 0); range.max = unassessed treated as fully met.
//   The score is only labelled "assessed" when every skill is rated; "partial" when some are; "not_assessed" when none (score = null).
export const LEVEL_NAMES = ['None', 'Beginner', 'Basic', 'Intermediate', 'Advanced', 'Expert'] as const;
export const STRENGTH_POINTS: Record<string, number> = { weak: 1, moderate: 2, strong: 3, very_strong: 4 }; // matches src/utils/constants.ts
export const LEVEL_WEIGHT = 0.75, EVIDENCE_WEIGHT = 0.25, EVIDENCE_FULL_FACTOR = 1.2, EVIDENCE_THIN_BELOW = 0.5;
import { describeRules, resolveRules, type EvaluationRules, type RulesSource } from './evaluation';
export const DEFAULT_ACTION_LIMIT = 5, MAX_ACTION_LIMIT = 10;

export interface EngineSkill { skillId: string; name: string; capabilityId: string; capabilityName: string; requiredLevel: number; importance: number; position: number; /** career-specific evidence requirement: fewest evidence items that count as enough (optional) */ minEvidence?: number | null }
export interface EngineInput { careerId: string; careerName: string; skills: EngineSkill[]; assessments: Record<string, number>; evidenceStrengths: Record<string, string[]>; /** stored per-career overrides; absent = built-in defaults */ rules?: unknown }

const r1 = (n: number) => Math.round(n * 10) / 10;
const clampImportance = (n: number) => (Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3);
const levelName = (n: number) => LEVEL_NAMES[Math.min(5, Math.max(0, Math.round(n)))];
export type SkillStatus = 'meets' | 'below' | 'unassessed';
export type EvidenceStatus = 'none' | 'thin' | 'sufficient';

export interface SkillBreakdown {
  skillId: string; name: string; capabilityId: string; capabilityName: string;
  requiredLevel: number; importance: number; assessed: boolean; currentLevel: number | null;
  status: SkillStatus; gap: number | null;
  evidenceCount: number; evidenceRequired: number | null; evidencePoints: number; evidenceRatio: number; evidenceStatus: EvidenceStatus;
  levelRatio: number | null; skillScore: number | null; weightShare: number | null; contribution: number | null; // contribution = points of the final score
}
export interface ReadinessResult {
  careerId: string; careerName: string; state: 'not_assessed' | 'partial' | 'assessed' | 'no_requirements';
  score: number | null; range: { min: number; max: number } | null;
  counts: { total: number; assessed: number; unassessed: number; meets: number; below: number };
  weights: { total: number; assessed: number; assessedShare: number };
  skills: SkillBreakdown[]; caveats: string[]; formula: string;
  evaluation: { source: RulesSource; rules: EvaluationRules; description: string };
}

// Plain-language statement of how actions are ordered. Kept next to calcActions so the two cannot drift apart (a test checks both).
export const PRIORITY_CRITERIA = 'Actions are ranked by a deterministic score. A rated skill below its target level scores 2 x gap x importance (priority high when the gap is 2 or more or importance is 4 or 5, otherwise medium). An unrated skill scores its importance, plus 1 when the required level is 4 or higher (high when importance is 4 or 5, otherwise medium). A skill that meets its level but has missing or thin evidence scores 0.5 x importance x (1 - evidence credit) and is low priority. Ties are broken by skill id. Nothing here is a deadline or a guarantee.';
export const FORMULA_TEXT = 'score = 100 * sum(importance * skillScore) / sum(importance), over assessed skills only; skillScore = 0.75 * min(level/required, 1) + 0.25 * min(evidencePoints/(required*1.2), 1); evidence points: weak 1, moderate 2, strong 3, very_strong 4. Unassessed skills are unknown, not zero.';

export function analyze(input: EngineInput): SkillBreakdown[] {
  const { rules } = resolveRules(input.rules);
  return [...input.skills].sort((a, b) => a.position - b.position || a.skillId.localeCompare(b.skillId)).map((s) => {
    const req = Math.max(1, s.requiredLevel), importance = clampImportance(s.importance);
    const level = Object.prototype.hasOwnProperty.call(input.assessments, s.skillId) ? input.assessments[s.skillId] : null;
    const strengths = input.evidenceStrengths[s.skillId] ?? [];
    const points = strengths.reduce((t, k) => t + (rules.strengthPoints[k as keyof EvaluationRules['strengthPoints']] ?? 0), 0);
    const evidenceRatio = Math.min(1, points / (req * rules.evidenceFullFactor));
    const required = s.minEvidence && s.minEvidence > 0 ? Math.floor(s.minEvidence) : null;
    // A career-specific minimum number of evidence items is a REQUIREMENT, not a score input: fewer items than required keeps the status at "thin" however strong they are.
    const evidenceStatus: EvidenceStatus = strengths.length === 0 ? 'none' : evidenceRatio < rules.evidenceThinBelow || (required !== null && strengths.length < required) ? 'thin' : 'sufficient';
    const assessed = level !== null;
    const levelRatio = assessed ? (s.requiredLevel <= 0 ? 1 : Math.min((level as number) / s.requiredLevel, 1)) : null;
    const skillScore = assessed ? rules.levelWeight * (levelRatio as number) + (1 - rules.levelWeight) * evidenceRatio : null;
    const gap = assessed ? Math.max(0, s.requiredLevel - (level as number)) : null;
    return { skillId: s.skillId, name: s.name, capabilityId: s.capabilityId, capabilityName: s.capabilityName, requiredLevel: s.requiredLevel, importance, assessed, currentLevel: level,
      status: !assessed ? 'unassessed' : (gap as number) > 0 ? 'below' : 'meets', gap, evidenceCount: strengths.length, evidenceRequired: required, evidencePoints: points, evidenceRatio: r1(evidenceRatio * 100) / 100, evidenceStatus,
      levelRatio: levelRatio === null ? null : r1(levelRatio * 100) / 100, skillScore: skillScore === null ? null : Math.round(skillScore * 1000) / 1000, weightShare: null, contribution: null };
  });
}

export function calcReadiness(input: EngineInput): ReadinessResult {
  const skills = analyze(input);
  const total = skills.length, assessedSkills = skills.filter((s) => s.assessed);
  const wAll = skills.reduce((t, s) => t + s.importance, 0), wAssessed = assessedSkills.reduce((t, s) => t + s.importance, 0);
  const sum = assessedSkills.reduce((t, s) => t + s.importance * (s.skillScore as number), 0);
  for (const s of assessedSkills) { s.weightShare = Math.round((s.importance / wAssessed) * 1000) / 1000; s.contribution = r1((100 * s.importance * (s.skillScore as number)) / wAssessed); }
  const counts = { total, assessed: assessedSkills.length, unassessed: total - assessedSkills.length, meets: skills.filter((s) => s.status === 'meets').length, below: skills.filter((s) => s.status === 'below').length };
  const state: ReadinessResult['state'] = total === 0 ? 'no_requirements' : counts.assessed === 0 ? 'not_assessed' : counts.unassessed > 0 ? 'partial' : 'assessed';
  const caveats: string[] = [];
  if (state === 'no_requirements') caveats.push('This career has no required skills defined, so no readiness can be calculated.');
  if (state === 'not_assessed') caveats.push('You have not rated any skill for this career yet. No score is shown because unrated skills are unknown, not zero.');
  if (state === 'partial') caveats.push(`Only ${counts.assessed} of ${total} skills are rated. The score covers the rated skills only (${Math.round((wAssessed / wAll) * 100)}% of the total importance weight); the range shows the possible result once the rest are rated.`);
  if (counts.assessed > 0) caveats.push('Skill levels and evidence strength are self-reported. This score describes your position against this career model; it does not predict hiring or job success.');
  const withEvidenceUnknown = assessedSkills.filter((s) => s.evidenceCount === 0).length;
  if (withEvidenceUnknown > 0) caveats.push(`${withEvidenceUnknown} rated skill(s) have no linked evidence, which lowers their score (evidence is worth up to ${Math.round((1 - resolveRules(input.rules).rules.levelWeight) * 100)}% of a skill's score).`);
  const score = state === 'not_assessed' || state === 'no_requirements' ? null : Math.round((100 * sum) / wAssessed);
  const range = score === null ? null : { min: Math.round((100 * sum) / wAll), max: Math.round((100 * (sum + (wAll - wAssessed))) / wAll) };
  return { careerId: input.careerId, careerName: input.careerName, state, score, range, counts, weights: { total: wAll, assessed: wAssessed, assessedShare: wAll ? Math.round((wAssessed / wAll) * 1000) / 1000 : 0 }, skills, caveats, formula: FORMULA_TEXT, evaluation: { source: resolveRules(input.rules).source, rules: resolveRules(input.rules).rules, description: describeRules(resolveRules(input.rules).rules) } };
}

export interface GapResult {
  careerId: string; counts: ReadinessResult['counts'];
  below: (SkillBreakdown & { weightedGap: number })[]; unassessed: SkillBreakdown[]; meets: SkillBreakdown[]; caveats: string[];
}
export function calcGaps(input: EngineInput): GapResult {
  const skills = analyze(input);
  const below = skills.filter((s) => s.status === 'below').map((s) => ({ ...s, weightedGap: (s.gap as number) * s.importance }))
    .sort((a, b) => b.weightedGap - a.weightedGap || b.importance - a.importance || a.skillId.localeCompare(b.skillId));
  const unassessed = skills.filter((s) => s.status === 'unassessed').sort((a, b) => b.importance - a.importance || b.requiredLevel - a.requiredLevel || a.skillId.localeCompare(b.skillId));
  const meets = skills.filter((s) => s.status === 'meets').sort((a, b) => a.skillId.localeCompare(b.skillId));
  const caveats = unassessed.length ? [`${unassessed.length} skill(s) are unassessed: they are unknown, not counted as gaps or as met.`] : [];
  return { careerId: input.careerId, counts: { total: skills.length, assessed: below.length + meets.length, unassessed: unassessed.length, meets: meets.length, below: below.length }, below, unassessed, meets, caveats };
}

export type ActionType = 'build_skill' | 'assess_skill' | 'add_evidence';
export interface NextAction {
  id: string; rank: number; type: ActionType; skillId: string; skillName: string; capabilityId: string; capabilityName: string;
  priority: 'high' | 'medium' | 'low'; priorityScore: number; reason: string; recommendation: string;
  currentLevel: number | null; targetLevel: number; completionCriterion: string;
}
// Priority score (deterministic): below-target skill = 2 * gap * importance; unassessed = importance (+1 if requiredLevel >= 4);
// meets-level-but-evidence-missing/thin = 0.5 * importance * (1 - evidenceRatio). Ties break on skill id, then action type.
export function calcActions(input: EngineInput, limit = DEFAULT_ACTION_LIMIT): NextAction[] {
  const n = Math.min(MAX_ACTION_LIMIT, Math.max(1, Math.floor(limit)));
  const cand: Omit<NextAction, 'rank'>[] = [];
  for (const s of analyze(input)) {
    const base = { skillId: s.skillId, skillName: s.name, capabilityId: s.capabilityId, capabilityName: s.capabilityName, targetLevel: Math.max(0, s.requiredLevel) };
    const label = `${s.name} (${s.capabilityName})`;
    if (s.status === 'below') {
      const score = 2 * (s.gap as number) * s.importance;
      cand.push({ ...base, id: `build_skill:${s.skillId}`, type: 'build_skill', priorityScore: score, priority: (s.gap as number) >= 2 || s.importance >= 4 ? 'high' : 'medium',
        reason: `${label} is ${levelName(s.currentLevel as number)} (${s.currentLevel}) but ${levelName(s.requiredLevel)} (${s.requiredLevel}) is required. Importance ${s.importance}/5.`,
        recommendation: `Practise ${s.name} with a focused project or course until you can work at ${levelName(s.requiredLevel)} level, then record the result as evidence.`,
        currentLevel: s.currentLevel, completionCriterion: `Reassess ${s.name} at level ${s.requiredLevel} or higher.` });
    } else if (s.status === 'unassessed') {
      cand.push({ ...base, id: `assess_skill:${s.skillId}`, type: 'assess_skill', priorityScore: s.importance + (s.requiredLevel >= 4 ? 1 : 0), priority: s.importance >= 4 ? 'high' : 'medium',
        reason: `${label} is not assessed yet, so CareerGraph cannot tell whether it is a gap. Importance ${s.importance}/5; required level ${s.requiredLevel}.`,
        recommendation: `Rate your current level for ${s.name} honestly (0 to 5).`, currentLevel: null, completionCriterion: `${s.name} has a saved self-assessment.` });
    } else if (s.evidenceStatus !== 'sufficient') {
      cand.push({ ...base, id: `add_evidence:${s.skillId}`, type: 'add_evidence', priorityScore: Math.round(0.5 * s.importance * (1 - s.evidenceRatio) * 100) / 100, priority: 'low',
        reason: `${label} meets the required level, but ${s.evidenceStatus === 'none' ? 'no evidence is linked to it' : s.evidenceRequired !== null && s.evidenceCount < s.evidenceRequired ? `this career asks for at least ${s.evidenceRequired} evidence item(s) and ${s.evidenceCount} ${s.evidenceCount === 1 ? 'is' : 'are'} linked` : 'its linked evidence is thin'}.`,
        recommendation: `Add or strengthen evidence (a project, course or work example) that demonstrates ${s.name}.`, currentLevel: s.currentLevel,
        completionCriterion: s.evidenceRequired !== null ? `At least ${s.evidenceRequired} evidence item(s) linked to ${s.name}, together strong enough to count.` : `At least one evidence item linked to ${s.name} with strength "strong", or two "moderate".` });
    }
  }
  cand.sort((a, b) => b.priorityScore - a.priorityScore || a.skillId.localeCompare(b.skillId) || a.type.localeCompare(b.type));
  return cand.slice(0, n).map((a, i) => ({ ...a, rank: i + 1 }));
}
