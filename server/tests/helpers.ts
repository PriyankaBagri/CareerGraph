import { NO_AI, NO_PAYPAL, type Config } from '../src/config';
import type { Db, Queryable, QueryResult } from '../src/db/types';
import { createHandler } from '../src/http/handler';
import type { AppContext, RawRequest, Route } from '../src/http/types';
import { routes as appRoutes } from '../src/routes';
import { silentLogger, type Logger } from '../src/logger';
import { CAREER_DATASETS } from '../src/domain/shared';
import { createMemoryRepos } from '../src/repositories/memory';
import { createServices } from '../src/services';
import type { AiProvider } from '../src/ai/provider';
import type { PayPalFetch } from '../src/payments/paypal';

export interface Recorded { text: string; params?: unknown[] }
// In-memory Db double: records every query, simulates schema_migrations, and rolls back on failure like a real transaction.
export class FakeDb implements Db {
  queries: Recorded[] = [];
  applied = new Map<string, string>();
  failOn: RegExp | null = null;
  pingImpl: () => Promise<void> = async () => {};
  committed = 0; rolledBack = 0; closed = false;
  async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    this.queries.push({ text, params });
    if (this.failOn?.test(text)) throw new Error('simulated SQL failure');
    if (/SELECT name, checksum FROM schema_migrations/.test(text)) return { rows: [...this.applied].map(([name, checksum]) => ({ name, checksum })) as T[], rowCount: this.applied.size };
    if (/INSERT INTO schema_migrations/.test(text)) this.applied.set(String(params?.[0]), String(params?.[1]));
    return { rows: [], rowCount: 0 };
  }
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const snapshot = new Map(this.applied);
    try { const out = await fn(this); this.committed++; return out; }
    catch (e) { this.applied = snapshot; this.rolledBack++; throw e; }
  }
  ping() { return this.pingImpl(); }
  async close() { this.closed = true; }
}

export const testConfig = (over: Partial<Config> = {}): Config => ({ nodeEnv: 'test', production: false, port: 4000, databaseUrl: 'postgres://user:SECRETPW@dbhost:5432/cg', databaseSsl: false, clientOrigins: ['http://localhost:5173'], jwtSecret: 'test-secret-'.padEnd(48, 'x'), tokenTtlSeconds: 3600, ai: { ...NO_AI }, paypal: { ...NO_PAYPAL }, ...over });
const seededIds = CAREER_DATASETS.map((d) => d.career.id);
export function makeCtx(over: Partial<AppContext> = {}, db: FakeDb = new FakeDb(), logger: Logger = silentLogger): AppContext {
  const config = over.config ?? testConfig();
  const now = over.now ?? (() => new Date('2026-01-01T00:00:00.000Z'));
  const services = over.services ?? createServices({ repos: createMemoryRepos(seededIds, now), config, now });
  return { config, db, logger, services, now, version: '9.9.9', healthTimeoutMs: 50, ...over };
}
export const req = (over: Partial<RawRequest> = {}): RawRequest => ({ method: 'GET', path: '/api/health', query: {}, headers: {}, ...over });
export const makeHandler = (routes: Route[], ctx: AppContext) => createHandler(routes, ctx);

// A full in-memory app: real routes + auth middleware + services over memory repositories. `clock.ms` can be advanced to test expiry.
export function makeApp(over: { config?: Partial<Config>; now?: () => Date; aiProvider?: AiProvider | null; paypalFetch?: PayPalFetch; logger?: Logger } = {}) {
  const clock = { ms: Date.parse('2026-01-01T00:00:00.000Z') };
  const now = over.now ?? (() => new Date(clock.ms));
  const config = testConfig(over.config);
  const repos = createMemoryRepos(seededIds, now);
  const ctx = makeCtx({ config, now, services: createServices({ repos, config, now, aiProvider: over.aiProvider, paypalFetch: over.paypalFetch, logger: over.logger }) });
  const handler = createHandler(appRoutes, ctx);
  const call = async (method: string, path: string, o: { body?: unknown; token?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string | undefined> = { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...o.headers };
    const [pathname, qs = ''] = path.split('?');
    const res = await handler({ method, path: pathname, query: Object.fromEntries(new URLSearchParams(qs)), headers, body: o.body });
    return { status: res.status, body: res.body as Record<string, any>, headers: res.headers ?? {} }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { call, handler, repos, clock, ctx };
}
