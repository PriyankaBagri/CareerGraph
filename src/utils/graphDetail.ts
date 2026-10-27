import type { Action, EvaluationRulesView, Evidence, SkillAnalysis } from '../types';
import { explainSkill } from './explain';
import { provenanceBadge } from './provenance';
import { skillState } from './skillStatus';

export interface Guidance { priorityCriteria: string; evidenceExpectations: string[] }
export interface EvidenceIdea { source: 'completion criterion' | 'career definition' | 'guidance'; text: string }
export interface ActionExplanation {
  kind: NonNullable<Action['detail']>['kind'] | null;
  rank: number | null; ofOpen: number; priority: Action['priority']; score: number;
  skill: { id: string; name: string; label: string; detail: string } | null;
  whyRanked: string[]; ruleText: string | null; doneWhen: string | null; evidenceToProduce: EvidenceIdea[]; status: Action['status'];
}

// Why this action is where it is: the server's reason, the server's score (with its arithmetic ONLY when it reproduces the score exactly), and the ranking rule.
export function explainAction(a: Action, skills: SkillAnalysis[], openCount: number, guidance?: Guidance): ActionExplanation {
  const s = skills.find((x) => a.relatedSkillIds.includes(x.skillId)) ?? null;
  const kind = a.detail?.kind ?? null, b = s?.breakdown;
  let math: string | null = null;
  if (s && b && kind === 'build_skill') { if (2 * s.skillGap * b.importance === a.priorityScore) math = `Score ${a.priorityScore} = 2 x gap ${s.skillGap} x importance ${b.importance}.`; }
  else if (s && b && kind === 'assess_skill') { const bonus = s.requiredLevel >= 4 ? 1 : 0; if (b.importance + bonus === a.priorityScore) math = `Score ${a.priorityScore} = importance ${b.importance}${bonus ? ' + 1 (required level is 4 or higher)' : ''}.`; }
  else if (s && b && kind === 'add_evidence') { if (Math.round(0.5 * b.importance * (1 - b.evidenceRatio) * 100) / 100 === a.priorityScore) math = `Score ${a.priorityScore} = 0.5 x importance ${b.importance} x (1 - evidence credit ${Math.round(b.evidenceRatio * 100)}%).`; }
  const exp = guidance?.evidenceExpectations ?? [];
  const evidenceToProduce: EvidenceIdea[] = [];
  if (kind === 'add_evidence' && a.detail) evidenceToProduce.push({ source: 'completion criterion', text: a.detail.completionCriterion });
  if (kind === 'build_skill') {
    evidenceToProduce.push({ source: 'guidance', text: 'After you have genuinely reached the level, link something real that shows it (a project, course or work example).' });
    if (a.detail) evidenceToProduce.push({ source: 'completion criterion', text: a.detail.completionCriterion });
  }
  if ((kind === 'add_evidence' || kind === 'build_skill') && exp.length) evidenceToProduce.push({ source: 'career definition', text: `This career lists these evidence examples: ${exp.slice(0, 4).join('; ')}.` });
  if (kind === 'assess_skill') evidenceToProduce.push({ source: 'guidance', text: 'No evidence is needed to assess a skill. Rate your level first; evidence you add later then counts toward the score.' });
  const st = s ? skillState(s) : null;
  return {
    kind, rank: a.detail?.rank ?? null, ofOpen: openCount, priority: a.priority, score: a.priorityScore, status: a.status,
    skill: s && st ? { id: s.skillId, name: s.name, label: st.label, detail: st.detail } : null,
    whyRanked: [a.reason, ...(math ? [math] : [`Score ${a.priorityScore}.`]), `Priority band: ${a.priority}.`],
    ruleText: guidance?.priorityCriteria ?? null, doneWhen: a.detail?.completionCriterion ?? null, evidenceToProduce,
  };
}

export interface SkillPanel {
  id: string; name: string; capability: string; label: string; detail: string; tone: ReturnType<typeof skillState>['tone'];
  evidence: { id: string; title: string; strength: string; provenance: string }[]; actions: Action[]; whatIf: string | null; assessed: boolean;
}
export function skillPanel(s: SkillAnalysis, evidence: Evidence[], actions: Action[], rules?: EvaluationRulesView): SkillPanel {
  const st = skillState(s), x = explainSkill(s, rules);
  return {
    id: s.skillId, name: s.name, capability: s.capabilityName, label: st.label, detail: st.detail, tone: st.tone, assessed: s.assessed,
    evidence: evidence.filter((e) => e.skillIds.includes(s.skillId)).map((e) => ({ id: e.id, title: e.title, strength: e.strength, provenance: provenanceBadge(e).text })),
    actions: actions.filter((a) => a.relatedSkillIds.includes(s.skillId) && a.status !== 'completed'), whatIf: x?.whatIf[0] ?? null,
  };
}
