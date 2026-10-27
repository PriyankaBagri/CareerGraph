import type { Action, DashboardView } from '../types';

export interface PlainSummary { where: string; rated: string; contributing: string | null; gaps: string | null; evidence: string; next: { title: string; why: string } | null; honesty: string }
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// Plain-language answers to "where am I, what next, why". Built ONLY from the view the server already computed: no new score, no new rule.
export function plainSummary(view: DashboardView, actions: Action[]): PlainSummary {
  const skills = view.skills, total = skills.length;
  const rated = skills.filter((s) => s.assessed), unrated = total - rated.length;
  const meets = rated.filter((s) => s.currentLevel >= s.requiredLevel), below = rated.filter((s) => s.currentLevel < s.requiredLevel);
  const state = view.readiness.assessment.state;
  const where = state === 'not_assessed'
    ? `CareerGraph cannot say yet how you match ${view.career.name}: only ${rated.length} of ${total} skills are rated. Unrated skills are unknown, not zero.`
    : `${view.readiness.overall}% is CareerGraph's progress indicator for ${view.career.name}. It combines the levels you rated and the evidence linked to those skills${state === 'partial' ? `, using only the ${rated.length} skills you have rated so far` : ''}.`;
  const withEvidence = rated.filter((s) => s.evidenceCount > 0).length;
  const open = actions.filter((a) => a.status !== 'completed')[0];
  const g = open?.detail?.guidance;
  return {
    where,
    rated: `${rated.length} of ${total} skills are rated${unrated ? `; ${unrated} still unrated: ${list(skills.filter((k) => !k.assessed).slice(0, 4).map((k) => k.name))}${unrated > 4 ? ` and ${unrated - 4} more` : ''} (unknown, not counted as gaps)` : ''}.`,
    contributing: meets.length ? `Skills at or above the level this career expects: ${list(meets.slice(0, 4).map((s) => s.name))}${meets.length > 4 ? ` and ${meets.length - 4} more` : ''}.` : null,
    gaps: below.length ? `Rated below the expected level: ${list([...below].sort((a, b) => (b.requiredLevel - b.currentLevel) - (a.requiredLevel - a.currentLevel)).slice(0, 3).map((s) => s.name))}.` : null,
    evidence: rated.length === 0 ? 'Evidence supports a rating once you have rated a skill.' : `${withEvidence} of your ${rated.length} rated skills have evidence linked. Evidence you add yourself is shown as unverified.`,
    next: open ? { title: g?.title ?? open.title, why: g?.whyNow ?? open.reason } : null,
    honesty: 'This is a rule-based guide to your own progress. It is not a prediction of getting a job or internship.',
  };
}
