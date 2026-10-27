import type { Handler } from '../http/types';
import { Validator } from '../validation';

export const draftCareer: Handler = async (req, ctx) => {
  const v = new Validator(req.body);
  const name = v.string('name', { max: 120 });
  const category = v.string('category', { optional: true, min: 0, max: 60 }) ?? '';
  const description = v.string('description', { optional: true, min: 0, max: 1000 }) ?? '';
  v.done();
  return { status: 200, body: await ctx.services.careerDraft.draft(req.userId as string, { name: name as string, category, description }) };
};
