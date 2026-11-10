import type { Logger } from '../logger';
import type { Queryable } from './types';

// Tables the mentorship and payment features need. A missing one means "npm run db:migrate" has not been run since they were added.
export const FEATURE_TABLES = ['mentors', 'mentor_sessions', 'bookings', 'payments'];
export async function missingTables(db: Queryable, names: string[] = FEATURE_TABLES): Promise<string[]> {
  const r = await db.query<{ name: string; found: string | null }>(`SELECT n AS name, to_regclass('public.' || n)::text AS found FROM unnest($1::text[]) AS n`, [names]);
  return r.rows.filter((x) => !x.found).map((x) => x.name);
}

// Startup hint only: it reports what is missing and the command that fixes it. It never changes the database.
export async function warnIfTablesMissing(db: Queryable, logger: Logger): Promise<void> {
  const missing = await missingTables(db).catch(() => []);
  if (missing.length) logger.warn(`Database is missing: ${missing.join(', ')}. Mentor booking and payments will fail until you run "npm run db:migrate" and restart the server.`);
}
