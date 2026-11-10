import { DEMO_MENTORS } from '../domain/demoMentors';
import type { Statement } from './seeding';
import type { Db } from './types';

// Idempotent upserts of the DEMO mentors and sessions (is_demo = true). Never touches bookings or any user data. Safe to run repeatedly.
export function buildMentorshipSeedStatements(): Statement[] {
  const mentors: Statement[] = [], fields: Statement[] = [], sessions: Statement[] = [];
  for (const m of DEMO_MENTORS) {
    mentors.push({ text: `INSERT INTO mentors (id, display_name, headline, bio, expertise, is_demo) VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, headline = EXCLUDED.headline, bio = EXCLUDED.bio, expertise = EXCLUDED.expertise, is_demo = true, updated_at = now()`,
      params: [m.id, m.displayName, m.headline, m.bio, m.expertise] });
    for (const f of m.fields) fields.push({ text: 'INSERT INTO mentor_fields (mentor_id, field) VALUES ($1, $2) ON CONFLICT DO NOTHING', params: [m.id, f] });
    for (const s of m.sessions) sessions.push({ text: `INSERT INTO mentor_sessions (id, mentor_id, title, description, duration_minutes, price, currency) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET mentor_id = EXCLUDED.mentor_id, title = EXCLUDED.title, description = EXCLUDED.description, duration_minutes = EXCLUDED.duration_minutes, price = EXCLUDED.price, currency = EXCLUDED.currency, updated_at = now()`,
      params: [s.id, m.id, s.title, s.description, s.durationMinutes, s.price, s.currency] });
  }
  return [...mentors, ...fields, ...sessions]; // parents before children
}

export async function runMentorshipSeed(db: Db): Promise<{ mentors: number; sessions: number }> {
  const statements = buildMentorshipSeedStatements();
  await db.transaction(async (tx) => { for (const s of statements) await tx.query(s.text, s.params); });
  return { mentors: DEMO_MENTORS.length, sessions: DEMO_MENTORS.reduce((n, m) => n + m.sessions.length, 0) };
}
