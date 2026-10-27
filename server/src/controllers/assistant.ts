import type { ChatTurn } from '../ai/provider';
import type { Handler } from '../http/types';
import { MAX_TOTAL_CHARS, MAX_TURN_CHARS, MAX_TURNS } from '../services/assistant';
import { ValidationError } from '../validation';

const PAGES = ['dashboard', 'skills', 'skill', 'evidence', 'roadmap', 'profile', 'assistant'];
const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/;
export const assistantStatus: Handler = (_req, ctx) => ({ status: 200, body: ctx.services.assistant.status() });
export const assistantChat: Handler = async (req, ctx) => {
  const b = req.body;
  if (typeof b !== 'object' || b === null || Array.isArray(b)) throw new ValidationError({ body: 'Send a JSON object.' });
  const { messages, careerId, page, skillId } = b as { messages?: unknown; careerId?: unknown; page?: unknown; skillId?: unknown };
  if (page !== undefined && (typeof page !== 'string' || !PAGES.includes(page))) throw new ValidationError({ page: 'Unknown page.' });
  if (skillId !== undefined && (typeof skillId !== 'string' || !ID.test(skillId))) throw new ValidationError({ skillId: 'Invalid id.' });
  if (careerId !== undefined && (typeof careerId !== 'string' || !ID.test(careerId))) throw new ValidationError({ careerId: 'Invalid id.' });
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_TURNS) throw new ValidationError({ messages: `Send between 1 and ${MAX_TURNS} messages.` });
  let total = 0;
  const turns: ChatTurn[] = messages.map((m, i): ChatTurn => {
    const t = m as { role?: unknown; content?: unknown };
    if (typeof m !== 'object' || m === null || (t.role !== 'user' && t.role !== 'assistant')) throw new ValidationError({ messages: `Message ${i + 1} must have role "user" or "assistant".` });
    if (typeof t.content !== 'string' || !t.content.trim()) throw new ValidationError({ messages: `Message ${i + 1} must not be empty.` });
    if (t.content.length > MAX_TURN_CHARS) throw new ValidationError({ messages: `Message ${i + 1} is longer than ${MAX_TURN_CHARS} characters.` });
    total += t.content.length;
    return { role: t.role as ChatTurn['role'], content: t.content.trim() };
  });
  if (total > MAX_TOTAL_CHARS) throw new ValidationError({ messages: `The conversation is longer than ${MAX_TOTAL_CHARS} characters in total.` });
  if (turns[turns.length - 1].role !== 'user') throw new ValidationError({ messages: 'The last message must be from the user.' });
  return { status: 200, body: await ctx.services.assistant.chat(req.userId as string, { careerId: careerId as string | undefined, messages: turns, page: page as string | undefined, skillId: skillId as string | undefined }) };
};
