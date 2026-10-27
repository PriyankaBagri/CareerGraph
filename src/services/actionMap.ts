import type { Action, ActionStatus, ActionType, Level3, RoadmapPhase } from '../types';
import type { ActionStore } from '../utils/actions';
import type { ApiActionSnapshot, ApiProgress } from './coreApi';

// Server progress rows -> the ActionStore the UI already uses. "Not started" has no row, so it is simply absent.
export function toActionStore(items: ApiProgress[]): ActionStore {
  const store: ActionStore = {};
  for (const r of items) {
    const s = r.snapshot;
    const action: Action = {
      id: r.actionKey, careerId: r.careerId, title: s.title, description: s.description, type: s.type as ActionType, relatedSkillIds: s.relatedSkillIds, relatedCapabilityIds: s.relatedCapabilityIds,
      reason: s.reason, priority: s.priority as Level3, priorityScore: s.priorityScore, impact: s.impact as Level3, effort: s.effort as Level3, status: r.status as ActionStatus,
      estimatedTime: s.estimatedTime || undefined, prerequisites: s.prerequisites, phase: s.phase as RoadmapPhase, createdAt: s.createdAt, updatedAt: r.updatedAt,
    };
    store[r.actionKey] = { status: r.status, updatedAt: r.updatedAt, action };
  }
  return store;
}
export function toSnapshot(a: Action): Omit<ApiActionSnapshot, 'createdAt'> {
  return {
    title: a.title.slice(0, 200), description: a.description.slice(0, 1000), type: a.type, phase: a.phase, priority: a.priority, priorityScore: Math.max(0, Math.min(1000, Math.round(a.priorityScore))),
    impact: a.impact, effort: a.effort ?? 'medium', estimatedTime: (a.estimatedTime ?? '').slice(0, 60), reason: a.reason.slice(0, 1000),
    prerequisites: a.prerequisites.slice(0, 30), relatedSkillIds: a.relatedSkillIds.slice(0, 50), relatedCapabilityIds: a.relatedCapabilityIds.slice(0, 50),
  };
}
