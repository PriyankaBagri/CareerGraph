import { useEffect, useMemo, useState } from 'react';
import EvidenceCard from '../components/evidence/EvidenceCard';
import EvidenceForm from '../components/evidence/EvidenceForm';
import Skeleton from '../components/ui/Skeleton';
import { useEvidence } from '../hooks/useEvidence';
import { useProfile } from '../hooks/useProfile';
import { careerService } from '../services/career';
import type { CareerDataset, Evidence, EvidenceInput } from '../types';
import { EVIDENCE_TYPES } from '../utils/constants';

export default function EvidencePage() {
  const me = useProfile();
  const { items, error, reload, create, update, remove } = useEvidence();
  const [dataset, setDataset] = useState<CareerDataset | null>(null);
  const [editing, setEditing] = useState<Evidence | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const targetId = me?.profile.targetCareerId;

  useEffect(() => {
    setDataset(null);
    if (!targetId) return;
    let live = true;
    careerService.getDataset(targetId).then((d) => live && setDataset(d)).catch(() => live && setDataset(null));
    return () => { live = false; };
  }, [targetId]);
  const names = useMemo(() => new Map(dataset?.career.capabilities.flatMap((c) => c.skills.map((s) => [s.id, s.name] as const)) ?? []), [dataset]);
  const shown = useMemo(() => (items ?? []).filter((e) => (!type || e.type === type) && (!q || `${e.title} ${e.description}`.toLowerCase().includes(q.toLowerCase()))), [items, q, type]);

  async function save(input: EvidenceInput) {
    if (editing && editing !== 'new') await update(editing.id, input); else await create(input);
    setNotice(editing && editing !== 'new' ? 'Evidence updated. Coverage, readiness and gaps for the skills it supports were recalculated.' : 'Evidence added. Coverage, readiness and gaps for the skills it supports were recalculated.');
    setEditing(null);
  }

  return (
    <div className="animate-rise space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">Evidence library</p><h1 className="text-3xl font-semibold">Proof of your skills</h1>
          <p className="text-mute">Evidence turns “I know this” into “I can show this”. It feeds your readiness score.</p></div>
        <button className="btn" onClick={() => setEditing('new')} disabled={!dataset}>Add evidence</button>
      </header>

      {notice && <p role="status" className="rounded-lg border border-ok p-3 text-sm text-ok">✓ {notice}</p>}
      {error && <div className="card-dark" role="alert"><p className="font-semibold">We couldn't load your evidence right now.</p><button className="btn mt-3" onClick={reload}>Try again</button></div>}
      {!items && !error && <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>}

      {items && (
        <section aria-label="Your evidence" className="space-y-4">
          <h2 className="text-lg font-semibold">Your evidence</h2>
          {items.length > 0 && (
            <div className="flex flex-wrap gap-3">
              <input aria-label="Search evidence" placeholder="Search evidence" value={q} onChange={(e) => setQ(e.target.value)} className="rounded-lg border border-line bg-panel px-3 py-2" />
              <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-line bg-panel px-3 py-2"><option value="">All types</option>{EVIDENCE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </div>
          )}
          {items.length === 0 ? (
            <div className="card-dark"><p className="font-semibold">You haven't added evidence yet.</p><p className="mt-1 text-mute">Add projects, experience, certifications, or other proof of your skills.</p><button className="btn mt-4" onClick={() => setEditing('new')} disabled={!dataset}>Add evidence</button></div>
          ) : shown.length === 0 ? <p className="text-mute">No evidence matches your filters.</p> : (
            <div className="grid gap-4 md:grid-cols-2">{shown.map((e) => <EvidenceCard key={e.id} e={e} skillNames={names} onEdit={() => setEditing(e)} onDelete={async () => { await remove(e.id); setNotice('Evidence deleted. Coverage and readiness were recalculated.'); }} />)}</div>
          )}
        </section>
      )}

      {me?.profile.isDemo && dataset && dataset.evidence.length > 0 && (
        <section aria-label="Demo example evidence" className="space-y-4">
          <h2 className="text-lg font-semibold">Demo example evidence <span className="text-sm font-normal text-mute">(sample data for this profile, read-only)</span></h2>
          <div className="grid gap-4 md:grid-cols-2">{dataset.evidence.map((e) => <EvidenceCard key={e.id} e={e} skillNames={names} />)}</div>
        </section>
      )}

      {editing && dataset && <EvidenceForm initial={editing === 'new' ? undefined : editing} capabilities={dataset.career.capabilities} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}
