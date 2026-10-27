import pg, { type QueryResult as PgQueryResult } from 'pg';
import type { Logger } from '../logger';
import { CONNECT_TIMEOUT_MS } from './timeouts';
import type { Db, Queryable, QueryResult } from './types';

const toResult = <T>(r: PgQueryResult): QueryResult<T> => ({ rows: r.rows as T[], rowCount: r.rowCount ?? 0 });

// All queries must be parameterized ($1, $2, ...). Values are never concatenated into SQL text.
export function createPgDb(opts: { url: string; ssl: boolean; logger: Logger }): Db {
  const pool = new pg.Pool({ connectionString: opts.url, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: CONNECT_TIMEOUT_MS, ssl: opts.ssl ? { rejectUnauthorized: true } : undefined });
  pool.on('error', (e) => opts.logger.error('Unexpected PostgreSQL pool error', { message: e.message }));
  return {
    query: async <T>(text: string, params?: unknown[]) => toResult<T>(await pool.query(text, params)),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: async <R>(text: string, params?: unknown[]) => toResult<R>(await client.query(text, params)) });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
        throw e;
      } finally { client.release(); }
    },
    async ping() { await pool.query('SELECT 1'); },
    close: () => pool.end(),
  };
}
