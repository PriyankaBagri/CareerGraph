import type { Action, ActionStatus, ActionType, Career, Level3, Roadmap, RoadmapPhase, SkillAnalysis } from '../types';
import { LEVELS } from './readiness';

// Deterministic, career-agnostic action engine. Inputs: career model, skill analysis (levels + evidence), readiness.
// No career names appear here; titles come from skill/capability names and the career's own evidenceExpectations.
// The priority score is an internal ordering aid, not an objective measure.
export const PHASES: { key: RoadmapPhase; label: string; blurb: string }[] = [
  { key: 'foundation', label: 'Foundation', blurb: 'Build the fundamentals the rest depends on.' },
  { key: 'skill_building', label: 'Skill Building', blurb: 'Raise priority skills to the required level.' },
  { key: 'evidence_building', label: 'Evidence Building', blurb: 'Create proof of what you can do.' },
  { key: 'career_readiness', label: 'Career Readiness', blurb: 'Package your proof for real opportunities.' },
];
export const STATUS_LABEL: Record<ActionStatus, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
export const STATUS_ICON: Record<ActionStatus, string> = { not_started: '○', in_progress: '◐', completed: '●' };

const EFFORT_DIV: Record<Level3, number> = { low: 1, medium: 1.25, high: 1.5 };
const TIME: Record<Level3, string> = { low: '1–2 weeks', medium: '2–4 weeks', high: '1–3 months' };
export const priorityOf = (score: number): Level3 => (score >= 45 ? 'high' : score >= 25 ? 'medium' : 'low');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Generic keyword mapping from an evidence-expectation phrase to an action type.
function typeFromExpectation(text: string): ActionType {
  const t = text.toLowerCase();
  if (/portfolio|case study|collection|published|publication/.test(t)) return 'portfolio';
  if (/intern|rotation|practicum|volunteer|work|experience|clinical/.test(t)) return 'gain_experience';
  if (/certif|licens|exam|course/.test(t)) return 'certification';
  if (/mock|practice|sample|tracker|revision/.test(t)) return 'practice';
  if (/research|thesis|paper|memo|report/.test(t)) return 'research';
  return 'create_evidence';
}

interface Draft { id: string; type: ActionType; title: string; description: string; skill?: SkillAnalysis; importance: number; need: number; effort: Level3; phase: RoadmapPhase; prerequisites: string[]; because: string }

export function generateActions(career: Career, skills: SkillAnalysis[], overall: number): Action[] {
  const gaps = skills.filter((s) => s.status !== 'on_track' && s.status !== 'not_assessed');
  const unassessed = skills.filter((s) => s.status === 'not_assessed');
  if (!gaps.length && !unassessed.length) return [];
  const exp = career.evidenceExpectations ?? [];
  const drafts: Draft[] = [];
  gaps.forEach((s, i) => {
    const importance = 0.5 + s.requiredLevel / 10;
    const skillGapNeed = Math.min(1, s.skillGap / 3);
    const skillId = `act:skill:${s.skillId}`;
    if (s.skillGap > 0) {
      const learnId = `act:learn:${s.skillId}`;
      if (s.skillGap >= 2) drafts.push({ id: learnId, type: 'complete_learning', skill: s, importance, need: skillGapNeed, effort: 'medium', phase: 'foundation', prerequisites: [], title: `Learn the core methods of ${s.name} through one applied task`, description: `Study the fundamentals of ${s.name} (${s.capabilityName}) and apply them in one small task. Expected outcome: you can explain and demonstrate the basics.`, because: `a ${s.skillGap}-level gap in ${s.name} is best closed by structured learning first` });
      const effort: Level3 = s.skillGap >= 3 ? 'high' : s.skillGap === 2 ? 'medium' : 'low';
      drafts.push({ id: skillId, type: s.currentLevel === 0 ? 'build_skill' : 'strengthen_skill', skill: s, importance, need: skillGapNeed, effort, phase: s.skillGap >= 2 || s.currentLevel > 1 ? 'skill_building' : 'foundation', prerequisites: s.skillGap >= 2 ? [learnId] : [],
        title: s.currentLevel === 0 ? `Build ${s.name} from the ground up` : `Strengthen ${s.name}`, description: `Move ${s.name} from ${LEVELS[s.currentLevel]} to ${LEVELS[s.requiredLevel]} by completing and documenting one applied ${s.name} task in ${s.capabilityName}. Expected outcome: finished work you can point to. Potential evidence: ${exp.length ? exp[i % exp.length] : 'a short write-up of what you did and what it showed'}.`,
        because: `${s.name} is expected at ${LEVELS[s.requiredLevel]} level for ${career.name} and you are at ${LEVELS[s.currentLevel]}${s.skillGap > 1 ? ` (${s.skillGap} levels short)` : ''}` });
    }
    if (s.status === 'evidence_gap' || s.status === 'combined_gap') {
      const e = exp.length ? exp[i % exp.length] : null;
      const type = e ? typeFromExpectation(e) : 'create_evidence';
      const verb = s.evidenceCount ? 'Strengthen' : 'Create';
      drafts.push({ id: `act:evidence:${s.skillId}`, type, skill: s, importance, need: s.coverage === 'none' ? 1 : 0.7, effort: type === 'gain_experience' || type === 'certification' ? 'high' : 'medium', phase: 'evidence_building', prerequisites: s.skillGap > 0 ? [skillId] : [],
        title: e ? `${verb} evidence for ${s.name}: ${e}` : `${verb} evidence demonstrating ${s.name}`, description: `Produce something you can show (${e ?? 'applied work'}) that demonstrates ${s.name}, then add it in the Evidence library linked to this skill.`,
        because: `your evidence for ${s.name} is ${s.evidenceCount ? 'limited' : 'missing'}${s.skillGap === 0 ? ' even though you meet the required level' : ''}` });
    }
  });
  if (unassessed.length) drafts.push({ id: `act:assess:${career.id}`, type: 'other', importance: 0.9, need: 1, effort: 'low', phase: 'foundation', prerequisites: [], title: `Complete your skill assessment (${unassessed.length} of ${skills.length} skills)`, description: `Set your current level for each unassessed skill on the Skills page. Expected outcome: CareerGraph can show a real readiness score and your true gaps.`, because: `${unassessed.length} of ${skills.length} skills have not been assessed, so CareerGraph cannot yet tell where you stand` });
  const evIds = drafts.filter((d) => d.phase === 'evidence_building').map((d) => d.id);
  if (gaps.length) drafts.push({ id: `act:ready:${career.id}`, type: 'application_prep', importance: 0.8, need: Math.max(0.1, (100 - overall) / 100), effort: 'medium', phase: 'career_readiness', prerequisites: evIds.length ? evIds : drafts.map((d) => d.id),
    title: `Assemble your ${career.name} readiness package`, description: `Bring your strongest evidence and skill summaries together into one presentable package for ${career.name} opportunities.`, because: `your readiness is ${overall}% and packaging your strongest proof helps once the gaps above close` });

  return drafts.map((d): Action => {
    const score = Math.round((d.importance * d.need * 100) / EFFORT_DIV[d.effort]);
    const priority = priorityOf(score);
    const raw = d.importance * d.need;
    return { id: d.id, careerId: career.id, title: d.title, description: d.description, type: d.type, relatedSkillIds: d.skill ? [d.skill.skillId] : [], relatedCapabilityIds: d.skill ? [d.skill.capabilityId] : [],
      reason: `${cap(priority)} priority because ${d.because}.`, priority, priorityScore: score, impact: raw >= 0.5 ? 'high' : raw >= 0.25 ? 'medium' : 'low', effort: d.effort, status: 'not_started', estimatedTime: TIME[d.effort], prerequisites: d.prerequisites, phase: d.phase, createdAt: '', updatedAt: '' };
  }).sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));
}

export interface StoredAction { status: ActionStatus; updatedAt: string; action: Action }
export type ActionStore = Record<string, StoredAction>;

// Overlay the user's saved statuses. Saved actions whose gap has since closed are kept (history is never deleted).
export function mergeActions(generated: Action[], store: ActionStore): Action[] {
  const live = new Set(generated.map((a) => a.id));
  const merged = generated.map((a) => { const r = store[a.id]; return r ? { ...a, status: r.status, createdAt: r.action.createdAt || r.updatedAt, updatedAt: r.updatedAt } : a; });
  const retained = Object.values(store).filter((r) => !live.has(r.action.id)).map((r): Action => ({ ...r.action, status: r.status, updatedAt: r.updatedAt }));
  return [...merged, ...retained].sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));
}

export const blockedBy = (a: Action, all: Action[]): Action[] => a.prerequisites.map((id) => all.find((x) => x.id === id)).filter((x): x is Action => !!x && x.status !== 'completed');

// Highest-priority open actions whose prerequisites are done; falls back to blocked ones if nothing is ready.
export function nextActions(all: Action[], limit: number): Action[] {
  const open = all.filter((a) => a.status !== 'completed');
  const ready = open.filter((a) => blockedBy(a, all).length === 0);
  return (ready.length ? ready : open).slice(0, limit);
}

export function summarize(all: Action[]) {
  const completed = all.filter((a) => a.status === 'completed').length;
  const inProgress = all.filter((a) => a.status === 'in_progress').length;
  return { total: all.length, completed, inProgress, remaining: all.length - completed - inProgress, progress: all.length ? Math.round((100 * completed) / all.length) : 0 };
}

export function buildRoadmap(careerId: string, actions: Action[]): Roadmap {
  const order = PHASES.map((p) => p.key);
  const sorted = [...actions].sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase) || b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));
  const items = sorted.map((a, i) => ({ id: `rm:${a.id}`, actionId: a.id, title: a.title, description: a.description, phase: a.phase, order: i + 1, status: a.status, relatedSkillIds: a.relatedSkillIds, estimatedTime: a.estimatedTime }));
  const milestones = PHASES.map((p) => { const its = items.filter((i) => i.phase === p.key); const done = its.filter((i) => i.status === 'completed').length; return { phase: p.key, title: p.label, total: its.length, completed: done, progress: its.length ? Math.round((100 * done) / its.length) : 0 }; }).filter((m) => m.total > 0);
  return { careerId, items, milestones, progress: summarize(actions).progress, updatedAt: actions.reduce((m, a) => (a.updatedAt > m ? a.updatedAt : m), '') };
}
