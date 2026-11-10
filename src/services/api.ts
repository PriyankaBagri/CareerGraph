import { recordRequest } from './diagStore';
import { apiStatus } from './apiStatus';
// HTTP client + the boundary between real backend features and local (mock) features.
// `?.` lets this module load outside Vite (e.g. the Node test runner) where import.meta.env is undefined.
// Trimmed, quotes removed, trailing slashes dropped (a stray space/quote/slash from a hand-edited .env must not break every URL).
export const normalizeBase = (raw: string | undefined): string => (raw ?? '').trim().replace(/^["']|["']$/g, '').trim().replace(/\/+$/, '');
const rawEnv = import.meta.env?.VITE_API_URL as string | undefined;
let base = normalizeBase(rawEnv);
// Why the app is (not) on the backend, without revealing anything beyond the URL the developer typed: 'unset' = no value was loaded at all
// (.env missing, misnamed, unreadable or Vite not restarted), 'empty' = the variable exists but is blank, 'set' = a value was loaded.
export const envState = (): 'unset' | 'empty' | 'set' => (rawEnv === undefined ? 'unset' : normalizeBase(rawEnv) === '' ? 'empty' : 'set');
const isDev = (): boolean => import.meta.env?.DEV === true;

// Mode selection. The app NEVER drifts into browser-only demo data because a file is missing:
//   'backend'      VITE_API_URL is set -> real sign-in and data requests.
//   'demo'         only when explicitly chosen with VITE_DEMO_MODE=true (or outside Vite, i.e. the Node test runner, which has no import.meta.env).
//   'unconfigured' a Vite build with neither -> the app shows a setup message and refuses to sign anyone in against mock data.
export type AppMode = 'backend' | 'demo' | 'unconfigured';
const demoFlag = (): boolean => String(import.meta.env?.VITE_DEMO_MODE ?? '').trim().toLowerCase() === 'true';
let viteOverride: boolean | null = null; // tests only: lets the Node test runner behave like a Vite build
const insideVite = (): boolean => viteOverride ?? import.meta.env !== undefined;
export const resolveMode = (apiBase: string, demo: boolean, vite: boolean): AppMode => (apiBase ? 'backend' : demo || !vite ? 'demo' : 'unconfigured');
export const appMode = (): AppMode => resolveMode(base, demoFlag(), insideVite());
export const _setInsideViteForTests = (v: boolean | null): void => { viteOverride = v; };

// ONLY features listed as true have a real backend endpoint. Everything else keeps using local data even when VITE_API_URL is set,
// so pointing the app at the API never routes a not-yet-migrated feature to an endpoint that does not exist.
export type BackendFeature = 'auth' | 'profile' | 'progress' | 'settings' | 'careers' | 'assessments' | 'evidence' | 'analysis' | 'assistant' | 'mentorship';
// Stage 5: careers, skill assessments, evidence and readiness/gaps/actions use the backend whenever VITE_API_URL is set. Profile details, target career,
// onboarding state, custom careers, action progress and settings are stored on the server for the signed-in user too. Only legacy browser data stays local until the user imports it.
const BACKEND_FEATURES: Record<BackendFeature, boolean> = { auth: true, profile: true, progress: true, settings: true, careers: true, assessments: true, evidence: true, analysis: true, assistant: true, mentorship: true };

// 70 s: a sleeping free-tier API can need about a minute to wake. Model calls (assistant, career draft) keep their longer limit.
export const REQUEST_TIMEOUT_MS = 70_000, ASSISTANT_TIMEOUT_MS = 130_000;
export const SLOW_NOTICE_MS = 5_000, RETRY_DELAY_MS = 1_500; // show a notice after 5 s; wait 1.5 s before the single retry of a GET
export const requestTimeoutMs = (path: string): number => (path.startsWith('/assistant/chat') || path.startsWith('/assistant/plan') || path === '/careers/draft' ? ASSISTANT_TIMEOUT_MS : REQUEST_TIMEOUT_MS); // model calls get the longer limit
export const TOKEN_KEY = 'careergraph:token';
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly fields?: Record<string, string>) { super(message); }
}
let onUnauthorized: (() => void) | null = null;
const readToken = (): string | null => { try { return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = readToken();
  const started = Date.now();
  let res: Response;
  // A hung server must not leave the UI waiting forever. The assistant gets longer because the model itself may take a while.
  const ctl = new AbortController(), limit = requestTimeoutMs(path), timer = setTimeout(() => ctl.abort(), limit);
  try {
    res = await fetch(`${base}${path}`, { method, signal: ctl.signal, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    clearTimeout(timer);
    if (ctl.signal.aborted) {
      if (isDev()) recordRequest({ method, path, status: 0, code: 'timeout', ms: Date.now() - started });
      throw new ApiError(0, 'timeout', 'The server took too long to respond. Please try again.');
    }
    // The browser gives no detail for network/CORS failures. Dev console explains the usual causes; the user sees a plain message.
    if (isDev()) console.warn(`[CareerGraph API] ${method} ${path} could not reach ${base}. Is the backend running? Does its CLIENT_ORIGIN include ${typeof location !== 'undefined' ? location.origin : 'this page origin'}? (CORS blocks look the same as a network failure.)`);
    if (isDev()) recordRequest({ method, path, status: 0, code: 'network_error', ms: Date.now() - started });
    throw new ApiError(0, 'network_error', 'Could not reach the server. Please try again.');
  }
  // Dev-only: method, path (no query values of interest, no headers, no body, no token), status and timing.
  if (isDev()) console.debug(`[CareerGraph API] ${method} ${path} -> ${res.status} (${Date.now() - started} ms)`);
  if (res.status === 204) { clearTimeout(timer); if (isDev()) recordRequest({ method, path, status: 204, ms: Date.now() - started }); return undefined as T; }
  const data = (await res.json().catch(() => null).finally(() => clearTimeout(timer))) as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null;
  if (isDev()) recordRequest({ method, path, status: res.status, code: data?.error?.code, ms: Date.now() - started });
  if (res.status === 401 && token && ['token_expired', 'invalid_token'].includes(data?.error?.code ?? '')) onUnauthorized?.();
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `Request failed (${res.status})`, data?.error?.fields);
  return data as T;
}

// One attempt, with the "server is slow" notice. Model calls are slow by nature, so they never raise it.
async function attempt<T>(method: string, path: string, body?: unknown): Promise<T> {
  const watch = requestTimeoutMs(path) === REQUEST_TIMEOUT_MS;
  let shown = false;
  const t = watch ? setTimeout(() => { shown = true; apiStatus.slow(1); }, SLOW_NOTICE_MS) : undefined;
  try { return await send<T>(method, path, body); } finally { if (t) clearTimeout(t); if (shown) apiStatus.slow(-1); }
}

// Only a GET is retried (it changes nothing on the server), only once, and only for a timeout or a network failure. A real server answer, including every error status, is
// returned as it is. POST, PUT and DELETE are never retried: repeating a sign-up, a save or a delete could apply it twice.
const isTransient = (e: unknown): boolean => e instanceof ApiError && e.status === 0 && (e.code === 'timeout' || e.code === 'network_error');
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const api = {
  useBackend: (feature: BackendFeature): boolean => !!base && BACKEND_FEATURES[feature],
  // Called when an AUTHENTICATED request is rejected because the token is expired/invalid (not for wrong passwords).
  setUnauthorizedHandler(cb: (() => void) | null) { onUnauthorized = cb; },
  setBase(url: string) { base = normalizeBase(url); },
  getBase: (): string => base,
  // remember=true keeps the token across browser restarts (localStorage); false keeps it for the tab session only.
  setToken(token: string | null, remember = true) {
    try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ }
  },
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    try { return await attempt<T>(method, path, body); }
    catch (e) {
      if (method !== 'GET' || !isTransient(e)) throw e;
      apiStatus.retrying(1);
      try { await pause(RETRY_DELAY_MS); return await attempt<T>(method, path, body); } finally { apiStatus.retrying(-1); }
    }
  },
  // Best-effort wake-up of a sleeping server when the app opens. It touches no data, and a failure is ignored here because real requests report their own errors.
  warmUp(): void { if (base) void api.get('/live').catch(() => undefined); },
  get: <T>(path: string) => api.request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => api.request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => api.request<T>('PUT', path, body),
  delete: <T>(path: string) => api.request<T>('DELETE', path),
};
export const mockDelay = <T,>(value: T, ms = 250): Promise<T> => new Promise((r) => setTimeout(() => r(value), ms));
