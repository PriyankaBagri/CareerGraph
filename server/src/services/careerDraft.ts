import { AiProviderError, type AiProvider } from '../ai/provider';
import { buildDraftRequestBlock, DRAFT_SYSTEM_PROMPT, parseCareerDraft, type CareerDraft, type DraftRequest } from '../ai/careerDraft';
import type { AiConfig } from '../config';
import { AppError, aiNotConfigured, aiUnavailable, tooManyRequests } from '../errors';
import type { Logger } from '../logger';
import { RateLimiter } from '../utils/rateLimit';

export const DRAFT_MAX_TOKENS = 3500; // a full model needs far more room than a chat reply; AI_MAX_OUTPUT_TOKENS (chat) is not used here
export const DRAFT_NOTICE = 'AI-generated draft. It is unverified and may be wrong or incomplete: review and edit it before saving.';
export interface DraftResult { source: 'ai'; unverified: true; notice: string; provider: { id: string; label: string; model: string }; draft: CareerDraft }

// Drafting NEVER saves anything. The only way a draft becomes a career is the existing authenticated POST /api/careers, called by the
// user after reviewing it. userId comes from the verified token; it is used only for rate limiting (the draft itself reads no user data).
export class CareerDraftService {
  private readonly limiter: RateLimiter;
  constructor(private readonly deps: { provider: AiProvider | null; ai: AiConfig; logger: Logger; now: () => Date }) {
    this.limiter = new RateLimiter(deps.ai.ratePerMinute, 60_000, () => deps.now().getTime());
  }
  async draft(userId: string, input: DraftRequest): Promise<DraftResult> {
    const { provider, logger } = this.deps;
    if (!provider) throw aiNotConfigured();
    const wait = this.limiter.take(userId);
    if (wait > 0) throw tooManyRequests(wait);
    const system = `${DRAFT_SYSTEM_PROMPT}\n\n<career_request>\n${buildDraftRequestBlock(input)}\n</career_request>`;
    const started = Date.now();
    let text: string;
    try {
      text = (await provider.complete({ system, messages: [{ role: 'user', content: 'Draft the career model for <career_request>. Reply with the JSON object only.' }], maxTokens: DRAFT_MAX_TOKENS })).text;
    } catch (e) {
      const cat = e instanceof AiProviderError ? e.category : 'upstream_error';
      logger.warn('career_draft_failed', { provider: provider.id, category: cat, upstreamStatus: e instanceof AiProviderError ? e.upstreamStatus : undefined, ms: Date.now() - started });
      if (cat === 'timeout') throw aiUnavailable('ai_timeout', 'The AI model took too long to draft the career. Please try again.');
      throw aiUnavailable('ai_unavailable', 'The AI model could not draft the career right now. Please try again later.');
    }
    const parsed = parseCareerDraft(text);
    if (!parsed.ok) {
      logger.warn('career_draft_invalid', { provider: provider.id, issues: parsed.issues.length, ms: Date.now() - started }); // counts only, never the model output
      throw new AppError(502, 'ai_invalid_output', 'The AI returned a career draft that did not pass validation, so nothing was produced. Please try again.', undefined, true); // schema issue paths are not returned (only their count is logged)
    }
    logger.info('career_draft', { provider: provider.id, ms: Date.now() - started, capabilities: parsed.draft.capabilities.length });
    return { source: 'ai', unverified: true, notice: DRAFT_NOTICE, provider: { id: provider.id, label: provider.label, model: provider.model }, draft: parsed.draft };
  }
}
