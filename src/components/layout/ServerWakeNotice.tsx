import { useSyncExternalStore } from 'react';
import { apiStatus } from '../../services/apiStatus';

// Shown only while a request is slow or being retried (for example a sleeping free-tier server waking up). Nothing is shown otherwise.
export default function ServerWakeNotice() {
  const phase = useSyncExternalStore(apiStatus.subscribe, apiStatus.get, apiStatus.get);
  if (phase === 'idle') return null;
  return (
    <div role="status" aria-live="polite" data-testid="server-wake" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl border border-warn bg-white p-3 text-sm text-bark shadow-lg">
      {phase === 'retrying' ? 'The server did not answer. Trying once more…' : 'Waiting for the server. If it has been idle it can take up to a minute to wake up. Please keep this page open.'}
    </div>
  );
}
