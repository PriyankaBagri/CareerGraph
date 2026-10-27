// Tells the UI when a request is slow or being retried. On free hosting the API sleeps when idle and needs up to a minute to wake;
// without this the page would look frozen. It only reports state: it never changes a request or its result.
export type ApiPhase = 'idle' | 'waking' | 'retrying';
let slow = 0, retrying = 0, phase: ApiPhase = 'idle';
const listeners = new Set<() => void>();
const update = (): void => {
  const next: ApiPhase = retrying > 0 ? 'retrying' : slow > 0 ? 'waking' : 'idle';
  if (next === phase) return;
  phase = next; listeners.forEach((l) => l());
};
export const apiStatus = {
  get: (): ApiPhase => phase,
  subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; },
  slow(delta: 1 | -1) { slow = Math.max(0, slow + delta); update(); },
  retrying(delta: 1 | -1) { retrying = Math.max(0, retrying + delta); update(); },
};
