import type { Action, AssistantAnswer, AssistantContext, AssistantReference, DashboardView, Profile, Roadmap, SkillAnalysis } from '../types';
import { nextActions } from './actions';
import { COVERAGE_LABEL, SKILL_STATUS, STRENGTH_LABEL, STRENGTH_ORDER } from './constants';
import { LEVELS } from './readiness';

// Deterministic explainer over existing CareerGraph data. It is rule-based, NOT an AI model, and contains no career names:
// every name in an answer comes from the context it is given.
export function buildAssistantContext(view: DashboardView, actions: Action[], roadmap: Roadmap, profile: Profile): AssistantContext {
  return { careerId: view.career.id, careerName: view.career.name, careerDescription: view.career.description, readiness: view.readiness, skills: view.skills, gaps: view.gaps, actions, roadmapProgress: roadmap.progress, evidence: view.evidence, profile: { stage: profile.stage, education: profile.education, note: profile.experienceSummary } };
}

const skillRef = (s: SkillAnalysis): AssistantReference => ({ kind: 'skill', label: s.name, href: `/skills/${encodeURIComponent(s.skillId)}` });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const gapLine = (s: SkillAnalysis) => s.status === 'evidence_gap' ? `${s.name}: you meet the required ${LEVELS[s.requiredLevel]} level, but your evidence is ${s.evidenceCount ? 'thin' : 'missing'} (evidence gap).`
  : `${s.name}: you are at ${LEVELS[s.currentLevel]} and the model expects ${LEVELS[s.requiredLevel]} (${plural(s.skillGap, 'level')} short)${s.status === 'combined_gap' ? `, and your evidence is ${s.evidenceCount ? 'thin' : 'missing'} (skill + evidence gap)` : ' (skill gap)'}.`;

export function explainReadiness(c: AssistantContext): AssistantAnswer {
  const r = c.readiness, a = r.assessment;
  if (a.state === 'not_assessed') return { text: `Your readiness for ${c.careerName} has not been assessed yet: ${a.assessed} of ${a.total} skills are rated, so there is no score to explain (and it is not zero). Rate your current level for each skill on the Skills page, then ask me again.`, references: [{ kind: 'skill', label: 'Skills', href: '/skills' }] };
  const parts = r.metrics.map((m) => `${m.label} ${m.value}%`).join(', ');
  const why = r.reasons.map((x) => x.text).join('; ');
  return { text: `Your readiness for ${c.careerName} is ${r.overall}%. ${r.summary} It combines: ${parts}.${why ? ` What drives it: ${why}.` : ''}${a.state === 'partial' ? ` It is based on ${a.assessed} of ${a.total} rated skills.` : ''} Readiness shows how well your assessed skills and evidence match this career's model. It is not a prediction, and it is separate from roadmap progress (${c.roadmapProgress}%).`, references: [{ kind: 'readiness', label: `Readiness ${r.overall}%`, href: '/dashboard' }] };
}
export function explainGaps(c: AssistantContext): AssistantAnswer {
  const all = c.skills.filter((s) => s.status !== 'on_track' && s.status !== 'not_assessed');
  const top = [...all].sort((a, b) => b.skillGap - a.skillGap || a.name.localeCompare(b.name)).slice(0, 3);
  const unassessed = c.skills.filter((s) => s.status === 'not_assessed').length;
  const note = unassessed ? ` ${plural(unassessed, 'skill')} not assessed yet and not counted as gaps.` : '';
  if (!top.length) return { text: unassessed ? `No gaps can be identified yet.${note} Rate your skills to see where you stand.` : `You currently meet the required level, with enough evidence, for every skill in the ${c.careerName} model. Keep your evidence up to date.`, references: [], items: [] };
  return { text: `Your most important gaps for ${c.careerName} (${plural(all.length, 'gap')} in total):${note}`, references: top.map(skillRef), items: top.map((s) => ({ kind: 'skill' as const, title: s.name, detail: gapLine(s), href: `/skills/${encodeURIComponent(s.skillId)}` })) };
}
export function explainEvidenceStatus(c: AssistantContext): AssistantAnswer {
  const without = c.skills.filter((s) => s.evidenceCount === 0);
  const best = [...c.evidence].sort((a, b) => STRENGTH_ORDER.indexOf(b.strength) - STRENGTH_ORDER.indexOf(a.strength))[0];
  if (!c.evidence.length) return { text: `You have no evidence for the ${c.careerName} model yet. Add projects, work, courses or other proof in the Evidence library and link each to the skills it demonstrates.`, references: [{ kind: 'evidence', label: 'Evidence library', href: '/evidence' }], items: [] };
  return { text: `${plural(c.skills.length - without.length, 'skill')} of ${c.skills.length} in the ${c.careerName} model have supporting evidence. Your strongest piece is "${best.title}" (${STRENGTH_LABEL[best.strength].toLowerCase()}).${without.length ? ' Skills still without evidence:' : ''}`, references: [{ kind: 'evidence', label: best.title, href: '/evidence' }, ...without.slice(0, 3).map(skillRef)], items: without.slice(0, 4).map((s) => ({ kind: 'skill' as const, title: s.name, detail: 'No evidence linked yet.', href: `/skills/${encodeURIComponent(s.skillId)}` })) };
}
export function explainNext(c: AssistantContext): AssistantAnswer {
  const next = nextActions(c.actions, 3);
  if (!next.length) return { text: c.actions.length ? 'Every planned action is marked completed. Keep your evidence up to date and revisit your skills as you grow.' : `You are currently on track for every assessed skill in the ${c.careerName} model, so there are no open actions.`, references: [{ kind: 'roadmap', label: 'Roadmap', href: '/roadmap' }], items: [] };
  return { text: `Your next best actions for ${c.careerName}:`, references: next.map((a): AssistantReference => ({ kind: 'action', label: a.title, href: '/roadmap' })), items: next.map((a) => ({ kind: 'action' as const, title: a.title, detail: a.reason, href: '/roadmap' })) };
}
export function explainAction(c: AssistantContext, question: string): AssistantAnswer {
  const q = question.toLowerCase();
  const a = c.actions.find((x) => q.includes(x.title.toLowerCase())) ?? c.actions.find((x) => x.relatedSkillIds.some((id) => { const s = c.skills.find((k) => k.skillId === id); return !!s && q.includes(s.name.toLowerCase()); })) ?? nextActions(c.actions, 1)[0];
  if (!a) return { text: `There are no open actions right now, so there is nothing to explain.`, references: [] };
  const pre = a.prerequisites.length ? ` It depends on: ${a.prerequisites.map((id) => c.actions.find((x) => x.id === id)?.title ?? id).join('; ')}.` : '';
  return { text: `"${a.title}": ${a.reason} ${a.description} ${a.effort ? `Estimated effort: ${a.effort}${a.estimatedTime ? ` (${a.estimatedTime})` : ''}.` : ''}${pre} The priority score is an internal ordering aid, not an objective measure.`, references: [{ kind: 'action', label: a.title, href: '/roadmap' }, ...c.skills.filter((s) => a.relatedSkillIds.includes(s.skillId)).map(skillRef)] };
}
export function explainEvidenceSkill(c: AssistantContext, question: string): AssistantAnswer {
  const q = question.toLowerCase();
  const ev = c.evidence.find((e) => q.includes(e.title.toLowerCase())) ?? [...c.evidence].sort((a, b) => STRENGTH_ORDER.indexOf(b.strength) - STRENGTH_ORDER.indexOf(a.strength))[0];
  if (!ev) return explainEvidenceStatus(c);
  const sup = c.skills.filter((s) => ev.skillIds.includes(s.skillId));
  const body = sup.length ? sup.map((s) => `For ${s.name} it contributes to ${COVERAGE_LABEL[s.coverage].toLowerCase()} evidence coverage (${plural(s.evidenceCount, 'piece')}, strongest ${s.strongest ? STRENGTH_LABEL[s.strongest].toLowerCase() : 'none'}); that skill is currently "${SKILL_STATUS[s.status].label}".`).join(' ') : `It is not linked to a skill in the ${c.careerName} model, so it does not affect readiness here.`;
  return { text: `"${ev.title}" is ${STRENGTH_LABEL[ev.strength].toLowerCase()} evidence (${ev.type}). ${body} Stronger, more varied evidence raises the evidence part of your readiness.`, references: [{ kind: 'evidence', label: ev.title, href: '/evidence' }, ...sup.map(skillRef)] };
}
export function explainProfile(c: AssistantContext): AssistantAnswer {
  const unassessed = c.skills.filter((s) => s.status === 'not_assessed').length;
  const on = c.skills.filter((s) => s.status === 'on_track').length;
  const withEv = c.skills.filter((s) => s.evidenceCount > 0).length;
  const bg = [c.profile.stage, c.profile.education].filter(Boolean).join(', ');
  return { text: `Mapped to ${c.careerName}: ${on} of ${c.skills.length} skills are on track, ${withEv} have supporting evidence, and ${plural(c.gaps.length, 'gap')} remain${unassessed ? ` (${plural(unassessed, 'skill')} not assessed yet)` : ''}. ${bg ? `Your background (${bg}) is kept for context, ` : 'Your background is kept for context, '}but the mapping uses your assessed skill levels and your evidence, not your job history. Role summary: ${c.careerDescription}`, references: [{ kind: 'profile', label: 'Profile', href: '/profile' }, { kind: 'roadmap', label: `Roadmap ${c.roadmapProgress}%`, href: '/roadmap' }] };
}
export function explainHelp(c: AssistantContext): AssistantAnswer {
  return { text: `I can explain your ${c.careerName} readiness, your biggest skill and evidence gaps, why an action is recommended, how a piece of evidence supports a skill, what to do next, and how your profile maps to this career. Try one of the suggested questions.`, references: [] };
}

export type Intent = 'readiness' | 'gaps' | 'evidence' | 'next' | 'action' | 'evidenceSkill' | 'profile' | 'help' | 'general';
// Only questions that are clearly about THIS user's saved CareerGraph data reach a data handler. Anything else is 'general': this rule-based explainer
// cannot answer it, and it must say so instead of showing an unrelated readiness or evidence summary.
export function detectIntent(question: string, c: AssistantContext): Intent {
  const q = question.toLowerCase().trim();
  if (!q || /^(help|what can you (do|answer)|how do you work)\b/.test(q)) return 'help';
  const mentionsEvidence = c.evidence.some((e) => q.includes(e.title.toLowerCase()));
  const mentionsAction = c.actions.some((a) => q.includes(a.title.toLowerCase()));
  const mentionsSkill = c.skills.some((s) => q.includes(s.name.toLowerCase()));
  const mine = /\b(my|me|mine|myself)\b|\bi (am|have|do|should|need|can)\b|\b(should|can|do|am|could) i\b|\bi'm\b/.test(q) || mentionsEvidence || mentionsAction || mentionsSkill;
  if (mine && /(strengthen|support|help|improve|demonstrate).*(skill|evidence)|evidence.*(strengthen|support|help|improve)/.test(q) && (/evidence|portfolio|project/.test(q) || mentionsEvidence) && !/why/.test(q)) return 'evidenceSkill';
  if (mentionsEvidence && /how|what/.test(q)) return 'evidenceSkill';
  if (/why/.test(q) && (mentionsAction || (mine && /recommend|action|priorit|should i/.test(q)))) return 'action';
  if (/readiness|\bscore\b|how ready/.test(q)) return 'readiness';
  if (mine && /\bevidence\b/.test(q)) return 'evidence';
  if (mine && /\bgaps?\b|missing|weak|biggest|lack|behind/.test(q)) return 'gaps';
  if (mine && /what should i (do|work on|focus)|next (step|action|thing)|do next|do now|work on|priorit/.test(q)) return 'next';
  if (/\b(my|me)\b.*\b(profile|background|experience)\b|profile.*(map|fit|align)/.test(q)) return 'profile';
  return 'general';
}
// Said once, plainly: this is the rule-based explainer, not an AI model, so it does not pretend to answer.
export function explainOutsideData(c: AssistantContext): AssistantAnswer {
  return { text: `That looks like a general question, and this rule-based explainer cannot answer it: it is not an AI model and only explains your saved CareerGraph data. A live AI model is needed for open-ended questions. Meanwhile I can explain your ${c.careerName} readiness, your skill and evidence gaps, why an action is recommended and what to do next. Try one of the suggested questions.`, references: [] };
}
export function answerQuestion(question: string, c: AssistantContext): AssistantAnswer {
  switch (detectIntent(question, c)) {
    case 'readiness': return explainReadiness(c);
    case 'gaps': return explainGaps(c);
    case 'evidence': return explainEvidenceStatus(c);
    case 'next': return explainNext(c);
    case 'action': return explainAction(c, question);
    case 'evidenceSkill': return explainEvidenceSkill(c, question);
    case 'profile': return explainProfile(c);
    case 'help': return explainHelp(c);
    default: return explainOutsideData(c);
  }
}
// Suggestions only mention a gap or evidence when the user's own data has one, so a button never implies something the data does not show.
export function suggestedPrompts(c: AssistantContext): string[] {
  const top = nextActions(c.actions, 1)[0];
  return [
    c.readiness.assessment.state === 'not_assessed' ? 'Why is my readiness not assessed?' : `Why is my readiness ${c.readiness.overall}%?`,
    ...(c.gaps.length > 0 ? ['What is my biggest gap?'] : []),
    ...(c.evidence.length > 0 ? ['Which evidence helps me most?'] : []),
    'What should I work on next?',
    `How does my profile map to ${c.careerName}?`,
    ...(top ? [`Why is "${top.title}" recommended?`] : []),
  ];
}
