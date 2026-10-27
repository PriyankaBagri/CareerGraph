import type { ProfilePatch } from '../repositories/types';
import type { Handler } from '../http/types';
import { ValidationError, Validator } from '../validation';

const EXPERIENCE_LEVEL_VALUES = ['beginner', 'early', 'intermediate', 'experienced'] as const;

export const getProfile: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.profile.get(req.userId as string) });

// Partial update: absent field = unchanged, null/"" = clear (nullable fields). Only these fields are read from the body,
// so a client cannot supply a user id (or any other column) to touch someone else's data.
export const putProfile: Handler = async (req, ctx) => {
  const v = new Validator(req.body);
  const patch: ProfilePatch = {};
  if ((req.body as Record<string, unknown>).name !== undefined) patch.name = v.string('name', { min: 1, max: 80 });
  const target = v.nullableText('targetCareerId', 100); if (target !== undefined) patch.targetCareerId = target;
  const exp = v.nullableText('experienceSummary', 1000); if (exp !== undefined) patch.experienceSummary = exp;
  const edu = v.nullableText('educationSummary', 500); if (edu !== undefined) patch.educationSummary = edu;
  const about = v.nullableText('aboutNote', 500); if (about !== undefined) patch.aboutNote = about;
  const body = req.body as Record<string, unknown>;
  if (body.stage !== undefined) patch.stage = v.string('stage', { min: 0, max: 60 });
  if (body.experienceLevel !== undefined) patch.experienceLevel = v.enum('experienceLevel', EXPERIENCE_LEVEL_VALUES);
  if (body.onboardingComplete !== undefined) patch.onboardingComplete = v.bool('onboardingComplete');
  if (body.completeness !== undefined) patch.completeness = v.int('completeness', { min: 0, max: 100 });
  v.done();
  if (!Object.values(patch).some((x) => x !== undefined)) throw new ValidationError({ _: 'Provide at least one field to update.' });
  return { status: 200, body: await ctx.services.profile.update(req.userId as string, patch) };
};
