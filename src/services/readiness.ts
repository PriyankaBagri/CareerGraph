import type { Action, CareerDataset, DashboardView, Evidence } from '../types';
import { generateActions } from '../utils/actions';
import { applyLevels, calcGaps, calcReadiness, withEvidence } from '../utils/readiness';
import { analyzeSkills } from '../utils/skills';

// assumeAssessed: treat every skill as rated (the demo profile). Otherwise only skills in `levels` count as assessed.
export interface AnalysisOptions { includeExampleEvidence: boolean; userEvidence: Evidence[]; unassessedLevel?: number; assumeAssessed?: boolean }

// Synchronous, deterministic mock; a backend version should return the same DashboardView shape.
export const readinessService = {
  analyze(dataset: CareerDataset, levels: Record<string, number> = {}, opts: AnalysisOptions = { includeExampleEvidence: false, userEvidence: [] }): DashboardView {
    const withEv = withEvidence(dataset, [...(opts.includeExampleEvidence ? dataset.evidence : []), ...opts.userEvidence]);
    const { career, evidence } = applyLevels(withEv, levels, opts.unassessedLevel);
    const assessed = opts.assumeAssessed ? null : new Set(Object.keys(levels));
    const skills = analyzeSkills(career, evidence, assessed);
    const readiness = calcReadiness(career, evidence, assessed);
    let actions: Action[] = [];
    try { actions = generateActions(career, skills, readiness.overall); } catch { actions = []; } // a failed plan must not break the dashboard
    return { career, evidence, readiness, skills, gaps: calcGaps(skills), actions, evidenceIsExample: opts.includeExampleEvidence };
  },
};
