import { createPgDb } from '../src/db/pool';
import { silentLogger } from '../src/logger';
import { assertSafeTestDatabase } from './pgGuard';
import { registerPgSuite } from './pgSuite';

// Opt-in: runs only when TEST_DATABASE_URL is set, and ONLY against a database whose name ends in "_test". It never touches DATABASE_URL.
const url = (process.env.TEST_DATABASE_URL ?? '').trim();
if (!url) { console.log('pg.integration: skipped (set TEST_DATABASE_URL to a database named *_test to run it)'); }
else {
  const dbName = assertSafeTestDatabase(url, process.env.DATABASE_URL);
  const db = createPgDb({ url, ssl: process.env.TEST_DATABASE_SSL === 'true', logger: silentLogger });
  registerPgSuite(db, `server ${dbName}`);
  const { after } = await import('node:test'); after(() => db.close());
}
