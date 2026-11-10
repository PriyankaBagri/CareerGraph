import { loadConfig } from '../config';
import { CAREER_DATASETS } from '../domain/shared';
import { consoleLogger } from '../logger';
import { createPgDb } from './pool';
import { runMentorshipSeed } from './seedMentorship';
import { runSeed } from './seeding';

const config = loadConfig(process.env);
const db = createPgDb({ url: config.databaseUrl, ssl: config.databaseSsl, logger: consoleLogger });
try {
  const r = await runSeed(db, CAREER_DATASETS);
  console.log(`Seeded ${r.careers} careers (${r.statements} upserts). Safe to run again.`);
  const m = await runMentorshipSeed(db);
  console.log(`Seeded ${m.mentors} DEMO mentors and ${m.sessions} demo sessions (sample data, not real professionals).`);
} catch (e) {
  console.error('Seeding failed and was rolled back:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally { await db.close(); }
