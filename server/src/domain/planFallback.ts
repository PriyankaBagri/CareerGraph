import type { NextAction } from './readiness';
import { PLAN_LIMITS, type Plan } from '../ai/plan';

const ACTIONS_PER_WEEK = Math.min(3, PLAN_LIMITS.actionIdsPerWeek.max); // a small, doable weekly batch

// Deterministic, non-AI: batches `actions` (already ranked highest-priority-first by calcActions) into weeks in
// that same order. Never reorders, invents, or drops an id — only groups the real ids it was given.
// Expects a non-empty `actions`; the caller (AssistantService.generatePlan) already turns an empty list into its
// own "no actions available" response before this is called.
export function buildFallbackPlan(actions: NextAction[]): Plan {
  const weeks: Plan['weeks'] = [];
  for (let i = 0; i < actions.length && weeks.length < PLAN_LIMITS.weeks.max; i += ACTIONS_PER_WEEK) {
    const batch = actions.slice(i, i + ACTIONS_PER_WEEK);
    const names = batch.map((a) => a.skillName);
    const high = batch.filter((a) => a.priority === 'high').length;
    weeks.push({
      week: weeks.length + 1,
      focus: names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and '),
      actionIds: batch.map((a) => a.id),
      rationale: `${high ? `${high} high-priority action(s)` : 'Actions'} from your current readiness ranking, highest priority first.`,
    });
  }
  return { weeks };
}
