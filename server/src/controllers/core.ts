import type { Handler } from '../http/types';
import type { CustomCareerInput, EvidenceInput, EvidencePatch } from '../repositories/core-types';
import { EVIDENCE_STRENGTHS, EVIDENCE_TYPES, SKILL_LEVEL_MAX, SKILL_LEVEL_MIN } from '../services/core';
import { parseRules } from '../domain/evaluation';
import { ValidationError, Validator, parseUuid } from '../validation';

// userId ALWAYS comes from req.userId (verified token). Nothing in a body/query/path is ever used as a user id.
const uid = (req: { userId?: string }) => req.userId as string;
const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/;
const textId = (v: string | undefined, what: string): string => { if (!v || !ID.test(v)) throw new ValidationError({ [what]: 'Invalid id.' }); return v; };
const uuidId = (v: string | undefined, what: string): string => { const u = parseUuid(v); if (!u) throw new ValidationError({ [what]: 'Must be a valid id.' }); return u; };
const URL_RE = /^https?:\/\/[^\s]+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

export const listCareers: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.core.listCareers(uid(req)) });
export const getCareer: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.core.getCareer(uid(req), textId(req.params.careerId, 'careerId')) });
export const getCareerSkills: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.core.getCareerSkills(uid(req), textId(req.params.careerId, 'careerId')) });

export const listMySkills: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.core.listAssessments(uid(req)) });
export const getMySkill: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.core.getAssessment(uid(req), textId(req.params.skillId, 'skillId')) });
export const putMySkill: Handler = async (req, ctx) => {
  const skillId = textId(req.params.skillId, 'skillId');
  const v = new Validator(req.body);
  const level = v.int('level', { min: SKILL_LEVEL_MIN, max: SKILL_LEVEL_MAX });
  const source = v.string('source', { optional: true, max: 30 }) ?? 'self';
  v.done();
  return { status: 200, body: await ctx.services.core.setAssessment(uid(req), skillId, level as number, source) };
};
export const deleteMySkill: Handler = async (req, ctx) => { await ctx.services.core.clearAssessment(uid(req), textId(req.params.skillId, 'skillId')); return { status: 204 }; };

// Full body for create; any subset (at least one field) for update. Only these fields are read.
function readEvidence(body: unknown, partial: boolean): EvidenceInput | EvidencePatch {
  const v = new Validator(body);
  const src = body as Record<string, unknown>;
  const has = (k: string) => !partial || src[k] !== undefined;
  const out: EvidencePatch = {};
  if (has('title')) out.title = v.string('title', { max: 200 });
  if (has('description')) out.description = v.string('description', { max: 2000 });
  if (has('type')) out.type = v.enum('type', EVIDENCE_TYPES);
  if (has('strength')) out.strength = v.enum('strength', EVIDENCE_STRENGTHS);
  const url = v.nullableText('url', 2048); if (url !== undefined) { if (url !== null && !URL_RE.test(url)) v.string('url', { pattern: /^$/, patternMessage: 'Must be an http(s) URL.' }); else out.url = url; }
  const date = v.nullableText('date', 10); if (date !== undefined) { if (date !== null && !validDate(date)) v.string('date', { pattern: /^$/, patternMessage: 'Must be a date like 2026-01-31.' }); else out.date = date; }
  const org = v.nullableText('organization', 200); if (org !== undefined) out.organization = org;
  if (src.skillIds !== undefined) out.skillIds = v.stringArray('skillIds', { maxItems: 50, maxLength: 120 }); else if (!partial) out.skillIds = [];
  v.done();
  if (out.skillIds?.some((s) => !ID.test(s))) throw new ValidationError({ skillIds: 'Contains an invalid skill id.' });
  if (!partial) { out.url ??= null; out.date ??= null; out.organization ??= null; }
  else if (!Object.values(out).some((x) => x !== undefined)) throw new ValidationError({ _: 'Provide at least one field to update.' });
  return out;
}

const whole = (v: string | undefined, field: string, min: number, max: number): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!/^\d+$/.test(v) || n < min || n > max) throw new ValidationError({ [field]: `Must be a whole number from ${min} to ${max}.` });
  return n;
};
export const listEvidence: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.core.listEvidence(uid(req), { limit: whole(req.query.limit, 'limit', 1, 200), offset: whole(req.query.offset, 'offset', 0, 100000) }) });
export const createEvidence: Handler = async (req, ctx) => ({ status: 201, body: await ctx.services.core.createEvidence(uid(req), readEvidence(req.body, false) as EvidenceInput) });
export const getEvidence: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.core.getEvidence(uid(req), uuidId(req.params.evidenceId, 'evidenceId')) });
export const putEvidence: Handler = async (req, ctx) => {
  const id = uuidId(req.params.evidenceId, 'evidenceId');
  return { status: 200, body: await ctx.services.core.updateEvidence(uid(req), id, readEvidence(req.body, true)) };
};
export const deleteEvidence: Handler = async (req, ctx) => { await ctx.services.core.deleteEvidence(uid(req), uuidId(req.params.evidenceId, 'evidenceId')); return { status: 204 }; };
export const linkEvidenceSkill: Handler = async (req, ctx) => ({ status: 201, body: await ctx.services.core.linkSkill(uid(req), uuidId(req.params.evidenceId, 'evidenceId'), textId(req.params.skillId, 'skillId')) });
export const unlinkEvidenceSkill: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.core.unlinkSkill(uid(req), uuidId(req.params.evidenceId, 'evidenceId'), textId(req.params.skillId, 'skillId')) });

// ---- Custom careers (owner-only). Limits keep a career small enough to reason about and to render.
const LIMITS = { capabilities: 12, skillsPerCapability: 12, totalSkills: 60, expectations: 10 };
function readCareer(body: unknown): CustomCareerInput {
  const v = new Validator(body);
  const src = body as Record<string, unknown>;
  const name = v.string('name', { max: 120 }), category = v.string('category', { max: 60 });
  const description = v.string('description', { optional: true, min: 0, max: 1000 }) ?? ''; // optional: an empty description is valid (the editor sends "")
  v.done();
  const errors: Record<string, string> = {};
  const arr = (x: unknown) => (Array.isArray(x) ? x : null);
  const expectationsRaw = src.evidenceExpectations === undefined ? [] : arr(src.evidenceExpectations);
  if (!expectationsRaw || expectationsRaw.length > LIMITS.expectations || expectationsRaw.some((e) => typeof e !== 'string' || !e.trim() || e.length > 200)) errors.evidenceExpectations = `Must be a list of up to ${LIMITS.expectations} short texts.`;
  const capsRaw = arr(src.capabilities);
  if (!capsRaw || capsRaw.length < 1 || capsRaw.length > LIMITS.capabilities) errors.capabilities = `Provide 1 to ${LIMITS.capabilities} capabilities.`;
  const capabilities: CustomCareerInput['capabilities'] = [];
  let total = 0;
  (capsRaw ?? []).forEach((c, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const idOk = (x: unknown) => x === undefined || (typeof x === 'string' && ID.test(x));
    const skillsRaw = arr(o.skills);
    if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 100) errors[`capabilities.${i}.name`] = 'Required, up to 100 characters.';
    if (o.description !== undefined && (typeof o.description !== 'string' || o.description.length > 500)) errors[`capabilities.${i}.description`] = 'Up to 500 characters.';
    if (!idOk(o.id)) errors[`capabilities.${i}.id`] = 'Invalid id.';
    if (!skillsRaw || skillsRaw.length < 1 || skillsRaw.length > LIMITS.skillsPerCapability) { errors[`capabilities.${i}.skills`] = `Provide 1 to ${LIMITS.skillsPerCapability} skills.`; return; }
    total += skillsRaw.length;
    const skills = skillsRaw.map((x, j) => {
      const sk = (x ?? {}) as Record<string, unknown>;
      if (typeof sk.name !== 'string' || !sk.name.trim() || sk.name.length > 100) errors[`capabilities.${i}.skills.${j}.name`] = 'Required, up to 100 characters.';
      const rl = sk.requiredLevel, imp = sk.importance ?? 3;
      if (typeof rl !== 'number' || !Number.isInteger(rl) || rl < 1 || rl > 5) errors[`capabilities.${i}.skills.${j}.requiredLevel`] = 'Whole number from 1 to 5.';
      if (typeof imp !== 'number' || !Number.isInteger(imp) || imp < 1 || imp > 5) errors[`capabilities.${i}.skills.${j}.importance`] = 'Whole number from 1 to 5.';
      if (!idOk(sk.id)) errors[`capabilities.${i}.skills.${j}.id`] = 'Invalid id.';
      if (sk.description !== undefined && (typeof sk.description !== 'string' || sk.description.length > 600)) errors[`capabilities.${i}.skills.${j}.description`] = 'Up to 600 characters.';
      const me = sk.minEvidence ?? null;
      if (me !== null && (typeof me !== 'number' || !Number.isInteger(me) || me < 1 || me > 10)) errors[`capabilities.${i}.skills.${j}.minEvidence`] = 'Whole number from 1 to 10, or empty.';
      return { id: sk.id as string | undefined, name: String(sk.name ?? '').trim(), requiredLevel: rl as number, importance: imp as number, minEvidence: me as number | null, description: typeof sk.description === 'string' ? sk.description.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim() : '' };
    });
    capabilities.push({ id: o.id as string | undefined, name: String(o.name ?? '').trim(), description: typeof o.description === 'string' ? o.description.trim() : '', skills });
  });
  if (total > LIMITS.totalSkills) errors.capabilities = `A career can have at most ${LIMITS.totalSkills} skills in total.`;
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const parsed = parseRules(src.evaluationRules); Object.assign(errors, parsed.errors);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { name: name as string, category: category as string, description, evidenceExpectations: (expectationsRaw as string[]).map((e) => e.trim()), capabilities, evaluationRules: parsed.rules && Object.keys(parsed.rules).length ? (parsed.rules as Record<string, unknown>) : null };
}
export const createCareer: Handler = async (req, ctx) => ({ status: 201, body: await ctx.services.core.createCareer(uid(req), readCareer(req.body)) });
export const putCareer: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.core.updateCareer(uid(req), textId(req.params.careerId, 'careerId'), readCareer(req.body)) });
export const deleteCareer: Handler = async (req, ctx) => { await ctx.services.core.deleteCareer(uid(req), textId(req.params.careerId, 'careerId')); return { status: 204 }; };
