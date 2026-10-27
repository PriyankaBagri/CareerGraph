import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createHandler } from '../src/http/handler';
import { routes } from '../src/routes';
import { makeCtx } from './helpers';

// Real HTTP over a real socket using Node's http module (NOT Express: Express is not installed in every environment).
// It proves the framework-agnostic core behaves correctly on the wire; app.ts is only a thin adapter around it.
let server: Server, base = '';
before(async () => {
  const handle = createHandler(routes, makeCtx());
  server = createServer(async (rq, rs) => {
    const url = new URL(rq.url ?? '/', 'http://x');
    const out = await handle({ method: rq.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(Object.entries(rq.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) });
    rs.writeHead(out.status, { ...out.headers, 'Content-Type': 'application/json' });
    rs.end(out.body === undefined ? undefined : JSON.stringify(out.body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

describe('over a real socket', () => {
  it('GET /api/health returns JSON with security and CORS headers', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
    const body = await res.json() as { status: string; database: string };
    assert.equal(res.status, 200); assert.deepEqual([body.status, body.database], ['ok', 'up']);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff'); assert.ok(res.headers.get('x-request-id'));
  });
  it('unknown paths and wrong methods return the standard error shape', async () => {
    const nf = await fetch(`${base}/api/nope`); assert.equal(nf.status, 404); assert.equal(((await nf.json()) as { error: { code: string } }).error.code, 'not_found');
    const mna = await fetch(`${base}/api/health`, { method: 'POST' }); assert.equal(mna.status, 405); assert.equal(mna.headers.get('allow'), 'GET');
  });
  it('answers CORS preflight and withholds the grant from unknown origins', async () => {
    const ok = await fetch(`${base}/api/health`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const bad = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });
});
