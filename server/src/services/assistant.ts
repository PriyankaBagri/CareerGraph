import { AiProviderError, type AiProvider, type ChatTurn } from '../ai/provider';
import { buildContext, SYSTEM_PROMPT, type ContextExtras, type Grounding } from '../ai/prompt';
import type { AiConfig } from '../config';
import { AppError, aiNotConfigured, aiUnavailable, tooManyRequests } from '../errors';
import type { Logger } from '../logger';
import type { AllRepos } from '../repositories/types';
import { RateLimiter } from '../utils/rateLimit';
import type { ReadinessService } from './readiness';

export const MAX_TURNS = 20, MAX_TURN_CHARS = 2000, MAX_TOTAL_CHARS = 12000, KEPT_TURNS = 12;
export interface AssistantStatus { available: boolean; provider: string | null; model: string | null; reason: 'not_configured' | 'misconfigured' | null }
export interface ChatResult { message: { role: 'assistant'; content: string }; provider: { id: string; label: string; model: string }; grounding: Grounding | null; generated: true; notice: string }
export const AI_NOTICE = 'AI-generated. It can be wrong and is not verified career advice. General answers come from the model\'s general knowledge, not from CareerGraph data.';

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
}
