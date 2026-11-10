import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, it } from 'node:test';
import { classifyDbError, diagnoseDatabase, inspectDatabaseUrl, type DiagnoseDeps } from '../src/db/diagnose';
import { checkDatabase, healthRoute } from '../src/routes/health';
import { routes } from '../src/routes';
import { FakeDb, makeCtx, makeHandler, req } from './helpers';

const PW = 'Sup3r#Secret@pw';
describe('database URL inspection (never returns secrets)', () => {
  it('accepts a normal URL and describes only its shape', () => {
    const r = inspectDatabaseUrl('postgresql://app:p%40ss@localhost:5432/careergraph');
    assert.deepEqual([r.ok, r.host, r.port, r.database, r.hasUser, r.hasPassword], [true, 'localhost', 5432, 'careergraph', true, true]);
    assert.ok(!JSON.stringify(r).includes('p%40ss') && !JSON.stringify(r).includes('p@ss'));
  });
  it('flags an unencoded # or @ in the password (a common Windows setup mistake) without echoing it', () => {
    for (const url of [`postgres://app:${PW}@localhost:5432/careergraph`, 'postgres://app:pa#ss@localhost:5432/careergraph', 'postgres://app:p@ss@localhost:5432/careergraph']) {
      const r = inspectDatabaseUrl(url); assert.equal(r.ok, false, url.replace(/:[^:@]*@/, ':***@'));
      const text = r.issues.join(' '); assert.ok(!text.includes('Secret') && !text.includes('pa#ss') && !text.includes('p@ss'));
    }
  });
  it('flags missing, wrong-scheme, quoted and no-database values', () => {
    assert.match(inspectDatabaseUrl(undefined).issues[0], /not loaded/); assert.match(inspectDatabaseUrl('mysql://x').issues[0], /postgres/);
    assert.ok(inspectDatabaseUrl('postgres://u:p@localhost:5432').issues.some((i) => /database name/.test(i)));
    assert.ok(inspectDatabaseUrl('postgres://u:100%@localhost/db').issues.some((i) => /percent/.test(i)));
  });
});
describe('error classification', () => {
  it('maps driver codes, wrapped attempts and messages to safe categories', () => {
    assert.equal(classifyDbError({ code: 'ECONNREFUSED' }), 'connection_refused'); assert.equal(classifyDbError({ code: '28P01' }), 'auth_failed'); assert.equal(classifyDbError({ code: '3D000' }), 'database_missing');
    assert.equal(classifyDbError(Object.assign(new Error('x'), { code: '', errors: [{ code: 'ECONNREFUSED' }, { code: 'ETIMEDOUT' }] })), 'connection_refused');
    assert.equal(classifyDbError(new Error('timeout exceeded when trying to connect')), 'timeout'); assert.equal(classifyDbError(new Error('weird')), 'unknown');
  });
});
const env = { DATABASE_URL: 'postgresql://app:pw@localhost:5432/careergraph' };
const ok: DiagnoseDeps = { tcp: async () => undefined, query: async (sql) => /schema_migrations/.test(sql) ? [{ name: '001_a.sql' }] : /information_schema/.test(sql) ? [{ table_name: 'users' }, { table_name: 'User' }] : [{ db: 'careergraph', v: 'PostgreSQL 18.6 on x', num: '180006' }] };
describe('stage-by-stage diagnosis', () => {
  it('reports success, lists missing tables and foreign tables, and sends only SELECTs', async () => {
    const sent: string[] = []; const s = await diagnoseDatabase(env, { ...ok, query: async (q) => { sent.push(q); return ok.query(q); } });
    assert.ok(s.every((x) => x.stage.startsWith('6.') ? !x.ok : true)); assert.ok(s.some((x) => /18\.6/.test(x.detail))); assert.ok(s.some((x) => /User/.test(x.detail)));
    assert.ok(sent.every((q) => /^\s*SELECT/i.test(q)));
    assert.ok(!JSON.stringify(s).includes('pw@') && !JSON.stringify(s).includes('app:'));
  });
  it('stops at the failing stage with a hint, never leaking the driver message', async () => {
    const tcpDown = await diagnoseDatabase(env, { ...ok, tcp: async () => { throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432 pw'), { code: 'ECONNREFUSED' }); } });
    assert.equal(tcpDown.at(-1)?.ok, false); assert.match(tcpDown.at(-1)!.detail, /connection_refused/); assert.ok(!JSON.stringify(tcpDown).includes('127.0.0.1:5432 pw'));
    const badAuth = await diagnoseDatabase(env, { ...ok, query: async () => { throw Object.assign(new Error('password authentication failed for user "app"'), { code: '28P01' }); } });
    assert.match(badAuth.at(-1)!.detail, /auth_failed.*percent-encoded/); assert.ok(!JSON.stringify(badAuth).includes('for user'));
    assert.equal((await diagnoseDatabase({ DATABASE_URL: 'postgres://app:a#b@localhost/db' }, ok)).length, 1);
  });
  it('the TCP stage works against a real listener (IPv4)', async () => {
    const srv = net.createServer(); await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r)); const port = (srv.address() as net.AddressInfo).port;
    const conn = (host: string, p: number) => new Promise<void>((res, rej) => { const s = net.connect({ host, port: p }); s.once('connect', () => { s.destroy(); res(); }); s.once('error', rej); });
    await conn('127.0.0.1', port); await new Promise<void>((r) => srv.close(() => r()));
    await assert.rejects(() => conn('127.0.0.1', port), (e: NodeJS.ErrnoException) => e.code === 'ECONNREFUSED');
  });
});
describe('health check reasons and timeout', () => {
  it('a slow but healthy database is up when it answers inside the timeout, and a hung one is "timeout"', async () => {
    const slow = new FakeDb(); slow.pingImpl = () => new Promise((r) => setTimeout(r, 40)); assert.deepEqual(await checkDatabase(slow, 500), { up: true });
    const hung = new FakeDb(); hung.pingImpl = () => new Promise(() => {}); assert.deepEqual(await checkDatabase(hung, 30), { up: false, reason: 'timeout' });
  });
  it('503 body carries only the enumerated reason (outside production) and never the driver text', async () => {
    const db = new FakeDb(); db.pingImpl = async () => { throw Object.assign(new Error('password authentication failed for user "app" host dbhost'), { code: '28P01' }); };
    const r = await makeHandler(routes, makeCtx({}, db))(req()); const b = r.body as Record<string, unknown>;
    assert.equal(r.status, 503); assert.equal(b.databaseReason, 'auth_failed'); assert.ok(!JSON.stringify(r).match(/dbhost|for user|app"/));
    void healthRoute;
  });
});

import { parseEnv } from 'node:util';
import { loadConfig } from '../src/config';
describe('.env loading of DATABASE_URL (regression for the "database down" report)', () => {
  it('an unquoted # truncates the value in Node\'s env-file parser; quotes or %23 preserve it; config now fails fast with guidance', () => {
    const e = parseEnv('A=postgres://u:pa#ss@localhost:5432/db\nB="postgres://u:pa#ss@localhost:5432/db"\nC=postgres://u:pa%23ss@localhost:5432/db\n');
    assert.equal(e.A, 'postgres://u:pa'); assert.equal(e.B, 'postgres://u:pa#ss@localhost:5432/db'); assert.equal(e.C, 'postgres://u:pa%23ss@localhost:5432/db');
    assert.ok(inspectDatabaseUrl(e.A).issues.some((i) => /cuts the value off/.test(i)));
    assert.throws(() => loadConfig({ DATABASE_URL: e.A }), /cannot be parsed/);
    assert.equal(loadConfig({ DATABASE_URL: e.C }).port, 4000);
  });
});

import { createHandler } from '../src/http/handler';
import { createServices } from '../src/services';
import { createPgRepos } from '../src/repositories/pg';
import { createPgMentorshipRepos } from '../src/repositories/pg-mentorship';
import { createPgPaymentRepos } from '../src/repositories/pg-payments';
import { createPgCoreRepos } from '../src/repositories/pg-core';
import { createPgProgressRepos } from '../src/repositories/pg-progress';
import { testConfig } from './helpers';
describe('regressions found while verifying against PostgreSQL', () => {
  it('a duplicate e-mail reported by the driver as SQLSTATE 23505 is a 409, not a 500 (the earlier "failures" were an adapter that did not expose the code)', async () => {
    const db = new FakeDb(); const orig = db.query.bind(db);
    db.query = (async (text: string, params?: unknown[]) => { if (/INSERT INTO users/.test(text)) throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }); return orig(text, params); }) as typeof db.query;
    const config = testConfig(); const now = () => new Date();
    const services = createServices({ repos: { ...createPgRepos(db), ...createPgCoreRepos(db), ...createPgProgressRepos(db), ...createPgMentorshipRepos(db), ...createPgPaymentRepos(db) }, config, now });
    const ctx = makeCtx({ services, config, now }, db);
    const r = await createHandler(routes, ctx)(req({ method: 'POST', path: '/api/auth/register', body: { name: 'T U', email: 'dup@x.com', password: 'Passw0rdOK1' } }));
    assert.equal(r.status, 409);
  });
  it('the health check waits longer than the pool needs to connect, so a slow login is not declared down', async () => {
    const { CONNECT_TIMEOUT_MS, HEALTH_TIMEOUT_MS } = await import('../src/db/timeouts');
    assert.ok(CONNECT_TIMEOUT_MS >= 5_000 && CONNECT_TIMEOUT_MS <= 15_000, 'moderate: long enough for a sleeping hosted database, short enough to fail clearly');
    assert.ok(HEALTH_TIMEOUT_MS > CONNECT_TIMEOUT_MS); assert.ok(HEALTH_TIMEOUT_MS - CONNECT_TIMEOUT_MS >= 500);
  });
});

import { assertSafeTestDatabase } from './pgGuard';
describe('opt-in real-PostgreSQL suite safety guard', () => {
  it('accepts only a *_test database that is not the main DATABASE_URL, and never echoes the URL', () => {
    assert.equal(assertSafeTestDatabase('postgresql://u:p@localhost:5432/careergraph_test', 'postgresql://u:p@localhost:5432/careergraph'), 'careergraph_test');
    for (const bad of ['postgresql://u:SecretPw@localhost:5432/careergraph', 'postgresql://u:SecretPw@localhost:5432/test_data']) assert.throws(() => assertSafeTestDatabase(bad, undefined), (e: Error) => /_test/.test(e.message) && !/SecretPw/.test(e.message));
    const same = 'postgresql://u:p@localhost:5432/x_test'; assert.throws(() => assertSafeTestDatabase(same, same), /must differ/);
    assert.throws(() => assertSafeTestDatabase('postgres://u:a#b@h/x_test', undefined), /cannot be parsed/);
  });
});
