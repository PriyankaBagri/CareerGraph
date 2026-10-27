import type { NextAction, ReadinessResult } from './readiness';

// The career graph as DATA for a visualization, built ONLY from records the server already holds: the career model (through the readiness result),
// the user's own evidence links and the ranked actions with the user's saved progress. Nothing is invented: there is no skill->skill
// prerequisite link because the data model has none, and an unassessed skill has currentLevel null, not 0.
export type GraphNodeKind = 'career' | 'capability' | 'skill' | 'evidence' | 'action';
export type GraphLinkKind = 'contains' | 'supports' | 'addresses';
export interface GraphEvidence { id: string; title: string; type: string; strength: string; source: string; skillIds: string[] }
export type ActionState = 'not_started' | 'in_progress' | 'completed';
export interface GraphAction extends NextAction { status: ActionState }
export interface GraphNode { id: string; kind: GraphNodeKind; label: string; data: Record<string, unknown> }
export interface GraphLink { source: string; target: string; kind: GraphLinkKind }
export interface CareerGraphView {
  careerId: string; careerName: string; readiness: { state: ReadinessResult['state']; score: number | null };
  nodes: GraphNode[]; links: GraphLink[];
  summary: { capabilities: number; skills: number; assessedSkills: number; evidence: number; links: number; actions: number; completedActions: number };
  notes: string[];
}
export const actionNodeId = (actionId: string) => `action:${actionId}`;

export function buildCareerGraph(r: ReadinessResult, evidence: GraphEvidence[], actions: GraphAction[]): CareerGraphView {
  const skillIds = new Set(r.skills.map((s) => s.skillId));
  const mine = evidence.filter((e) => e.skillIds.some((id) => skillIds.has(id)));
  const caps: { id: string; name: string }[] = [];
  for (const s of r.skills) if (!caps.some((c) => c.id === s.capabilityId)) caps.push({ id: s.capabilityId, name: s.capabilityName });
  const acts = actions.filter((a) => skillIds.has(a.skillId));
  const nodes: GraphNode[] = [
    { id: r.careerId, kind: 'career', label: r.careerName, data: { readinessState: r.state, readinessScore: r.score } },
    ...caps.map((c): GraphNode => ({ id: c.id, kind: 'capability', label: c.name, data: {} })),
    ...r.skills.map((s): GraphNode => ({ id: s.skillId, kind: 'skill', label: s.name, data: { capabilityId: s.capabilityId, requiredLevel: s.requiredLevel, importance: s.importance, assessed: s.assessed, currentLevel: s.currentLevel, status: s.status, gap: s.gap, evidenceCount: s.evidenceCount, evidenceStatus: s.evidenceStatus, skillScore: s.skillScore, contribution: s.contribution } })),
    ...mine.map((e): GraphNode => ({ id: e.id, kind: 'evidence', label: e.title, data: { type: e.type, strength: e.strength, source: e.source, verified: false } })), // nothing in the data model verifies evidence
    ...acts.map((a): GraphNode => ({ id: actionNodeId(a.id), kind: 'action', label: a.recommendation, data: { type: a.type, rank: a.rank, priority: a.priority, priorityScore: a.priorityScore, status: a.status, reason: a.reason, completionCriterion: a.completionCriterion, skillId: a.skillId } })),
  ];
  const links: GraphLink[] = [
    ...caps.map((c): GraphLink => ({ source: r.careerId, target: c.id, kind: 'contains' })),
    ...r.skills.map((s): GraphLink => ({ source: s.capabilityId, target: s.skillId, kind: 'contains' })),
    ...mine.flatMap((e) => e.skillIds.filter((id) => skillIds.has(id)).map((id): GraphLink => ({ source: id, target: e.id, kind: 'supports' }))),
    ...acts.map((a): GraphLink => ({ source: a.skillId, target: actionNodeId(a.id), kind: 'addresses' })),
  ];
  const notes = ['Evidence is self-reported and not independently verified.', 'Skills have no prerequisite links because the career model does not define any.'];
  if (r.state === 'not_assessed') notes.push('No skills are rated yet, so there is no readiness score.');
  return { careerId: r.careerId, careerName: r.careerName, readiness: { state: r.state, score: r.score }, nodes, links,
    summary: { capabilities: caps.length, skills: r.skills.length, assessedSkills: r.counts.assessed, evidence: mine.length, links: links.length, actions: acts.length, completedActions: acts.filter((a) => a.status === 'completed').length }, notes };
}
