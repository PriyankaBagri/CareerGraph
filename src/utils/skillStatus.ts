import type { Gap, SkillAnalysis } from '../types';
import { LEVELS } from './readiness';

// Three different situations that must never be merged into one "gap":
//   not assessed    - the user has not rated the skill, so CareerGraph does not know (it is not level 0 and not a gap);
//   below target    - rated, but under the level this career asks for;
//   evidence missing/thin - the level may be fine, but nothing (or too little) backs it up.
export interface StatusBreakdown { total: number; notAssessed: number; belowTarget: number; evidenceMissing: number; evidenceThin: number; onTrack: number }
export function statusBreakdown(skills: SkillAnalysis[]): StatusBreakdown {
  const b: StatusBreakdown = { total: skills.length, notAssessed: 0, belowTarget: 0, evidenceMissing: 0, evidenceThin: 0, onTrack: 0 };
  for (const s of skills) {
    if (s.status === 'not_assessed') { b.notAssessed++; continue; }
    if (s.status === 'on_track') { b.onTrack++; continue; }
    if (s.status === 'skill_gap' || s.status === 'combined_gap') b.belowTarget++;
    if (s.status === 'evidence_gap' || s.status === 'combined_gap') { if (s.evidenceCount === 0) b.evidenceMissing++; else b.evidenceThin++; }
  }
  return b;
}

export type SkillTone = 'unknown' | 'below' | 'evidence' | 'ok';
export interface SkillState { tone: SkillTone; label: string; detail: string }
export function skillState(s: SkillAnalysis): SkillState {
  const need = `${LEVELS[s.requiredLevel]} (${s.requiredLevel})`;
  if (s.status === 'not_assessed') return { tone: 'unknown', label: 'Not assessed', detail: `You have not rated this skill, so CareerGraph cannot tell whether it is a gap. This career asks for ${need}.` };
  const ev = s.evidenceCount === 0 ? 'no evidence is linked to it' : 'its linked evidence is thin';
  if (s.status === 'combined_gap') return { tone: 'below', label: 'Below target · evidence ' + (s.evidenceCount === 0 ? 'missing' : 'thin'), detail: `You rated ${LEVELS[s.currentLevel]} (${s.currentLevel}) against ${need}, and ${ev}.` };
  if (s.status === 'skill_gap') return { tone: 'below', label: `Below target (${s.skillGap} level${s.skillGap > 1 ? 's' : ''})`, detail: `You rated ${LEVELS[s.currentLevel]} (${s.currentLevel}); this career asks for ${need}.` };
  if (s.status === 'evidence_gap') return { tone: 'evidence', label: s.evidenceCount === 0 ? 'Evidence missing' : 'Evidence thin', detail: `Your level meets ${need}, but ${ev}. A rating alone is a claim; evidence is what shows it.` };
  return { tone: 'ok', label: 'On track', detail: `Meets ${need} with supporting evidence.` };
}

// Why a gap matters, in plain words built only from data the user can see (importance and the required level), never invented market claims.
export function whyGap(g: Gap): string {
  const weight = g.impact === 'high' ? 'It is a high-importance skill in this career model, so closing it moves your readiness more than most.' : 'It counts toward your readiness in proportion to its importance in this career model.';
  if (g.kind === 'evidence') return `${weight} Your rated level is not the problem here; the missing proof is, and evidence is the part of the score a rating cannot supply.`;
  return `${weight} This career asks for ${LEVELS[g.requiredLevel]}; you are at ${LEVELS[g.currentLevel]}.`;
}
