import { ApiError } from '../services/api';

// Server validation errors (400 with per-field messages) show next to the matching field; anything else is a generic retry message.
const FIELD = { title: 'title', description: 'description', url: 'url', skillIds: 'skills' } as const;
export function saveErrors(err: unknown): Record<string, string> {
  if (err instanceof ApiError && err.status === 401) return { form: 'Your session has expired. Please sign in again.' };
  if (err instanceof ApiError && err.fields) {
    const out: Record<string, string> = {};
    for (const [k, msg] of Object.entries(err.fields)) out[(FIELD as Record<string, string>)[k] ?? 'form'] = msg;
    return out;
  }
  return { form: 'We could not save this evidence. Please try again.' };
}
