import express, { type NextFunction, type Request, type Response } from 'express';
import { createHandler, respondToError } from './http/handler';
import type { AppContext, Route } from './http/types';

const flat = (q: Request['query']) => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
const lower = (h: Request['headers']) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));

// Express is only the HTTP transport. All behaviour (routing, CORS, security headers, errors, health) lives in http/handler.ts.
export function createApp(routes: Route[], ctx: AppContext) {
  const handle = createHandler(routes, ctx);
  const send = (res: Response, out: Awaited<ReturnType<typeof handle>>) => {
    res.status(out.status);
    for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
    if (out.body === undefined) res.end(); else res.json(out.body);
  };
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(async (req: Request, res: Response) => {
    send(res, await handle({ method: req.method, path: req.path, query: flat(req.query), headers: lower(req.headers), body: req.body }));
  });
  // Errors raised before our handler runs (e.g. malformed JSON) still get the same shape, CORS and security headers.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => { send(res, respondToError(err, ctx, lower(req.headers))); });
  return app;
}
