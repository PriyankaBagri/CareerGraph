import type { Career } from '../types';

// Pure model behind the custom-career editor. The limits mirror the server (server/src/controllers/core.ts) so most problems are caught before saving;
// the server still validates everything. Nothing here knows about any particular profession.
export const LIMITS = { name: 120, category: 60, description: 1000, capabilities: 12, skillsPerCapability: 12, totalSkills: 60, expectations: 10, expectationLength: 200, itemName: 100, capDescription: 500 } as const;
export const DEFAULT_RULES = { levelWeight: 0.75, evidenceFullFactor: 1.2, evidenceThinBelow: 0.5 } as const;
export const IMPORTANCE_LABELS = ['', 'Minor', 'Useful', 'Important', 'Very important', 'Critical'] as const;
export const TARGET_LEVEL_LABELS = ['', 'Beginner', 'Basic', 'Intermediate', 'Advanced', 'Expert'] as const;

export interface DraftSkill { key: string; id?: string; name: string; requiredLevel: number; importance: number; /** fewest evidence items this career asks for on the skill (null = no minimum) */ minEvidence: number | null }
export interface DraftCapability { key: string; id?: string; name: string; description: string; skills: DraftSkill[] }
export interface CareerDraft { name: string; category: string; description: string; evidenceExpectations: string[]; capabilities: DraftCapability[]; /** stored per-career evaluation overrides; the editor changes levelWeight and keeps any other setting untouched */ evaluationRules: Record<string, unknown> | null }
export interface DraftModelInput { name: string; category: string; description: string; evidenceExpectations: string[]; capabilities: { id?: string; name: string; description: string; skills: { id?: string; name: string; requiredLevel: number; importance: number; minEvidence: number | null }[] }[]; evaluationRules: Record<string, unknown> | null }
// Shape of an existing server model, reduced to what the editor needs (ApiCareerModel is assignable to it).
export interface ExistingModel {
  career: { name: string; category: string; description: string; evidenceExpectations: string[]; evaluationRules?: unknown };
  capabilities: { id: string; name: string; description: string; position: number }[];
  skills: { id: string; name: string }[];
  requirements: { skillId: string; capabilityId: string; requiredLevel: number; importance: number; position: number; minEvidence?: number | null }[];
}

let counter = 0;
export const newKey = (): string => `k${++counter}`;
export const blankSkill = (): DraftSkill => ({ key: newKey(), name: '', requiredLevel: 3, importance: 3, minEvidence: null });
export const blankCapability = (): DraftCapability => ({ key: newKey(), name: '', description: '', skills: [blankSkill()] });
export const blankDraft = (): CareerDraft => ({ name: '', category: '', description: '', evidenceExpectations: [], capabilities: [blankCapability()], evaluationRules: null });

export function draftFromModel(m: ExistingModel): CareerDraft {
  const names = new Map(m.skills.map((s) => [s.id, s.name]));
  return {
    name: m.career.name, category: m.career.category, description: m.career.description, evidenceExpectations: [...m.career.evidenceExpectations],
    capabilities: [...m.capabilities].sort((a, b) => a.position - b.position).map((c) => ({
      key: newKey(), id: c.id, name: c.name, description: c.description,
      skills: m.requirements.filter((r) => r.capabilityId === c.id).sort((a, b) => a.position - b.position).map((r) => ({ key: newKey(), id: r.skillId, name: names.get(r.skillId) ?? r.skillId, requiredLevel: r.requiredLevel, importance: r.importance, minEvidence: r.minEvidence ?? null })),
    })),
    evaluationRules: m.career.evaluationRules && typeof m.career.evaluationRules === 'object' ? { ...(m.career.evaluationRules as Record<string, unknown>) } : null,
  };
}
// A copy of any career (a catalog entry, a generated model) as a starting point: NO ids are kept, so saving always creates a new, user-owned career.
export function draftFromCareer(c: Career, keepIds = false): CareerDraft {
  return {
    name: c.name, category: c.category, description: c.description, evidenceExpectations: [...(c.evidenceExpectations ?? [])],
    capabilities: c.capabilities.map((cap) => ({
      key: newKey(), id: keepIds ? cap.id : undefined, name: cap.name, description: cap.description ?? '',
      skills: cap.skills.map((s) => ({ key: newKey(), id: keepIds ? s.id : undefined, name: s.name, requiredLevel: Math.max(1, Math.min(5, s.requiredLevel || 3)), importance: 3, minEvidence: null })),
    })),
    evaluationRules: null,
  };
}

export type DraftErrors = Record<string, string>;
const lower = (s: string) => s.trim().toLowerCase();
// Error keys: name, category, description, expectations, capabilities, cap.<i>.name, cap.<i>.skills, cap.<i>.skill.<j>.name|level|importance
export function validateDraft(d: CareerDraft): DraftErrors {
  const e: DraftErrors = {};
  const name = d.name.trim();
  if (!name) e.name = 'Enter a career name.'; else if (name.length > LIMITS.name) e.name = `Keep it under ${LIMITS.name} characters.`; else if (!/\p{L}{2}/u.test(name)) e.name = 'Use at least two letters.';
  if (!d.category.trim()) e.category = 'Enter a field or category, for example “Law”.'; else if (d.category.trim().length > LIMITS.category) e.category = `Keep it under ${LIMITS.category} characters.`;
  if (d.description.length > LIMITS.description) e.description = `Keep it under ${LIMITS.description} characters.`;
  if (d.evidenceExpectations.length > LIMITS.expectations) e.expectations = `At most ${LIMITS.expectations} expectations.`;
  else if (d.evidenceExpectations.some((x) => !x.trim() || x.length > LIMITS.expectationLength)) e.expectations = `Each expectation needs text of up to ${LIMITS.expectationLength} characters.`;
  if (d.capabilities.length < 1) e.capabilities = 'Add at least one capability.'; else if (d.capabilities.length > LIMITS.capabilities) e.capabilities = `At most ${LIMITS.capabilities} capabilities.`;
  const seenCap = new Set<string>(), seenSkill = new Set<string>(); let total = 0;
  d.capabilities.forEach((c, i) => {
    if (!c.name.trim()) e[`cap.${i}.name`] = 'Name this capability.'; else if (c.name.length > LIMITS.itemName) e[`cap.${i}.name`] = `Keep it under ${LIMITS.itemName} characters.`;
    else if (seenCap.has(lower(c.name))) e[`cap.${i}.name`] = 'Another capability already has this name.'; else seenCap.add(lower(c.name));
    if (c.description.length > LIMITS.capDescription) e[`cap.${i}.description`] = `Keep it under ${LIMITS.capDescription} characters.`;
    if (c.skills.length < 1) e[`cap.${i}.skills`] = 'Add at least one skill.'; else if (c.skills.length > LIMITS.skillsPerCapability) e[`cap.${i}.skills`] = `At most ${LIMITS.skillsPerCapability} skills per capability.`;
    total += c.skills.length;
    c.skills.forEach((s, j) => {
      if (!s.name.trim()) e[`cap.${i}.skill.${j}.name`] = 'Name this skill.'; else if (s.name.length > LIMITS.itemName) e[`cap.${i}.skill.${j}.name`] = `Keep it under ${LIMITS.itemName} characters.`;
      else if (seenSkill.has(lower(s.name))) e[`cap.${i}.skill.${j}.name`] = 'Another skill already has this name.'; else seenSkill.add(lower(s.name));
      if (!Number.isInteger(s.requiredLevel) || s.requiredLevel < 1 || s.requiredLevel > 5) e[`cap.${i}.skill.${j}.level`] = 'Choose a target level from 1 to 5.';
      if (!Number.isInteger(s.importance) || s.importance < 1 || s.importance > 5) e[`cap.${i}.skill.${j}.importance`] = 'Choose an importance from 1 to 5.';
      if (s.minEvidence != null && (!Number.isInteger(s.minEvidence) || s.minEvidence < 1 || s.minEvidence > 10)) e[`cap.${i}.skill.${j}.minEvidence`] = 'Use a whole number from 1 to 10, or leave empty.';
    });
  });
  const r = d.evaluationRules, n = (k: string) => (r && k in r ? r[k] : undefined);
  const bad = (v: unknown, lo: number, hi: number) => v !== undefined && !(typeof v === 'number' && v >= lo && v <= hi);
  if (bad(n('levelWeight'), 0.5, 0.95)) e.levelWeight = 'Choose a share from 50% to 95%.';
  if (bad(n('evidenceFullFactor'), 0.5, 3)) e['rules.evidenceFullFactor'] = 'Choose a number from 0.5 to 3.';
  if (bad(n('evidenceThinBelow'), 0.1, 0.9)) e['rules.evidenceThinBelow'] = 'Choose a share from 10% to 90%.';
  if (total > LIMITS.totalSkills) e.capabilities = `At most ${LIMITS.totalSkills} skills in total (now ${total}).`;
  return e;
}

// Request body. Items that carry an id keep it (so ratings and evidence links survive). Items WITHOUT an id (new, or a regenerated structure) are matched
// by name to an existing capability/skill that is not already claimed, so an unchanged name keeps its history; anything else is created new.
export function toModelInput(d: CareerDraft, existing?: ExistingModel): DraftModelInput {
  const capByName = new Map((existing?.capabilities ?? []).map((c) => [lower(c.name), c.id]));
  const skillByName = new Map((existing?.skills ?? []).map((s) => [lower(s.name), s.id]));
  const claimedCaps = new Set(d.capabilities.map((c) => c.id).filter((x): x is string => !!x)), claimedSkills = new Set(d.capabilities.flatMap((c) => c.skills.map((s) => s.id)).filter((x): x is string => !!x));
  const claim = (m: Map<string, string>, used: Set<string>, name: string): string | undefined => { const id = m.get(lower(name)); if (!id || used.has(id)) return undefined; used.add(id); return id; };
  return {
    name: d.name.trim(), category: d.category.trim(), description: d.description.trim(), evidenceExpectations: d.evidenceExpectations.map((x) => x.trim()).filter(Boolean),
    evaluationRules: d.evaluationRules && Object.keys(d.evaluationRules).length ? d.evaluationRules : null,
    capabilities: d.capabilities.map((c) => {
      const cid = c.id ?? claim(capByName, claimedCaps, c.name); // evaluated once: a second call would find the id already claimed
      return {
      ...(cid ? { id: cid } : {}),
      name: c.name.trim(), description: c.description.trim(),
      skills: c.skills.map((s) => { const id = s.id ?? claim(skillByName, claimedSkills, s.name); return { ...(id ? { id } : {}), name: s.name.trim(), requiredLevel: s.requiredLevel, importance: s.importance, minEvidence: s.minEvidence }; }),
      };
    }),
  };
}

// What saving would drop: existing skills that are not in the new input (their ratings and evidence links go with them; the evidence itself is kept).
export function removedSkills(existing: ExistingModel | undefined, input: DraftModelInput): string[] {
  if (!existing) return [];
  const keep = new Set(input.capabilities.flatMap((c) => c.skills.map((s) => s.id)).filter((x): x is string => !!x));
  return existing.skills.filter((s) => !keep.has(s.id)).map((s) => s.name);
}

// Immutable list helpers used by the editor (and tested directly).
export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
export const removeAt = <T,>(list: T[], i: number): T[] => list.filter((_, k) => k !== i);
export const replaceAt = <T,>(list: T[], i: number, v: T): T[] => list.map((x, k) => (k === i ? v : x));
// Small structured summary that the editor shows next to the form so users can see what they are building.
export const summarize = (d: CareerDraft) => ({ capabilities: d.capabilities.length, skills: d.capabilities.reduce((n, c) => n + c.skills.length, 0) });
