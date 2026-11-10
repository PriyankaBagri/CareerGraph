import { ApiError, api } from '../api';
import type { AiTurn } from '../../utils/aiHistory';

// Talks to the CareerGraph server, which holds the model credentials. The browser never sees a provider key and never calls a model vendor.
export interface AiStatus { available: boolean; provider: string | null; model: string | null; reason: 'not_configured' | 'misconfigured' | null }
export interface AiGrounding { careerId: string; careerName: string; skillsIncluded: number; skillsOmitted: number; actionsIncluded: number }
export interface AiReply { message: { role: 'assistant'; content: string }; provider: { id: string; label: string; model: string }; grounding: AiGrounding | null; generated: true; notice: string }

// A weekly plan's action, exactly as the server returns it — never invented client-side.
export interface PlanActionDetail { id: string; type: string; skillName: string; capabilityName: string; priority: 'high' | 'medium' | 'low'; reason: string; recommendation: string; completionCriterion: string }
interface PlanWeekRaw { week: number; focus: string; rationale: string; actionIds: string[] }
interface PlanReplyRaw { source: 'ai' | 'rule_based'; unverified: boolean; notice: string; provider: { id: string; label: string; model: string } | null; grounding: AiGrounding | null; plan: { weeks: PlanWeekRaw[] }; actions: PlanActionDetail[] }
export interface PlanWeek { week: number; focus: string; rationale: string; actions: PlanActionDetail[] }
export interface PlanReply { source: 'ai' | 'rule_based'; unverified: boolean; notice: string; provider: { id: string; label: string; model: string } | null; grounding: AiGrounding | null; weeks: PlanWeek[] }

export const aiClient = {
  enabled: (): boolean => api.useBackend('assistant'),
  status: () => api.get<AiStatus>('/assistant/status'),
  chat: (messages: AiTurn[], careerId?: string, view?: { page?: string; skillId?: string }) => api.post<AiReply>('/assistant/chat', { messages, ...(careerId ? { careerId } : {}), ...(view?.page ? { page: view.page } : {}), ...(view?.skillId ? { skillId: view.skillId } : {}) }),
  // Resolves each week's actionIds against the server's own `actions` list — a client-side join of real data, nothing invented.
  async plan(careerId: string): Promise<PlanReply> {
    const r = await api.post<PlanReplyRaw>('/assistant/plan', { careerId });
    const byId = new Map(r.actions.map((a) => [a.id, a]));
    const weeks = r.plan.weeks.map((w) => ({ week: w.week, focus: w.focus, rationale: w.rationale, actions: w.actionIds.map((id) => byId.get(id)).filter((a): a is PlanActionDetail => !!a) }));
    return { source: r.source, unverified: r.unverified, notice: r.notice, provider: r.provider, grounding: r.grounding, weeks };
  },
};

// Plain-language messages. Nothing here silently substitutes another answer: the user is told what happened and can retry.
export function friendlyAiError(e: unknown): string {
  if (!(e instanceof ApiError)) return "The AI assistant couldn't answer right now. Please try again.";
  switch (e.code) {
    case 'network_error': return "Couldn't reach the server. Check that the API is running, then try again.";
    case 'timeout': return 'The server took too long to answer. Please try again.';
    case 'rate_limited': return "You're sending messages quickly. Wait a few seconds and try again.";
    case 'ai_timeout': return 'The AI model took too long to answer. Please try again.';
    case 'ai_not_configured': return 'The AI assistant is not configured on this server.';
    case 'ai_busy': return 'The AI assistant is busy right now. Please try again later.';
    case 'ai_unavailable': return 'The AI model could not answer right now. Please try again later.';
    case 'context_unavailable': return "We couldn't load your CareerGraph data just now, so the assistant didn't answer. Please try again.";
    case 'career_not_found': return "That career isn't available to your account.";
    case 'ai_invalid_output': return 'The AI returned a plan that could not be used. Please try again.';
    case 'no_actions_available': return 'There are no open actions for this career yet. Rate a few skills or add evidence first, then try again.';
    case 'token_expired': case 'invalid_token': case 'token_missing': return 'Your session has ended. Please sign in again.';
    default: return e.status === 400 ? 'That message could not be sent. Try a shorter question.' : "The AI assistant couldn't answer right now. Please try again.";
  }
}
