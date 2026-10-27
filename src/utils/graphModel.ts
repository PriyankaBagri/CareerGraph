import type { Action, Career, Evidence, SkillAnalysis } from '../types';
import { skillState } from './skillStatus';

// The graph as DATA: which nodes and links exist for the selected career, built only from the analysis the app already holds (server readiness, the user's
// evidence links, and the server's ranked actions). No relationship is invented: capability->skill comes from the career model, skill->evidence from the
// user's own links, and skill->action from the action's own related skill. There is NO skill->skill prerequisite link because the data model has none.
export type NodeKind = 'career' | 'capability' | 'skill' | 'evidence' | 'action';
export const COLUMN: Record<NodeKind, number> = { career: 0, capability: 1, skill: 2, evidence: 3, action: 4 };
export const COLUMN_TITLES = ['CAREER', 'CAPABILITIES', 'SKILLS', 'EVIDENCE', 'NEXT ACTIONS'] as const;
export const MAX_ACTION_NODES = 12;
export interface GNode { id: string; kind: NodeKind; label: string; col: number }
export type LinkKind = 'contains' | 'supports' | 'addresses';
export interface GLink { a: string; b: string; kind: LinkKind }
export interface GraphInput { career: Career; evidence: Evidence[]; skills: SkillAnalysis[]; actions: Action[]; attentionOnly?: boolean }
export interface GraphModel { nodes: GNode[]; links: GLink[]; openActions: Action[]; hiddenActions: number; completedActions: number; hiddenSkills: number }

export const actionNodeId = (a: Pick<Action, 'id'>): string => `act:${a.id}`;
export const isActionNode = (id: string): boolean => id.startsWith('act:');
const rankOf = (a: Action): number => a.detail?.rank ?? Number.MAX_SAFE_INTEGER;

export function buildGraphModel({ career, evidence, skills, actions, attentionOnly = false }: GraphInput): GraphModel {
  const analysis = new Map(skills.map((s) => [s.skillId, s]));
  const all = career.capabilities.flatMap((c) => c.skills.map((s) => ({ s, c })));
  // "Needs attention" = anything that is not on track: below target, evidence missing/thin, or not assessed (unknown is not "fine").
  const keep = (id: string) => { const a = analysis.get(id); return !attentionOnly || !a || skillState(a).tone !== 'ok'; };
  const shown = all.filter(({ s }) => keep(s.id));
  const skillIds = new Set(shown.map(({ s }) => s.id));
  const caps = career.capabilities.filter((c) => c.skills.some((s) => skillIds.has(s.id)) || !attentionOnly);
  const ev = attentionOnly ? evidence.filter((e) => shown.some(({ s }) => s.evidenceIds.includes(e.id))) : evidence;

  const open = actions.filter((a) => a.status !== 'completed' && a.relatedSkillIds.some((id) => skillIds.has(id)))
    .sort((x, y) => rankOf(x) - rankOf(y) || y.priorityScore - x.priorityScore || x.id.localeCompare(y.id));
  const acts = open.slice(0, MAX_ACTION_NODES);
  const completed = actions.filter((a) => a.status === 'completed' && a.relatedSkillIds.some((id) => skillIds.has(id))).length;

  // Evidence is ordered by where its skills sit (average position of the linked skills) so links run mostly left to right instead of crossing.
  const skillPos = new Map(shown.map(({ s }, i) => [s.id, i]));
  const bary = (e: Evidence): number => { const at = shown.filter(({ s }) => s.evidenceIds.includes(e.id)).map(({ s }) => skillPos.get(s.id) as number); return at.length ? at.reduce((a, b) => a + b, 0) / at.length : Number.MAX_SAFE_INTEGER; };
  const evOrdered = ev.map((e, i) => ({ e, i, b: bary(e) })).sort((x, y) => x.b - y.b || x.i - y.i).map((x) => x.e);
  const nodes: GNode[] = [
    { id: career.id, kind: 'career', label: career.name, col: COLUMN.career },
    ...caps.map((c): GNode => ({ id: c.id, kind: 'capability', label: c.name, col: COLUMN.capability })),
    ...shown.map(({ s }): GNode => ({ id: s.id, kind: 'skill', label: s.name, col: COLUMN.skill })),
    ...evOrdered.map((e): GNode => ({ id: e.id, kind: 'evidence', label: e.title, col: COLUMN.evidence })),
    ...acts.map((a): GNode => ({ id: actionNodeId(a), kind: 'action', label: a.title, col: COLUMN.action })),
  ];
  const evIds = new Set(ev.map((e) => e.id));
  const links: GLink[] = [
    ...caps.map((c): GLink => ({ a: career.id, b: c.id, kind: 'contains' })),
    ...shown.map(({ s, c }): GLink => ({ a: c.id, b: s.id, kind: 'contains' })),
    ...shown.flatMap(({ s }) => s.evidenceIds.filter((e) => evIds.has(e)).map((e): GLink => ({ a: s.id, b: e, kind: 'supports' }))),
    ...acts.flatMap((a) => a.relatedSkillIds.filter((id) => skillIds.has(id)).map((id): GLink => ({ a: id, b: actionNodeId(a), kind: 'addresses' }))),
  ];
  return { nodes, links, openActions: acts, hiddenActions: open.length - acts.length, completedActions: completed, hiddenSkills: all.length - shown.length };
}

export type Dir = 'up' | 'down' | 'left' | 'right';
// Arrow-key navigation: up/down move within a column; left/right follow a real link toward the career or toward evidence/actions.
export function neighborId(model: GraphModel, id: string, dir: Dir): string {
  const me = model.nodes.find((n) => n.id === id);
  if (!me) return model.nodes[0]?.id ?? id;
  if (dir === 'up' || dir === 'down') {
    const col = model.nodes.filter((n) => n.col === me.col), i = col.findIndex((n) => n.id === id);
    return col[Math.max(0, Math.min(col.length - 1, i + (dir === 'down' ? 1 : -1)))].id;
  }
  const linked = model.links.flatMap((l) => (l.a === id ? [l.b] : l.b === id ? [l.a] : []));
  const col = new Map(model.nodes.map((n) => [n.id, n.col]));
  const order = new Map(model.nodes.map((n, i) => [n.id, i]));
  const cand = linked.filter((x) => (dir === 'right' ? (col.get(x) ?? -1) > me.col : (col.get(x) ?? 99) < me.col));
  if (!cand.length) return id;
  const nearest = (a: string, b: string) => (dir === 'right' ? (col.get(a) as number) - (col.get(b) as number) : (col.get(b) as number) - (col.get(a) as number)) || (order.get(a) as number) - (order.get(b) as number);
  return [...cand].sort(nearest)[0];
}

// A short, distinguishable label for an action node. Action titles often share a long prefix ("Create evidence for <career>: <skill>..."), so after
// truncation they would all read the same. The verb plus the skill name keeps them apart; the full title stays in the tooltip, name and panel.
const ACTION_VERB: Partial<Record<Action['type'], string>> = { build_skill: 'Raise', strengthen_skill: 'Strengthen', create_evidence: 'Evidence', portfolio: 'Evidence' };
export function actionShortLabel(a: Action, skillName: string | undefined): string {
  const kind = a.detail?.kind;
  const verb = kind === 'assess_skill' ? 'Rate' : kind === 'add_evidence' ? 'Evidence' : kind === 'build_skill' ? 'Raise' : ACTION_VERB[a.type];
  return verb && skillName ? `${verb}: ${skillName}` : a.title;
}
