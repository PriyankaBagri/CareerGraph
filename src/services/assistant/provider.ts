import type { AssistantAnswer, AssistantContext } from '../../types';

// Contract for anything that answers questions about the user's CareerGraph data.
// Today: LocalRulesAssistantProvider (rule-based, not AI). Later: a BackendAssistantProvider that calls a server holding the AI key.
// Never call an AI vendor, or ship an API key, from the browser.
export interface CareerAssistantProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: 'local-rules' | 'backend-ai';
  answer(question: string, context: AssistantContext): Promise<AssistantAnswer>;
}
