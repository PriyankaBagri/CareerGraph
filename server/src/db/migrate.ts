import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config';
import { consoleLogger } from '../logger';
import { createPgDb } from './pool';
import { readMigrations, runMigrations } from './migrations';

const config = loadConfig(process.env);
const db = createPgDb({ url: config.databaseUrl, ssl: config.databaseSsl, logger: consoleLogger });
try {
  const dir = fileURLToPath(new URL('../../migrations', import.meta.url));
  const { applied, skipped } = await runMigrations(db, readMigrations(dir), (m) => console.log(m));
  console.log(applied.length ? `Applied ${applied.length} migration(s): ${applied.join(', ')}` : 'Database is up to date.', skipped.length ? `(${skipped.length} already applied)` : '');
} catch (e) {
  console.error('Migration failed and was rolled back:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally { await db.close(); }
