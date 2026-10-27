import type { AssistantAnswer, AssistantContext } from '../../types';
import { answerQuestion } from '../../utils/assistant';
import type { CareerAssistantProvider } from './provider';

export class LocalRulesAssistantProvider implements CareerAssistantProvider {
  readonly id = 'local-rules-explainer';
  readonly label = 'Local explainer (rule-based, not AI)';
  readonly kind = 'local-rules' as const;
  async answer(question: string, context: AssistantContext): Promise<AssistantAnswer> {
    await new Promise<void>((r) => setTimeout(r, 250));
    return answerQuestion(question, context);
  }
}
