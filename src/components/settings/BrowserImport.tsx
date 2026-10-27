import { useState } from 'react';
import ConfirmDialog from '../ui/ConfirmDialog';
import { hasAnything, hasConflicts, type PendingImport, type Resolutions } from '../../services/browserData';
import type { Choice } from '../../services/reconcile';

interface Props { pending: PendingImport; busy: boolean; onImport: (choices: Resolutions) => void; open: boolean; setOpen: (v: boolean) => void }

// Explicit, user-controlled reconciliation of data saved in this browser with the signed-in account. Conflicts are listed with BOTH values and
// default to keeping the account's version; nothing is changed until the user confirms.
export default function BrowserImport({ pending, busy, onImport, open, setOpen }: Props) {
  const [choices, setChoices] = useState<Resolutions>({});
  if (!hasAnything(pending)) return null;
  const set = (k: keyof Resolutions, v: Choice) => setChoices((c) => ({ ...c, [k]: v }));
  const fills = (pending.profile?.fillLabels.length ?? 0) + pending.progress.reduce((n, x) => n + x.fill.length, 0) + Object.keys(pending.settings.fill).length;
  const Group = ({ k, title, rows }: { k: keyof Resolutions; title: string; rows: { key: string; label: string; browser: string; account: string }[] }) => rows.length === 0 ? null : (
    <fieldset className="mt-3 rounded-lg border border-line p-3">
      <legend className="px-1 text-sm font-semibold">{title}: your account and this browser differ</legend>
      <ul className="mb-2 space-y-1 text-sm text-bark2">{rows.map((r) => <li key={r.key}><span className="font-medium text-bark">{r.label}</span> — account: “{r.account}”, this browser: “{r.browser}”</li>)}</ul>
      <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="radio" name={`c-${k}`} checked={(choices[k] ?? 'server') === 'server'} onChange={() => set(k, 'server')} /> Keep my account’s version (recommended)</label>
      <label className="inline-flex items-center gap-2 text-sm"><input type="radio" name={`c-${k}`} checked={choices[k] === 'browser'} onChange={() => set(k, 'browser')} /> Use this browser’s version</label>
    </fieldset>
  );
  return (
    <>
      <section className="card" aria-labelledby="imp-h">
        <h2 id="imp-h" className="text-lg font-semibold">Data saved in this browser</h2>
        <p className="text-sm text-bark2">
          This browser holds data that is not in your account yet: {pending.ratings.length} skill rating(s), {pending.evidence.length} evidence item(s), {pending.careers.length} custom career(s)
          {fills > 0 ? `, and ${fills} profile, progress or setting value(s)` : ''}. You decide what happens. Nothing is deleted from this browser, nothing is duplicated, and your account’s existing values are only replaced where you choose “Use this browser’s version” below.
          (Ratings and evidence tied to a browser-only custom career cannot be moved; the career itself is copied.)
        </p>
        <Group k="profile" title="Profile" rows={(pending.profile?.conflicts ?? []).map((c) => ({ key: c.field, ...c }))} />
        <Group k="progress" title="Action progress" rows={pending.progress.flatMap((d) => d.conflicts.map((c) => ({ key: `${d.careerId}:${c.actionId}`, label: c.title, browser: c.browser.replace('_', ' '), account: c.account.replace('_', ' ') })))} />
        <Group k="settings" title="Settings" rows={pending.settings.conflicts.map((c) => ({ key: c.field, ...c }))} />
        <button className="btn mt-3" onClick={() => setOpen(true)}>{hasConflicts(pending) ? 'Review and copy…' : 'Copy to my account…'}</button>
      </section>
      {open && <ConfirmDialog title="Copy browser data to your account?" confirmLabel="Copy data" busy={busy} onConfirm={() => onImport(choices)} onCancel={() => setOpen(false)}>
        <p>Copies the items above that your account does not have. Your browser copy is kept. Anything your account already has is skipped unless you chose the browser’s version for it. If something fails, the rest is still copied and you can run this again safely.</p>
      </ConfirmDialog>}
    </>
  );
}
