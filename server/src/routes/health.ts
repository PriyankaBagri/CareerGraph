import type { Db } from '../db/types';
import type { Route } from '../http/types';
import { classifyDbError, type DbReason } from '../db/diagnose';

export async function checkDatabase(db: Db, timeoutMs: number): Promise<{ up: boolean; reason?: DbReason }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([db.ping(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), timeoutMs); })]);
    return { up: true };
  } catch (e) { return { up: false, reason: classifyDbError(e) }; } finally { if (timer) clearTimeout(timer); }
}
export async function isDatabaseUp(db: Db, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([db.ping(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]);
    return true;
  } catch { return false; } finally { if (timer) clearTimeout(timer); }
}

// Reports service and database state only. No connection strings, hostnames or error text are exposed (only an enumerated reason outside production).
export const healthRoute: Route = {
  method: 'GET', path: '/api/health',
  handler: async (_req, ctx) => {
    const { up, reason } = await checkDatabase(ctx.db, ctx.healthTimeoutMs);
    if (!up) ctx.logger.warn('Database health check failed', { reason }); // category only: never the driver message, URL or credentials
    // A short enumerated reason helps diagnose local setups; it is withheld in production.
    return { status: up ? 200 : 503, body: { status: up ? 'ok' : 'degraded', service: 'careergraph-api', version: ctx.version, time: ctx.now().toISOString(), uptimeSeconds: Math.round(process.uptime()), database: up ? 'up' : 'down', ...(!up && !ctx.config.production ? { databaseReason: reason } : {}) } };
  },
};

// Process liveness only: answers if Node and the HTTP server are up. It deliberately does NOT touch the database, so a sleeping or unreachable database
// can never make a host think the API process is dead. Use /api/health to check the database.
export const liveRoute: Route = {
  method: 'GET', path: '/api/live',
  handler: async () => ({ status: 200, body: { status: 'alive', service: 'careergraph-api' } }),
};
