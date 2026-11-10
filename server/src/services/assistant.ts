import { AiProviderError, type AiProvider, type ChatTurn } from '../ai/provider';
import { buildContext, SYSTEM_PROMPT, type ContextExtras, type Grounding } from '../ai/prompt';
import { parsePlan, PLAN_SYSTEM_PROMPT, type Plan } from '../ai/plan';
import { buildFallbackPlan } from '../domain/planFallback';
import type { AiConfig } from '../config';
import { AppError, aiNotConfigured, aiUnavailable, tooManyRequests } from '../errors';
import type { Logger } from '../logger';
import { MAX_ACTION_LIMIT, type ActionType, type NextAction } from '../domain/readiness';
import type { AllRepos } from '../repositories/types';
import { RateLimiter } from '../utils/rateLimit';
import type { ReadinessService } from './readiness';

export const MAX_TURNS = 20, MAX_TURN_CHARS = 2000, MAX_TOTAL_CHARS = 12000, KEPT_TURNS = 12;
export const PLAN_MAX_TOKENS = 2500; // a multi-week plan needs more room than one chat reply, but far less than a full career draft
export interface AssistantStatus { available: boolean; provider: string | null; model: string | null; reason: 'not_configured' | 'misconfigured' | null }
export interface ChatResult { message: { role: 'assistant'; content: string }; provider: { id: string; label: string; model: string }; grounding: Grounding | null; generated: true; notice: string }
export const AI_NOTICE = 'AI-generated. It can be wrong and is not verified career advice. General answers come from the model\'s general knowledge, not from CareerGraph data.';
export const PLAN_NOTICE = 'AI-generated weekly plan. It is unverified and may be wrong: review it, and mark actions as done on the Roadmap page as you complete them.';
export const FALLBACK_PLAN_NOTICE = 'Rule-based starter plan — not AI-generated. Built from your own ranked next actions.';

// Full detail for every action id the plan is allowed to reference, so the frontend can render a week without a second lookup.
// This is a VIEW over the same ranked actions already computed by ReadinessService; nothing new is stored.
export interface PlanActionDetail { id: string; type: ActionType; skillName: string; capabilityName: string; priority: 'high' | 'medium' | 'low'; reason: string; recommendation: string; completionCriterion: string }
export interface PlanResult { source: 'ai' | 'rule_based'; unverified: boolean; notice: string; provider: { id: string; label: string; model: string } | null; grounding: Grounding | null; plan: Plan; actions: PlanActionDetail[] }

// Looks up each id used in `plan` against the real actions it was built from. Shared by the AI and rule-based paths.
const planActionDetails = (actions: NextAction[], ids: string[]): PlanActionDetail[] => {
  const byId = new Map(actions.map((a) => [a.id, a]));
  return [...new Set(ids)].map((id) => {
    const a = byId.get(id)!; // every id here was either validated against this list (AI) or taken directly from it (rule-based)
    return { id: a.id, type: a.type, skillName: a.skillName, capabilityName: a.capabilityName, priority: a.priority, reason: a.reason, recommendation: a.recommendation, completionCriterion: a.completionCriterion };
  });
};

// Keep the last turns, start on a user turn, and merge neighbours with the same role (vendors require alternating roles).
export function normalizeTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns.slice(-KEPT_TURNS)) {
    if (!out.length && t.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += `\n\n${t.content}`; else out.push({ ...t });
  }
  return out;
}

export class AssistantService {
  private readonly limiter: RateLimiter;
  constructor(private readonly deps: { provider: AiProvider | null; ai: AiConfig; readiness: ReadinessService; repos: Pick<AllRepos, 'getProfile' | 'listEvidence' | 'listProgress'>; logger: Logger; now: () => Date }) {
    this.limiter = new RateLimiter(deps.ai.ratePerMinute, 60_000, () => deps.now().getTime());
  }
  status(): AssistantStatus {
    const p = this.deps.provider;
    if (p) return { available: true, provider: p.id, model: p.model, reason: null };
    return { available: false, provider: null, model: null, reason: this.deps.ai.problem ? 'misconfigured' : 'not_configured' };
  }
  // userId comes from the verified token. Career data is read through ReadinessService, whose repositories are scoped to that user,
  // so a career id belonging to someone else is "not found" here exactly as it is on the readiness endpoints.
  async chat(userId: string, input: { careerId?: string; messages: ChatTurn[]; page?: string; skillId?: string }): Promise<ChatResult> {
    const { provider, ai, readiness, repos, logger } = this.deps;
    if (!provider) throw aiNotConfigured();
    const wait = this.limiter.take(userId);
    if (wait > 0) throw tooManyRequests(wait);
    const profile = await repos.getProfile(userId);
    const careerId = input.careerId ?? profile?.targetCareerId ?? undefined;
    let result = null, actions: Awaited<ReturnType<ReadinessService['actions']>>['actions'] = [], extras: ContextExtras = {};
    if (careerId) {
      // A failure to LOAD the user's data must never look like "the user has no data": stop here instead of asking the model to answer blind.
      // Not-found (including another user's career id) keeps its own 404; every other failure becomes a recoverable 503 with no details.
      try {
        result = await readiness.readiness(userId, careerId);
        const [acts, evidence, progress] = await Promise.all([readiness.actions(userId, careerId, 10), repos.listEvidence(userId), repos.listProgress(userId, careerId)]);
        const done = new Set(progress.filter((p) => p.status === 'completed').map((p) => p.actionKey));
        actions = acts.actions.filter((a) => !done.has(a.id)).slice(0, 5); // finished actions are reported separately, not offered again
        const viewSkill = input.skillId ? result.skills.find((k) => k.skillId === input.skillId) : undefined; // only a skill of THIS user's career can be named
        extras = {
          viewing: input.page || viewSkill ? { page: input.page, skill: viewSkill?.name } : undefined,
          priorityCriteria: acts.priorityCriteria, evidenceExpectations: acts.evidenceExpectations,
          evidence: evidence.map((e) => ({ title: e.title, type: e.type, strength: e.strength, source: e.source, skillIds: e.skillIds })),
          progress: progress.map((p) => ({ actionKey: p.actionKey, status: p.status, title: p.snapshot.title })),
        };
      } catch (e) {
        if (e instanceof AppError) throw e;
        logger.warn('assistant_context_failed', { ms: 0 });
        throw new AppError(503, 'context_unavailable', 'We could not load your CareerGraph data just now, so the assistant did not answer. Please try again.', undefined, true);
      }
    }
    const { block, grounding } = buildContext(result, actions, profile, extras);
    const system = `${SYSTEM_PROMPT}\n\n<career_data>\n${block}\n</career_data>`;
    const started = Date.now();
    try {
      const out = await provider.complete({ system, messages: normalizeTurns(input.messages), maxTokens: ai.maxOutputTokens });
      if (/<\/?career_data>/i.test(out.text)) throw new AiProviderError('bad_response'); // the model echoed our internal data block: treat as a bad answer
      logger.info('assistant_chat', { provider: provider.id, ms: Date.now() - started, turns: input.messages.length, grounded: grounding !== null }); // never the content
      return { message: { role: 'assistant', content: out.text }, provider: { id: provider.id, label: provider.label, model: provider.model }, grounding, generated: true, notice: AI_NOTICE };
    } catch (e) {
      const cat = e instanceof AiProviderError ? e.category : 'upstream_error';
      logger.warn('assistant_chat_failed', { provider: provider.id, category: cat, upstreamStatus: e instanceof AiProviderError ? e.upstreamStatus : undefined, ms: Date.now() - started });
      if (cat === 'timeout') throw aiUnavailable('ai_timeout', 'The AI model took too long to answer. Please try again.');
      if (e instanceof AiProviderError && e.upstreamStatus === 429) throw aiUnavailable('ai_busy', 'The AI assistant is busy right now. Please try again later.'); // the provider's rate or quota limit: fixed text, no provider details
      throw aiUnavailable('ai_unavailable', 'The AI model could not answer right now. Please try again later.');
    }
  }

  // Structured weekly plan for one owned career, built only from its real, open actions. Ownership (foreign/missing
  // career -> 404) is enforced before either path runs. With no AI configured, returns a deterministic rule-based
  // plan instead of erroring — the AI rate limiter and PLAN_SYSTEM_PROMPT/parsePlan path are untouched and only run
  // when a provider IS configured, so a real AI failure (timeout, bad output, etc.) still fails loudly, never silently
  // falls back.
  async generatePlan(userId: string, careerId: string): Promise<PlanResult> {
    const { provider, readiness, repos, logger } = this.deps;
    const profile = await repos.getProfile(userId);
    let result: Awaited<ReturnType<ReadinessService['readiness']>>, actsFull: Awaited<ReturnType<ReadinessService['actions']>>,
      evidence: Awaited<ReturnType<AllRepos['listEvidence']>>, progress: Awaited<ReturnType<AllRepos['listProgress']>>;
    try {
      [result, actsFull, evidence, progress] = await Promise.all([
        readiness.readiness(userId, careerId),
        readiness.actions(userId, careerId, MAX_ACTION_LIMIT),
        repos.listEvidence(userId),
        repos.listProgress(userId, careerId),
      ]);
    } catch (e) {
      if (e instanceof AppError) throw e; // includes career_not_found (404) for a missing or foreign career: ownership is enforced here, before any AI call
      logger.warn('assistant_plan_context_failed', {});
      throw new AppError(503, 'context_unavailable', 'We could not load your CareerGraph data just now, so the plan was not generated. Please try again.', undefined, true);
    }
    const done = new Set(progress.filter((p) => p.status === 'completed').map((p) => p.actionKey));
    const actions = actsFull.actions.filter((a) => !done.has(a.id)); // completed actions aren't offered again, same as chat
    if (actions.length === 0) throw new AppError(409, 'no_actions_available', 'There are no open actions for this career yet, so a weekly plan cannot be generated. Rate a few skills or add evidence first, then try again.', undefined, true);

    if (!provider) {
      const plan = buildFallbackPlan(actions);
      logger.info('assistant_plan', { provider: 'rule_based', weeks: plan.weeks.length });
      return { source: 'rule_based', unverified: false, notice: FALLBACK_PLAN_NOTICE, provider: null, grounding: null, plan, actions: planActionDetails(actions, plan.weeks.flatMap((w) => w.actionIds)) };
    }

    const wait = this.limiter.take(userId);
    if (wait > 0) throw tooManyRequests(wait);
    const extras: ContextExtras = {
      priorityCriteria: actsFull.priorityCriteria, evidenceExpectations: actsFull.evidenceExpectations,
      evidence: evidence.map((e) => ({ title: e.title, type: e.type, strength: e.strength, source: e.source, skillIds: e.skillIds })),
      progress: progress.map((p) => ({ actionKey: p.actionKey, status: p.status, title: p.snapshot.title })),
    };
    const { block, grounding } = buildContext(result, actions, profile, extras);
    const system = `${PLAN_SYSTEM_PROMPT}\n\n<career_data>\n${block}\n</career_data>`;
    const allowedIds = actions.map((a) => a.id);
    const started = Date.now();
    let text: string;
    try {
      text = (await provider.complete({ system, messages: [{ role: 'user', content: 'Generate the weekly plan for <career_data>. Reply with the JSON object only.' }], maxTokens: PLAN_MAX_TOKENS })).text;
    } catch (e) {
      const cat = e instanceof AiProviderError ? e.category : 'upstream_error';
      logger.warn('assistant_plan_failed', { provider: provider.id, category: cat, upstreamStatus: e instanceof AiProviderError ? e.upstreamStatus : undefined, ms: Date.now() - started });
      if (cat === 'timeout') throw aiUnavailable('ai_timeout', 'The AI model took too long to build the plan. Please try again.');
      if (e instanceof AiProviderError && e.upstreamStatus === 429) throw aiUnavailable('ai_busy', 'The AI assistant is busy right now. Please try again later.');
      throw aiUnavailable('ai_unavailable', 'The AI model could not build the plan right now. Please try again later.');
    }
    const parsed = parsePlan(text, allowedIds);
    if (!parsed.ok) {
      logger.warn('assistant_plan_invalid', { provider: provider.id, issues: parsed.issues.length, ms: Date.now() - started }); // counts only, never the model output or the issue paths
      throw new AppError(502, 'ai_invalid_output', 'The AI returned a plan that did not pass validation, so nothing was produced. Please try again.', undefined, true);
    }
    logger.info('assistant_plan', { provider: provider.id, ms: Date.now() - started, weeks: parsed.plan.weeks.length, grounded: grounding !== null });
    const actionDetails = planActionDetails(actions, parsed.plan.weeks.flatMap((w) => w.actionIds));
    return { source: 'ai', unverified: true, notice: PLAN_NOTICE, provider: { id: provider.id, label: provider.label, model: provider.model }, grounding, plan: parsed.plan, actions: actionDetails };
  }
}
