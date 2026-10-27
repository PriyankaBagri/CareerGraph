import { DEFAULT_ACTION_LIMIT, MAX_ACTION_LIMIT } from '../domain/readiness';
import type { Handler } from '../http/types';
import { ValidationError } from '../validation';

const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/;
const careerId = (v: string | undefined): string => { if (!v || !ID.test(v)) throw new ValidationError({ careerId: 'Invalid id.' }); return v; };
const uid = (req: { userId?: string }) => req.userId as string; // from the verified token only

export const getReadiness: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.readiness.readiness(uid(req), careerId(req.params.careerId)) });
export const getGaps: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.readiness.gaps(uid(req), careerId(req.params.careerId)) });
export const getActions: Handler = async (req, ctx) => {
  const id = careerId(req.params.careerId);
  let limit = DEFAULT_ACTION_LIMIT;
  if (req.query.limit !== undefined) {
    const n = Number(req.query.limit);
    if (!/^\d+$/.test(req.query.limit) || n < 1 || n > MAX_ACTION_LIMIT) throw new ValidationError({ limit: `Must be a whole number from 1 to ${MAX_ACTION_LIMIT}.` });
    limit = n;
  }
  return { status: 200, body: await ctx.services.readiness.roadmap(uid(req), id, limit) };
};
export const getGraph: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.readiness.graph(uid(req), careerId(req.params.careerId)) });
