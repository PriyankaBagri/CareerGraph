import { useSyncExternalStore } from 'react';
import { appMode } from '../../services/api';
import { getDiagState, subscribeDiag, type RequestRecord } from '../../services/diagStore';
import { BACKEND_FEATURES_LIST, LOCAL_ONLY_LIST, currentModeInfo, formatModeLine } from '../../services/diagnostics';

// The diagnostics panel is opt-in so it does not clutter every page. Enable it in the browser console with
//   localStorage.setItem('careergraph:debug', '1')   (remove the key to hide it again), then reload.
export const debugPanelEnabled = (): boolean => { try { return localStorage.getItem('careergraph:debug') === '1'; } catch { return false; } };

const fmt = (r: RequestRecord) => `${r.method} ${r.path} -> ${r.status === 0 ? 'no response' : r.status}${r.code ? ` ${r.code}` : ''} (${r.ms} ms)`;

// Development builds, opt-in only (see debugPanelEnabled): diagnostics. Production builds: only a visible demo-mode notice when no API URL was configured (nothing otherwise). Shows whether data comes from the backend or local mock data, why,
// whether the backend answered its health check, and the last request / last failure. Never shows tokens, headers or bodies.
export default function DevDataSource() {
  const d = useSyncExternalStore(subscribeDiag, getDiagState, getDiagState);
  const info = currentModeInfo();
  // Production builds: no diagnostics, but if no API URL was compiled in the app is in browser-only demo mode, and that must be visible, never silent.
  if (import.meta.env?.DEV !== true) return appMode() === 'demo' ? <p className="mt-6 rounded-lg border border-warn p-3 text-xs text-warn" role="note" data-testid="demo-mode">Demo mode: you chose browser-only demo data, so your data is stored only in this browser and is not saved to an account.</p> : null;
  if (!debugPanelEnabled()) return null; // diagnostics are still collected (diagStore); only the panel is hidden by default
  const bad = info.mode === 'local' || info.problems.length > 0 || d.health === 'down' || d.health === 'degraded' || d.failures > 0;
  return (
    <details className={`mt-6 text-xs ${bad ? 'text-warn' : 'text-mute'}`} role="note" data-testid="dev-data-source">
      <summary className="cursor-pointer">{formatModeLine(info)} · dev only{bad ? ' · attention' : ''}</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {info.mode === 'local' && <li>Reason: {info.reason} No network requests are made in this mode.</li>}
        {info.problems.filter(() => info.mode === 'backend').map((p) => <li key={p}>Problem: {p}</li>)}
        {info.mode === 'backend' && <li>Backend health: {d.health}{d.healthDetail ? ` (${d.healthDetail})` : ''}</li>}
        {info.mode === 'backend' && <li>Using the backend: {BACKEND_FEATURES_LIST.join(', ')}. Still local: {LOCAL_ONLY_LIST.join(', ')}.</li>}
        {info.mode === 'backend' && <li>Requests this session: {d.requests}, failures: {d.failures}</li>}
        {d.last && <li>Last request: {fmt(d.last)}</li>}
        {d.lastFailure && <li>Last failure: {fmt(d.lastFailure)}{d.lastFailure.status === 0 ? ' - is the backend running, and does its CLIENT_ORIGIN include this page origin?' : d.lastFailure.status === 401 ? ' - signed out or token expired' : ''}</li>}
        {d.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </details>
  );
}
