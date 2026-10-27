import type { Handler } from '../http/types';
import type { ActionSnapshot, SettingsPatch } from '../repositories/progress-types';
import { ACTION_PHASES, ACTION_STATUSES, LEVEL3 } from '../repositories/progress-types';
import { ValidationError, Validator } from '../validation';

const uid = (req: { userId?: string }) => req.userId as string;
const CAREER_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/;
const ACTION_KEY = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/;
const careerId = (v: string | undefined): string => { if (!v || !CAREER_ID.test(v)) throw new ValidationError({ careerId: 'Invalid id.' }); return v; };
const actionKey = (v: string | undefined): string => { if (!v || !ACTION_KEY.test(v)) throw new ValidationError({ actionKey: 'Invalid id.' }); return v; };

export const listProgress: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.progress.list(uid(req), careerId(req.params.careerId)) });

// Body: { status: 'in_progress' | 'completed', action: { ...snapshot of the generated action } }. A user id in the body is never read.
export const putProgress: Handler = async (req, ctx) => {
  const cid = careerId(req.params.careerId), key = actionKey(req.params.actionKey);
  const v = new Validator(req.body);
  const status = v.enum('status', ACTION_STATUSES);
  const raw = (req.body as Record<string, unknown>).action;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ValidationError({ action: 'A JSON object is required.' });
  const a = new Validator(raw);
  const snapshot: ActionSnapshot = {
    title: a.string('title', { max: 200 }) as string, description: a.string('description', { min: 0, max: 1000, optional: true }) ?? '',
    type: a.string('type', { max: 40 }) as string, phase: a.enum('phase', ACTION_PHASES) as string, priority: a.enum('priority', LEVEL3) as string,
    priorityScore: a.int('priorityScore', { min: 0, max: 1000, optional: true }) ?? 0, impact: a.enum('impact', LEVEL3) as string, effort: a.enum('effort', LEVEL3, { optional: true }) ?? 'medium',
    estimatedTime: a.string('estimatedTime', { min: 0, max: 60, optional: true }) ?? '', reason: a.string('reason', { min: 0, max: 1000, optional: true }) ?? '',
    prerequisites: a.stringArray('prerequisites', { optional: true, maxItems: 30, maxLength: 200 }) ?? [],
    relatedSkillIds: a.stringArray('relatedSkillIds', { optional: true, maxItems: 50, maxLength: 120 }) ?? [],
    relatedCapabilityIds: a.stringArray('relatedCapabilityIds', { optional: true, maxItems: 50, maxLength: 120 }) ?? [],
    createdAt: '',
  };
  v.done(); a.done();
  return { status: 200, body: await ctx.services.progress.set(uid(req), cid, key, status as 'in_progress' | 'completed', snapshot) };
};
export const deleteProgress: Handler = async (req, ctx) => { await ctx.services.progress.clear(uid(req), careerId(req.params.careerId), actionKey(req.params.actionKey)); return { status: 204 }; };

export const getSettings: Handler = async (req, ctx) => ({ status: 200, body: await ctx.services.progress.getSettings(uid(req)) });
export const putSettings: Handler = async (req, ctx) => {
  const v = new Validator(req.body);
  const patch: SettingsPatch = {};
  const body = req.body as Record<string, unknown>;
  if (body.reduceMotion !== undefined) patch.reduceMotion = v.bool('reduceMotion');
  if (body.assistantSuggestions !== undefined) patch.assistantSuggestions = v.bool('assistantSuggestions');
  v.done();
  if (patch.reduceMotion === undefined && patch.assistantSuggestions === undefined) throw new ValidationError({ _: 'Provide at least one setting to update.' });
  return { status: 200, body: await ctx.services.progress.updateSettings(uid(req), patch) };
};
