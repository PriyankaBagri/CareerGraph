import { randomUUID } from 'node:crypto';
import { AppError, badRequest, methodNotAllowed, notFound, payloadTooLarge, unauthorized } from '../errors';
import type { AppContext, HttpResponse, RawRequest, Route } from './types';

const METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

export function corsHeaders(origin: string | undefined, allowed: string[]): Record<string, string> {
  if (!origin) return {};
  if (!allowed.includes(origin)) return { Vary: 'Origin' }; // no Access-Control-Allow-Origin: the browser blocks the response
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': METHODS, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' };
}
export function securityHeaders(production: boolean): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...(production ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' } : {}),
  };
}
const requestIdFrom = (h: string | undefined) => (h && /^[A-Za-z0-9._-]{8,64}$/.test(h) ? h : randomUUID());
const baseHeaders = (ctx: AppContext, origin: string | undefined, requestId: string) => ({ ...securityHeaders(ctx.config.production), ...corsHeaders(origin, ctx.config.clientOrigins), 'X-Request-Id': requestId });

// Maps body-parser (express.json) failures to our error type.
export function bodyParserError(err: unknown): AppError | null {
  const type = typeof err === 'object' && err !== null ? (err as { type?: unknown }).type : undefined;
  if (type === 'entity.too.large') return payloadTooLarge();
  if (type === 'entity.parse.failed' || type === 'encoding.unsupported' || type === 'charset.unsupported') return badRequest('The request body is not valid JSON.');
  return null;
}

// The single place errors become responses. Known AppErrors are shown; anything else is logged server-side and hidden.
export function respondToError(err: unknown, ctx: AppContext, headers: Record<string, string | undefined>): HttpResponse {
  const requestId = requestIdFrom(headers['x-request-id']);
  const base = baseHeaders(ctx, headers.origin, requestId);
  const known = bodyParserError(err) ?? (err instanceof AppError && err.expose ? err : null);
  if (known) {
    const extra: Record<string, string> = known.status === 405 && known.details ? { Allow: (known.details as { allow: string[] }).allow.join(', ') } : known.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : known.status === 429 && known.details ? { 'Retry-After': String((known.details as { retryAfterSeconds: number }).retryAfterSeconds) } : {};
    const fields = known.code === 'validation_failed' ? { fields: known.details } : {};
    return { status: known.status, headers: { ...base, ...extra }, body: { error: { code: known.code, message: known.message, requestId, ...fields } } };
  }
  ctx.logger.error('Unhandled error', { requestId, message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
  return { status: 500, headers: base, body: { error: { code: 'internal_error', message: 'Something went wrong on our side.', requestId } } };
}

function match(pattern: string[], segs: string[]): Record<string, string> | null {
  if (pattern.length !== segs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i].startsWith(':')) { try { params[pattern[i].slice(1)] = decodeURIComponent(segs[i]); } catch { return null; } }
    else if (pattern[i] !== segs[i]) return null;
  }
  return params;
}

export function createHandler(routes: Route[], ctx: AppContext) {
  const compiled = routes.map((route) => ({ route, segs: route.path.split('/').filter(Boolean) }));
  return async function handle(req: RawRequest): Promise<HttpResponse> {
    const started = Date.now();
    const requestId = requestIdFrom(req.headers['x-request-id']);
    const headers = { ...req.headers, 'x-request-id': requestId };
    let res: HttpResponse;
    try {
      if (req.method === 'OPTIONS') res = { status: 204, headers: baseHeaders(ctx, req.headers.origin, requestId) };
      else {
        const segs = req.path.split('/').filter(Boolean);
        const hits = compiled.map((c) => ({ c, params: match(c.segs, segs) })).filter((h) => h.params);
        if (!hits.length) throw notFound('No such endpoint.');
        const hit = hits.find((h) => h.c.route.method === req.method);
        if (!hit) throw methodNotAllowed([...new Set(hits.map((h) => h.c.route.method))]);
        // Authentication middleware step: identity comes ONLY from a verified Bearer token.
        let userId: string | undefined;
        if (hit.c.route.auth) {
          const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.headers.authorization ?? '');
          if (!m) throw unauthorized(req.headers.authorization ? 'Malformed Authorization header.' : 'Authentication required.', req.headers.authorization ? 'invalid_token' : 'token_missing');
          userId = await ctx.services.auth.authenticate(m[1]);
        }
        const out = await hit.c.route.handler({ ...req, params: hit.params ?? {}, userId }, ctx);
        res = { ...out, headers: { ...baseHeaders(ctx, req.headers.origin, requestId), ...out.headers } };
      }
    } catch (err) { res = respondToError(err, ctx, headers); }
    ctx.logger.info('request', { requestId, method: req.method, path: req.path, status: res.status, ms: Date.now() - started });
    return res;
  };
}
