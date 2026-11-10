import type { AssistantAnswer, AssistantContext } from '../types';
import { suggestedPrompts } from '../utils/assistant';
import { LocalRulesAssistantProvider } from './assistant/localProvider';
import type { CareerAssistantProvider } from './assistant/provider';
export { aiClient, friendlyAiError } from './assistant/aiClient';
export type { PlanActionDetail, PlanReply, PlanWeek } from './assistant/aiClient';

// The single place that picks a provider. To go real, return a BackendAssistantProvider here.
const provider: CareerAssistantProvider = new LocalRulesAssistantProvider();

export const assistantService = {
  provider: { id: provider.id, label: provider.label, kind: provider.kind },
  ask: (question: string, context: AssistantContext): Promise<AssistantAnswer> => provider.answer(question, context),
  suggestedPrompts,
};
