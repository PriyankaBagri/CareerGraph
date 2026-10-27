// Evaluation rules: the tunable parts of the readiness calculation, kept as DATA so a career can carry its own settings without code changes.
// The built-in defaults reproduce the original single formula exactly. A custom career may override them; the override is stored with the career,
// echoed back in every readiness result (so the user can see which rules produced a number), and never presented as an external or professional standard.
export const STRENGTHS = ['weak', 'moderate', 'strong', 'very_strong'] as const;
export interface EvaluationRules {
  /** Share of a skill's score that comes from the self-rated level (the rest comes from evidence). 0.5 to 0.95. */
  levelWeight: number;
  /** Evidence points needed for full evidence credit = requiredLevel * this factor. 0.5 to 3. */
  evidenceFullFactor: number;
  /** An evidence ratio below this counts as "thin". 0.1 to 0.9. */
  evidenceThinBelow: number;
  /** Points each evidence strength contributes. Whole numbers 0 to 10; must not decrease from weak to very_strong. */
  strengthPoints: Record<(typeof STRENGTHS)[number], number>;
}
export const DEFAULT_RULES: Readonly<EvaluationRules> = Object.freeze({ levelWeight: 0.75, evidenceFullFactor: 1.2, evidenceThinBelow: 0.5, strengthPoints: Object.freeze({ weak: 1, moderate: 2, strong: 3, very_strong: 4 }) as EvaluationRules['strengthPoints'] });
export type RulesSource = 'default' | 'custom';
export interface ResolvedRules { source: RulesSource; rules: EvaluationRules }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
// Validates untrusted input (request body or a stored value). Unknown keys are rejected so typos never silently do nothing.
export function parseRules(raw: unknown): { rules: Partial<EvaluationRules> | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (raw === undefined || raw === null) return { rules: null, errors };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { rules: null, errors: { evaluationRules: 'Must be an object.' } };
  const o = raw as Record<string, unknown>, out: Partial<EvaluationRules> = {};
  for (const k of Object.keys(o)) if (!['levelWeight', 'evidenceFullFactor', 'evidenceThinBelow', 'strengthPoints'].includes(k)) errors[`evaluationRules.${k}`] = 'Unknown setting.';
  const range = (k: 'levelWeight' | 'evidenceFullFactor' | 'evidenceThinBelow', lo: number, hi: number) => {
    if (o[k] === undefined) return;
    if (!num(o[k]) || (o[k] as number) < lo || (o[k] as number) > hi) errors[`evaluationRules.${k}`] = `Must be a number from ${lo} to ${hi}.`; else out[k] = o[k] as number;
  };
  range('levelWeight', 0.5, 0.95); range('evidenceFullFactor', 0.5, 3); range('evidenceThinBelow', 0.1, 0.9);
  if (o.strengthPoints !== undefined) {
    const sp = o.strengthPoints as Record<string, unknown>;
    if (typeof sp !== 'object' || sp === null || Array.isArray(sp)) errors['evaluationRules.strengthPoints'] = 'Must be an object.';
    else {
      const merged: Record<string, number> = { ...DEFAULT_RULES.strengthPoints };
      for (const k of Object.keys(sp)) {
        if (!(STRENGTHS as readonly string[]).includes(k)) errors[`evaluationRules.strengthPoints.${k}`] = 'Unknown strength.';
        else if (!num(sp[k]) || !Number.isInteger(sp[k]) || (sp[k] as number) < 0 || (sp[k] as number) > 10) errors[`evaluationRules.strengthPoints.${k}`] = 'Must be a whole number from 0 to 10.';
        else merged[k] = sp[k] as number;
      }
      if (!Object.keys(errors).some((e) => e.startsWith('evaluationRules.strengthPoints'))) {
        if (!(merged.weak <= merged.moderate && merged.moderate <= merged.strong && merged.strong <= merged.very_strong)) errors['evaluationRules.strengthPoints'] = 'Stronger evidence must never be worth fewer points than weaker evidence.';
        else out.strengthPoints = merged as EvaluationRules['strengthPoints'];
      }
    }
  }
  return { rules: Object.keys(errors).length ? null : out, errors };
}
// Merge validated overrides over the defaults. Invalid stored data falls back to the defaults (and says so through `source`).
export function resolveRules(stored: unknown): ResolvedRules {
  const { rules, errors } = parseRules(stored);
  if (!rules || Object.keys(errors).length || Object.keys(rules).length === 0) return { source: 'default', rules: { ...DEFAULT_RULES, strengthPoints: { ...DEFAULT_RULES.strengthPoints } } };
  return { source: 'custom', rules: { ...DEFAULT_RULES, ...rules, strengthPoints: { ...DEFAULT_RULES.strengthPoints, ...(rules.strengthPoints ?? {}) } } };
}
export function describeRules(r: EvaluationRules): string {
  const lw = Math.round(r.levelWeight * 100), ew = 100 - lw, sp = r.strengthPoints;
  return `skillScore = ${lw / 100} * min(level/required, 1) + ${ew / 100} * min(evidencePoints/(required*${r.evidenceFullFactor}), 1); evidence points: weak ${sp.weak}, moderate ${sp.moderate}, strong ${sp.strong}, very strong ${sp.very_strong}; evidence is "thin" below ${Math.round(r.evidenceThinBelow * 100)}% of the full amount`;
}
