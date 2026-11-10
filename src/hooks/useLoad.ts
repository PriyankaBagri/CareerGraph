import { useCallback, useEffect, useState } from 'react';

// Loads data once per `deps` change. `error` holds the thrown value (shown through a friendly-message function), `retry` loads again.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setData(null); setError(null);
    load().then((d) => live && setData(d)).catch((e) => live && setError(e ?? new Error('failed')));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tries, enabled]);
  return { data, error, retry: useCallback(() => setTries((n) => n + 1), []) };
}
