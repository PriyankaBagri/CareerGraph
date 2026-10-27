// `npm run db:check` (in server/): read-only connectivity diagnostic using the SAME driver and settings as the API. Prints no secrets.
import net from 'node:net';
import pg from 'pg';
import { diagnoseDatabase } from './diagnose';

const env = process.env;
const ssl = env.DATABASE_SSL === 'true';
const tcp = (host: string, port: number) => new Promise<void>((resolve, reject) => {
  const s = net.connect({ host, port, timeout: 4000 }); // 'localhost' may resolve to ::1 or 127.0.0.1; Node tries both
  s.once('connect', () => { s.destroy(); resolve(); });
  s.once('timeout', () => { s.destroy(); reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); });
  s.once('error', reject);
});
// The pool is created lazily inside query(). It lives in an object property (not a `let` variable) because TypeScript does not see assignments made inside
// closures: a `let pool = null` would be narrowed to `null` at the cleanup below and `pool?.end()` would be typed `never`.
const state: { pool: pg.Pool | null } = { pool: null };
const query = async (sql: string) => { state.pool ??= new pg.Pool({ connectionString: (env.DATABASE_URL ?? '').trim(), max: 1, connectionTimeoutMillis: 8000, ssl: ssl ? { rejectUnauthorized: true } : undefined }); return (await state.pool.query(sql)).rows as Record<string, unknown>[]; };
const stages = await diagnoseDatabase(env, { tcp, query });
console.log('CareerGraph database check (read-only; no secrets are printed)\n');
for (const s of stages) console.log(`${s.ok ? 'OK  ' : 'FAIL'}  ${s.stage}\n      ${s.detail}`);
await state.pool?.end().catch(() => undefined);
process.exit(stages.some((s) => !s.ok && !s.stage.startsWith('5.')) ? 1 : 0);
