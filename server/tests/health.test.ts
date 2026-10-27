import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routes } from '../src/routes';
import { FakeDb, makeCtx, makeHandler, req } from './helpers';

const body = (r: { body?: unknown }) => r.body as Record<string, unknown>;
describe('GET /api/health', () => {
  it('is registered and reports ok when the database answers', async () => {
    const r = await makeHandler(routes, makeCtx())(req());
    assert.equal(r.status, 200);
    assert.deepEqual({ status: body(r).status, database: body(r).database, service: body(r).service, version: body(r).version, time: body(r).time }, { status: 'ok', database: 'up', service: 'careergraph-api', version: '9.9.9', time: '2026-01-01T00:00:00.000Z' });
    assert.equal(typeof body(r).uptimeSeconds, 'number');
  });
  it('reports degraded with 503 when the database is down, without leaking details', async () => {
    const db = new FakeDb(); db.pingImpl = async () => { throw new Error('connect ECONNREFUSED dbhost:5432 password=SECRETPW'); };
    const r = await makeHandler(routes, makeCtx({}, db))(req());
    assert.equal(r.status, 503); assert.equal(body(r).database, 'down'); assert.equal(body(r).status, 'degraded');
    assert.ok(!JSON.stringify(r).match(/SECRETPW|ECONNREFUSED|dbhost|postgres:/));
  });
  it('does not hang when the database ping never returns', async () => {
    const db = new FakeDb(); db.pingImpl = () => new Promise(() => {});
    const t = Date.now(); const r = await makeHandler(routes, makeCtx({ healthTimeoutMs: 30 }, db))(req());
    assert.equal(r.status, 503); assert.ok(Date.now() - t < 1000);
  });
  it('is GET only and includes CORS/security headers', async () => {
    const h = makeHandler(routes, makeCtx());
    assert.equal((await h(req({ method: 'POST' }))).status, 405);
    const r = await h(req({ headers: { origin: 'http://localhost:5173' } }));
    assert.equal(r.headers?.['Access-Control-Allow-Origin'], 'http://localhost:5173'); assert.equal(r.headers?.['Cache-Control'], 'no-store');
  });
});

describe('GET /api/live', () => {
  it('answers 200 without touching the database, even when the database is down', async () => {
    const db = new FakeDb(); db.pingImpl = async () => { throw new Error('connect ECONNREFUSED dbhost:5432 password=SECRETPW'); };
    const h = makeHandler(routes, makeCtx({}, db));
    const live = await h(req({ path: '/api/live' }));
    assert.equal(live.status, 200); assert.deepEqual(live.body, { status: 'alive', service: 'careergraph-api' });
    assert.equal(db.queries.length, 0); assert.ok(!JSON.stringify(live).match(/SECRETPW|dbhost|postgres:/));
    assert.equal((await h(req())).status, 503); // /api/health still reflects the real database state
  });
  it('is GET only, public, and carries the usual security headers', async () => {
    const h = makeHandler(routes, makeCtx());
    assert.equal((await h(req({ path: '/api/live', method: 'POST' }))).status, 405);
    assert.equal((await h(req({ path: '/api/live' }))).headers?.['X-Content-Type-Options'], 'nosniff');
  });
});
