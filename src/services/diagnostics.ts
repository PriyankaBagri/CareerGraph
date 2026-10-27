// Development diagnostics. Nothing here ever reads, logs or sends a token, password, cookie or Authorization header.
import { api, appMode, envState } from './api';
import { setHealth } from './diagStore';

export interface ApiModeInfo { mode: 'backend' | 'local'; base: string; problems: string[]; reason: string }
export const BACKEND_FEATURES_LIST = ['auth', 'careers', 'assessments', 'evidence', 'analysis'] as const;
export const LOCAL_ONLY_LIST = ['profile details', 'target career', 'onboarding flag', 'custom careers', 'action progress'] as const;

// Pure: explains how the app will behave for a given base URL (and how the env var looked) and flags likely mistakes.
export function describeApiMode(base: string, env: 'unset' | 'empty' | 'set' = base ? 'set' : 'unset'): ApiModeInfo {
  if (!base) {
    const reason = env === 'unset'
      ? 'VITE_API_URL was not loaded at all (undefined). Check that the file is named exactly ".env" or ".env.local" (not ".env.txt"), is in the folder that contains package.json (not in server/), is saved as UTF-8, and that `npm run dev` was restarted.'
      : 'VITE_API_URL is present but blank, so the backend is switched off on purpose.';
    return { mode: 'local', base: '', reason, problems: [`${reason} In local mode the app makes NO network requests, so an empty Network tab is expected.`] };
  }
  const problems: string[] = [];
  if (!/^https?:\/\/[^\s/]+/i.test(base)) problems.push(`"${base}" is not an http(s) URL.`);
  if (/\/api\/api(\/|$)/i.test(base)) problems.push('The base URL contains "/api" twice. Use ...:4000/api exactly once; the client adds only /careers, /me/skills, etc.');
  else if (!/\/api$/i.test(base)) problems.push('The base URL does not end with "/api". The backend routes live under /api, so requests will 404 unless a proxy maps them.');
  return { mode: 'backend', base, problems, reason: 'VITE_API_URL is set.' };
}
export const currentModeInfo = (): ApiModeInfo => describeApiMode(api.getBase(), envState());
export const formatModeLine = (i: ApiModeInfo): string => (i.mode === 'backend' ? `Data source: BACKEND (${i.base})` : (appMode() === 'unconfigured' ? 'Data source: NONE (no backend configured and demo mode is off)' : 'Data source: LOCAL DEMO DATA (VITE_DEMO_MODE=true)'));

// Dev only: prints the data source once at startup and probes GET <base>/health (public, no credentials, no token).
export async function startDiagnostics(): Promise<void> {
  const info = currentModeInfo();
  console.info(`[CareerGraph] ${formatModeLine(info)}`);
  for (const p of info.problems) console.warn(`[CareerGraph] ${p}`);
  if (info.mode !== 'backend') return;
  try {
    const res = await fetch(`${info.base}/health`);
    const body = (await res.json().catch(() => null)) as { status?: string; database?: string } | null;
    const detail = `HTTP ${res.status}, status=${body?.status ?? '?'}, database=${body?.database ?? '?'}`;
    setHealth(res.ok && body?.status === 'ok' ? 'ok' : 'degraded', detail);
    console.info(`[CareerGraph] Backend health: ${detail}`);
  } catch {
    setHealth('down', 'unreachable (server not running, wrong port, or CORS blocked)');
    console.warn(`[CareerGraph] Cannot reach ${info.base}/health. Start the backend (cd server; npm run dev) and make sure its CLIENT_ORIGIN includes ${location.origin}.`);
  }
}
