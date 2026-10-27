import { useState } from 'react';
import type { Evidence } from '../../types';
import { STRENGTH_LABEL, STRENGTH_ORDER } from '../../utils/constants';
import { provenanceBadge } from '../../utils/provenance';

interface Props { e: Evidence; skillNames: Map<string, string>; onEdit?: () => void; onDelete?: () => Promise<void> }

export default function EvidenceCard({ e, skillNames, onEdit, onDelete }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const prov = provenanceBadge(e);
  const level = STRENGTH_ORDER.indexOf(e.strength) + 1;
  return (
    <article className="card flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-sand px-2 py-0.5">{e.type}</span>
        <span className={`rounded-full border px-2 py-0.5 ${prov.tone === 'warn' ? 'border-warn text-warn' : prov.tone === 'ok' ? 'border-ok text-ok' : 'border-sand text-bark2'}`} title={prov.detail}>{prov.text}</span>
      </div>
      <h3 className="text-lg font-semibold leading-snug">{e.title}</h3>
      <p className="text-sm text-bark2">{[e.organization, e.date].filter(Boolean).join(' · ')}</p>
      <p className="text-sm">{e.description}</p>
      <p className="text-sm"><span className="text-bark2">Supports: </span>{e.skillIds.map((id) => skillNames.get(id) ?? 'Other-career skill').join(', ') || 'no skills'}</p>
      <p className="text-sm"><span aria-hidden className="text-ember">{'●'.repeat(level)}{'○'.repeat(4 - level)}</span> <b>{STRENGTH_LABEL[e.strength]}</b> evidence</p>
      {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="truncate text-sm text-ember underline">{e.url}</a>}
      {onEdit && onDelete && (
        <div className="mt-1 flex gap-2">
          <button className="rounded-lg border border-sand px-3 py-1 text-sm" onClick={onEdit}>Edit</button>
          {!confirm ? <button className="rounded-lg border border-sand px-3 py-1 text-sm text-bad" onClick={() => setConfirm(true)}>Delete</button> : (
            <>
              <button className="rounded-lg bg-bad px-3 py-1 text-sm text-white disabled:opacity-50" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); } }}>{busy ? 'Deleting…' : 'Confirm delete'}</button>
              <button className="rounded-lg border border-sand px-3 py-1 text-sm" onClick={() => setConfirm(false)}>Cancel</button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
