import type { AssistantMessage } from '../types';

// The server accepts at most 12 turns kept, 2000 characters per turn and 12000 in total. The history is trimmed here so a long conversation keeps
// working instead of failing with a 400: newest turns win, each turn is cut to the cap, and the list always starts with a user turn.
export const AI_TURN_CHARS = 2000, AI_TOTAL_CHARS = 11000, AI_MAX_TURNS = 12;
export interface AiTurn { role: 'user' | 'assistant'; content: string }
export function buildHistory(messages: AssistantMessage[]): AiTurn[] {
  const usable = messages.filter((m) => !m.error && m.text.trim()).map((m): AiTurn => ({ role: m.role, content: m.text.trim().slice(0, AI_TURN_CHARS) }));
  const out: AiTurn[] = [];
  let total = 0;
  for (let i = usable.length - 1; i >= 0 && out.length < AI_MAX_TURNS; i--) {
    if (total + usable[i].content.length > AI_TOTAL_CHARS && out.length) break;
    total += usable[i].content.length; out.unshift(usable[i]);
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
