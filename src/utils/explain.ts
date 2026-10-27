import type { EvaluationRulesView, SkillAnalysis } from '../types';
import { STRENGTH_LABEL } from './constants';
import { provenanceBadge } from './provenance';
import { LEVELS } from './readiness';

// Turns the SERVER's per-skill numbers into plain language. It restates the server's formula (it never invents another one) and only works in backend
// mode, where `breakdown` and the rules exist. Every figure shown comes from the server response; the what-if lines reuse the same published formula.
export const DEFAULT_STRENGTH_POINTS: Record<string, number> = { weak: 1, moderate: 2, strong: 3, very_strong: 4 };
const pct = (x: number) => Math.round(x * 100);
const one = (x: number) => Math.round(x * 10) / 10;

export interface EvidenceLine { id: string; title: string; strength: string; points: number; provenance: string; verified: boolean }
export interface ExplainStep { key: 'level' | 'evidence' | 'score' | 'weight'; title: string; text: string }
export interface SkillExplanation { headline: string; steps: ExplainStep[]; evidenceLines: EvidenceLine[]; statusReason: string; whatIf: string[]; caveat: string }

export function explainSkill(s: SkillAnalysis, rules: EvaluationRulesView | undefined): SkillExplanation | null {
  const b = s.breakdown;
  if (!b || !rules) return null;
  const pts = rules.strengthPoints ?? DEFAULT_STRENGTH_POINTS;
  const evidenceLines: EvidenceLine[] = s.evidence.map((e) => ({ id: e.id, title: e.title, strength: STRENGTH_LABEL[e.strength], points: pts[e.strength] ?? 0, provenance: provenanceBadge(e).text, verified: provenanceBadge(e).tone === 'ok' }));
  const lw = rules.levelWeight, needed = one(Math.max(1, s.requiredLevel) * rules.evidenceFullFactor);
  const items = `${s.evidenceCount} evidence item${s.evidenceCount === 1 ? '' : 's'}`;
  const thin = pct(rules.evidenceThinBelow);
  const caveat = s.evidenceCount === 0 ? 'No evidence is linked, so there is nothing to verify yet.'
    : evidenceLines.every((l) => !l.verified) ? 'All evidence here is self-reported: nobody has independently verified it, and the strength labels are your own.'
      : 'Some evidence carries a verification record from the server; the rest is self-reported.';

  const statusReason = b.evidenceStatus === 'none' ? 'No evidence is linked to this skill.'
    : b.evidenceStatus === 'thin'
      ? (b.evidenceRequired !== null && s.evidenceCount < b.evidenceRequired ? `This career asks for at least ${b.evidenceRequired} evidence item${b.evidenceRequired === 1 ? '' : 's'}; ${s.evidenceCount} ${s.evidenceCount === 1 ? 'is' : 'are'} linked, so evidence counts as thin however strong it is.` : `Evidence credit is ${pct(b.evidenceRatio)}%, below the ${thin}% this career treats as enough.`)
      : `Evidence credit is ${pct(b.evidenceRatio)}%, at or above the ${thin}% this career treats as enough${b.evidenceRequired !== null ? ` and at least ${b.evidenceRequired} item${b.evidenceRequired === 1 ? ' is' : 's are'} linked` : ''}.`;

  if (!s.assessed || b.levelRatio === null) {
    return {
      headline: 'Not assessed: this skill is unknown, not zero.',
      steps: [
        { key: 'level', title: 'Your level', text: `You have not rated ${s.name}, so CareerGraph cannot say whether it is a gap or met. It is left out of your readiness score instead of being counted as 0.` },
        { key: 'evidence', title: 'Evidence', text: `${items} linked (${b.evidencePoints} evidence point${b.evidencePoints === 1 ? '' : 's'}). Evidence is recorded, but it only affects the score once you rate the skill.` },
      ],
      evidenceLines, statusReason, caveat,
      whatIf: [`Rate your current ${s.name} level (0 to 5) to include it in your score. The level you need is ${LEVELS[s.requiredLevel]} (${s.requiredLevel}).`],
    };
  }
  const levelPts = lw * b.levelRatio * 100, evPts = (1 - lw) * b.evidenceRatio * 100;
  const score = b.skillScore === null ? null : Math.round(b.skillScore * 100);
  const steps: ExplainStep[] = [
    { key: 'level', title: 'Level credit', text: `You rated yourself ${LEVELS[s.currentLevel]} (${s.currentLevel}) against ${LEVELS[s.requiredLevel]} (${s.requiredLevel}) required: ${pct(b.levelRatio)}% of the required level. Level is worth up to ${pct(lw)}% of this skill's score, so about ${Math.round(levelPts)} of 100 points.` },
    { key: 'evidence', title: 'Evidence credit', text: `${items}${evidenceLines.length ? ` worth ${b.evidencePoints} point${b.evidencePoints === 1 ? '' : 's'} (${evidenceLines.map((l) => `${l.strength} ${l.points}`).join(' + ')})` : ''}. Full credit needs ${needed} points (required level ${s.requiredLevel} x ${rules.evidenceFullFactor}), so you have ${pct(b.evidenceRatio)}% credit. Evidence is worth up to ${pct(1 - lw)}%, so about ${Math.round(evPts)} of 100 points.` },
    ...(score !== null ? [{ key: 'score' as const, title: 'Skill score', text: `Level credit plus evidence credit gives this skill a score of ${score} out of 100.` }] : []),
    ...(b.contribution !== null && b.weightShare !== null ? [{ key: 'weight' as const, title: 'Effect on readiness', text: `Importance ${b.importance} of 5 makes this ${pct(b.weightShare)}% of the importance weight of your rated skills, so it contributes ${b.contribution} point${b.contribution === 1 ? '' : 's'} to your readiness score.` }] : []),
  ];
  const whatIf: string[] = [];
  if (s.skillGap > 0) {
    const next = Math.min(s.requiredLevel, s.currentLevel + 1), nr = Math.min(next / s.requiredLevel, 1);
    whatIf.push(`If your level genuinely reaches ${LEVELS[next]} (${next}), level credit rises from ${pct(b.levelRatio)}% to ${pct(nr)}%, about +${Math.round(lw * (nr - b.levelRatio) * 100)} points on this skill's 100.`);
  }
  if (b.evidenceRatio < 1) {
    const more = Math.max(0, one(needed - b.evidencePoints));
    whatIf.push(`Full evidence credit needs about ${more} more evidence point${more === 1 ? '' : 's'} (a strong item is worth ${pts.strong ?? 3}, a moderate one ${pts.moderate ?? 2}). Only add evidence that is real.`);
  }
  if (b.evidenceStatus !== 'sufficient' && b.evidenceRatio >= 1 && b.evidenceRequired !== null) whatIf.push(`Link ${Math.max(0, b.evidenceRequired - s.evidenceCount)} more evidence item${b.evidenceRequired - s.evidenceCount === 1 ? '' : 's'} to meet this career's minimum.`);
  if (!whatIf.length) whatIf.push('Level and evidence both meet what this career asks for; nothing more is needed here.');
  return { headline: s.skillGap > 0 ? `Below target: ${s.skillGap} level${s.skillGap > 1 ? 's' : ''} short of ${LEVELS[s.requiredLevel]}.` : b.evidenceStatus === 'sufficient' ? 'On track: level and evidence both meet the career model.' : 'Level met, evidence gap: you meet the level but the evidence is missing or thin.', steps, evidenceLines, statusReason, whatIf, caveat };
}

// ---- readiness breakdown: who contributes, what is unknown, where evidence is missing (all from the server's per-skill numbers) ----
export interface Contributor { skillId: string; name: string; capability: string; level: number; required: number; score: number; points: number; share: number }
export interface ReadinessBreakdown { contributors: Contributor[]; unassessed: SkillAnalysis[]; evidenceGaps: SkillAnalysis[]; belowTarget: SkillAnalysis[]; pointsTotal: number }
export function readinessBreakdown(skills: SkillAnalysis[]): ReadinessBreakdown | null {
  if (!skills.length || skills.some((s) => !s.breakdown)) return null; // local/demo mode has no server numbers
  const contributors = skills.filter((s) => s.assessed && s.breakdown?.contribution !== null && s.breakdown?.contribution !== undefined)
    .map((s): Contributor => ({ skillId: s.skillId, name: s.name, capability: s.capabilityName, level: s.currentLevel, required: s.requiredLevel, score: Math.round((s.breakdown?.skillScore ?? 0) * 100), points: s.breakdown?.contribution ?? 0, share: pct(s.breakdown?.weightShare ?? 0) }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return {
    contributors, pointsTotal: one(contributors.reduce((t, c) => t + c.points, 0)),
    unassessed: skills.filter((s) => !s.assessed),
    evidenceGaps: skills.filter((s) => s.assessed && s.breakdown?.evidenceStatus !== 'sufficient'),
    belowTarget: skills.filter((s) => s.assessed && s.skillGap > 0),
  };
}
