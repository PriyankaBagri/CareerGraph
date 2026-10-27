import net from 'node:net';
import { inspectDatabaseUrl } from '../server/src/db/diagnose';

// Pure helpers for `npm run dev:all`. Nothing here prints or returns secret VALUES: messages only name the variable and the problem.
export const WEB_ORIGIN = 'http://localhost:5173';
export const DEFAULT_API_PORT = 4000;

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else { const hash = v.indexOf('#'); if (hash >= 0) v = v.slice(0, hash).trim(); } // Node's --env-file ends an unquoted value at '#', so mirror it
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

export interface Issue { level: 'error' | 'warn'; message: string }
// Problems with server/.env that would stop sign-in or the API from working. Never includes a value.
export function checkServerEnv(env: Record<string, string>, webOrigin = WEB_ORIGIN): Issue[] {
  const issues: Issue[] = [];
  if (!env.DATABASE_URL) issues.push({ level: 'error', message: 'DATABASE_URL is missing in server/.env (the API cannot reach PostgreSQL without it).' });
  else for (const m of inspectDatabaseUrl(env.DATABASE_URL).issues) issues.push({ level: 'error', message: `DATABASE_URL: ${m}` }); // messages never contain the value
  if ((env.JWT_SECRET ?? '').length < 32) issues.push({ level: 'error', message: 'JWT_SECRET is missing or shorter than 32 characters in server/.env: sign-up and login would answer 503.' });
  const origins = (env.CLIENT_ORIGIN ?? webOrigin).split(',').map((s) => s.trim());
  if (!origins.includes(webOrigin)) issues.push({ level: 'warn', message: `CLIENT_ORIGIN in server/.env does not include ${webOrigin}; the browser would block API calls (CORS).` });
  const port = env.PORT ? Number(env.PORT) : DEFAULT_API_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) issues.push({ level: 'error', message: 'PORT in server/.env is not a valid port number.' });
  return issues;
}
export const apiPort = (env: Record<string, string>): number => { const p = env.PORT ? Number(env.PORT) : DEFAULT_API_PORT; return Number.isInteger(p) ? p : DEFAULT_API_PORT; };

// True when nothing is listening on the port (checks both IPv4 and IPv6 loopback, as Vite and Express may bind either).
export async function isPortFree(port: number): Promise<boolean> {
  const tryHost = (host: string) => new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code !== 'EADDRINUSE')); // other errors (e.g. IPv6 unavailable) are not a conflict
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
  return (await tryHost('127.0.0.1')) && (await tryHost('::1'));
}

// The frontend needs VITE_API_URL to run in backend mode. A value in the root .env wins; otherwise the local default is used.
export function resolveApiUrl(rootEnvFile: Record<string, string>, processEnv: Record<string, string | undefined>, port: number): { url: string; source: 'process' | '.env' | 'default' } {
  if (processEnv.VITE_API_URL) return { url: processEnv.VITE_API_URL, source: 'process' };
  if (rootEnvFile.VITE_API_URL) return { url: rootEnvFile.VITE_API_URL, source: '.env' };
  return { url: `http://localhost:${port}/api`, source: 'default' };
}

export function summarizeHealth(body: unknown): string {
  const b = (body ?? {}) as { status?: unknown; database?: unknown };
  return `status=${typeof b.status === 'string' ? b.status : '?'}, database=${typeof b.database === 'string' ? b.database : '?'}`;
}
