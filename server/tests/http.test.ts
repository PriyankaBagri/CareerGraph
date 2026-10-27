import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError, notFound } from '../src/errors';
import { bodyParserError, corsHeaders, securityHeaders } from '../src/http/handler';
import type { Route } from '../src/http/types';
import { Validator } from '../src/validation';
import { FakeDb, makeCtx, makeHandler, req, testConfig } from './helpers';
import type { Logger } from '../src/logger';

const logged: { msg: string; meta?: object }[] = [];
const spy: Logger = { info: () => {}, warn: () => {}, error: (msg, meta) => void logged.push({ msg, meta }) };
const routes: Route[] = [
  { method: 'GET', path: '/api/ok', handler: () => ({ status: 200, body: { ok: true } }) },
  { method: 'POST', path: '/api/ok', handler: () => ({ status: 201, body: {} }) },
  { method: 'GET', path: '/api/things/:id', handler: (r) => ({ status: 200, body: { id: r.params.id } }) },
  { method: 'GET', path: '/api/boom', handler: () => { throw new Error('connection to postgres://u:SECRETPW@dbhost failed'); } },
  { method: 'GET', path: '/api/app-error', handler: () => { throw new AppError(422, 'custom', 'Custom problem.'); } },
  { method: 'GET', path: '/api/missing', handler: () => { throw notFound('Thing not found.'); } },
  { method: 'POST', path: '/api/validate', handler: (r) => { const v = new Validator(r.body); v.string('name'); v.int('n', { min: 1 }); v.done(); return { status: 200 }; } },
];
const h = (over = {}) => makeHandler(routes, makeCtx({ logger: spy, ...over }));

describe('routing and errors', () => {
  it('serves matching routes and decodes params', async () => {
    const r = await h()(req({ path: '/api/things/act%3Askill%3Aux' }));
    assert.equal(r.status, 200); assert.deepEqual(r.body, { id: 'act:skill:ux' });
  });
  it('404 for unknown paths with a consistent error body', async () => {
    const r = await h()(req({ path: '/api/nope' }));
    assert.equal(r.status, 404); const e = (r.body as { error: { code: string; requestId: string } }).error;
    assert.equal(e.code, 'not_found'); assert.ok(e.requestId);
  });
  it('405 with Allow header for a known path and wrong method', async () => {
    const r = await h()(req({ method: 'DELETE', path: '/api/ok' }));
    assert.equal(r.status, 405); assert.equal(r.headers?.Allow, 'GET, POST');
  });
  it('passes AppErrors through and keeps field details for validation errors', async () => {
    assert.equal((await h()(req({ path: '/api/app-error' }))).status, 422);
    const r = await h()(req({ method: 'POST', path: '/api/validate', body: { name: '', n: 0 } }));
    const e = (r.body as { error: { code: string; fields: Record<string, string> } }).error;
    assert.equal(r.status, 400); assert.equal(e.code, 'validation_failed'); assert.deepEqual(Object.keys(e.fields).sort(), ['n', 'name']);
  });
  it('hides internal errors from the client but logs them with a request id', async () => {
    logged.length = 0;
    const r = await h()(req({ path: '/api/boom', headers: { 'x-request-id': 'req-abcdef-123' } }));
    const text = JSON.stringify(r);
    assert.equal(r.status, 500); assert.ok(!text.includes('SECRETPW') && !text.includes('postgres://') && !text.includes('at '));
    assert.equal((r.body as { error: { code: string } }).error.code, 'internal_error');
    assert.equal(logged.length, 1); assert.equal((logged[0].meta as { requestId?: string }).requestId, 'req-abcdef-123'); // detail stays server-side, tied to the request id
    assert.equal(r.headers?.['X-Request-Id'], 'req-abcdef-123');
  });
  it('generates a request id and rejects unsafe ones', async () => {
    const a = await h()(req({ path: '/api/ok' })); assert.match(String(a.headers?.['X-Request-Id']), /^[0-9a-f-]{36}$/);
    const b = await h()(req({ path: '/api/ok', headers: { 'x-request-id': 'bad id\r\nX-Evil: 1' } })); assert.match(String(b.headers?.['X-Request-Id']), /^[0-9a-f-]{36}$/);
  });
  it('maps body-parser failures', () => {
    assert.equal(bodyParserError({ type: 'entity.parse.failed' })?.status, 400);
    assert.equal(bodyParserError({ type: 'entity.too.large' })?.status, 413);
    assert.equal(bodyParserError(new Error('x')), null);
  });
});

describe('security headers and CORS', () => {
  it('sets security headers; HSTS only in production', () => {
    assert.equal(securityHeaders(false)['X-Content-Type-Options'], 'nosniff'); assert.ok(!('Strict-Transport-Security' in securityHeaders(false)));
    assert.ok('Strict-Transport-Security' in securityHeaders(true));
  });
  it('allows only configured origins, never a wildcard', async () => {
    const ok = await h()(req({ path: '/api/ok', headers: { origin: 'http://localhost:5173' } }));
    assert.equal(ok.headers?.['Access-Control-Allow-Origin'], 'http://localhost:5173'); assert.equal(ok.headers?.Vary, 'Origin');
    const bad = await h()(req({ path: '/api/ok', headers: { origin: 'https://evil.example' } }));
    assert.ok(!('Access-Control-Allow-Origin' in (bad.headers ?? {}))); assert.equal(bad.headers?.Vary, 'Origin');
    assert.deepEqual(corsHeaders(undefined, ['http://x.com']), {});
  });
  it('answers preflight for allowed origins and gives disallowed origins no CORS grant', async () => {
    const pre = await h()(req({ method: 'OPTIONS', path: '/api/anything', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PUT' } }));
    assert.equal(pre.status, 204); assert.match(String(pre.headers?.['Access-Control-Allow-Methods']), /PUT/); assert.match(String(pre.headers?.['Access-Control-Allow-Headers']), /Authorization/);
    const no = await h()(req({ method: 'OPTIONS', path: '/api/ok', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } }));
    assert.equal(no.status, 204); assert.ok(!('Access-Control-Allow-Origin' in (no.headers ?? {})));
  });
  it('adds CORS and security headers to error responses too', async () => {
    const r = await h()(req({ path: '/api/nope', headers: { origin: 'http://localhost:5173' } }));
    assert.equal(r.status, 404); assert.equal(r.headers?.['Access-Control-Allow-Origin'], 'http://localhost:5173'); assert.equal(r.headers?.['X-Frame-Options'], 'DENY');
  });
  it('honours multiple configured origins', async () => {
    const r = await makeHandler(routes, makeCtx({ config: testConfig({ clientOrigins: ['https://a.example', 'https://b.example'] }) }, new FakeDb()))(req({ path: '/api/ok', headers: { origin: 'https://b.example' } }));
    assert.equal(r.headers?.['Access-Control-Allow-Origin'], 'https://b.example');
  });
});
