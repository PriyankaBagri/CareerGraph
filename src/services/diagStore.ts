// Tiny dev-only store of connection diagnostics. It records only method, path, HTTP status, an error CODE and timing:
// never headers, bodies, tokens, cookies or passwords. No imports, so api.ts can use it without a cycle.
export interface RequestRecord { method: string; path: string; status: number; code?: string; ms: number }
export interface DiagState {
  health: 'unknown' | 'ok' | 'degraded' | 'down'; healthDetail: string;
  last: RequestRecord | null; lastFailure: RequestRecord | null; requests: number; failures: number; notes: string[];
}
const empty = (): DiagState => ({ health: 'unknown', healthDetail: 'not checked yet', last: null, lastFailure: null, requests: 0, failures: 0, notes: [] });
let state: DiagState = empty();
const listeners = new Set<() => void>();
const set = (next: DiagState) => { state = next; listeners.forEach((l) => l()); };
export const getDiagState = (): DiagState => state;
export const subscribeDiag = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const resetDiag = () => set(empty());
export function recordRequest(r: RequestRecord): void {
  const failed = r.status === 0 || r.status >= 400;
  set({ ...state, last: r, lastFailure: failed ? r : state.lastFailure, requests: state.requests + 1, failures: state.failures + (failed ? 1 : 0) });
}
export function setHealth(health: DiagState['health'], healthDetail: string): void { set({ ...state, health, healthDetail }); }
// Short, de-duplicated explanations such as "career X is analysed locally".
export function addNote(note: string): void { if (!state.notes.includes(note)) set({ ...state, notes: [...state.notes.slice(-4), note] }); }
