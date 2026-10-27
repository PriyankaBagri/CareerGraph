// Blocks a second submit while one is in flight (double click, Enter pressed twice) without blocking a later, separate submit.
export interface SubmitGuard { tryEnter(): boolean; leave(): void }
export function createSubmitGuard(): SubmitGuard {
  let busy = false;
  return { tryEnter: () => (busy ? false : (busy = true)), leave: () => { busy = false; } };
}
