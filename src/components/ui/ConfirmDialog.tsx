import type { ReactNode } from 'react';

interface Props { title: string; children: ReactNode; confirmLabel: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }

export default function ConfirmDialog({ title, children, confirmLabel, busy = false, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cd-h" aria-describedby="cd-b" className="card w-full max-w-md animate-rise">
        <h2 id="cd-h" className="text-xl font-semibold">{title}</h2>
        <div id="cd-b" className="mt-2 text-sm text-bark2">{children}</div>
        <div className="mt-5 flex justify-end gap-3">
          <button autoFocus className="rounded-lg border border-sand px-4 py-2" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn" onClick={onConfirm} disabled={busy}>{busy ? 'Changing…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
