import { useRef, useState, type FormEvent } from 'react';
import { createSubmitGuard } from '../../utils/submitGuard';
import { saveErrors } from '../../utils/apiErrors';
import type { Capability, Evidence, EvidenceInput, EvidenceStrength, EvidenceType } from '../../types';
import { EVIDENCE_TYPES, STRENGTH_LEVELS } from '../../utils/constants';

interface Props { initial?: Evidence; presetSkillIds?: string[]; capabilities: Capability[]; onClose: () => void; onSave: (input: EvidenceInput) => Promise<void> }
const field = 'w-full rounded-lg border bg-white px-3 py-2 text-bark';

export default function EvidenceForm({ initial, presetSkillIds, capabilities, onClose, onSave }: Props) {
  const optionIds = new Set(capabilities.flatMap((c) => c.skills.map((s) => s.id)));
  const [f, setF] = useState({ title: initial?.title ?? '', description: initial?.description ?? '', type: (initial?.type ?? 'Project') as EvidenceType, url: initial?.url ?? '', date: initial?.date ?? '', organization: initial?.organization ?? '', strength: (initial?.strength ?? 'moderate') as EvidenceStrength });
  const [skills, setSkills] = useState<string[]>((initial?.skillIds ?? presetSkillIds ?? []).filter((id) => optionIds.has(id)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const guard = useRef(createSubmitGuard());
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return; // a second Enter/click while saving must not create a duplicate record
    const er: Record<string, string> = {};
    if (!f.title.trim()) er.title = 'Give this evidence a title.';
    if (!f.description.trim()) er.description = 'Describe what you did and the outcome.';
    if (f.url.trim() && !/^https?:\/\/\S+\.\S+/.test(f.url.trim())) er.url = 'Enter a full link starting with http:// or https://.';
    if (!skills.length) er.skills = 'Select at least one skill this evidence supports.';
    setErrors(er);
    if (Object.keys(er).length) return;
    if (!guard.current.tryEnter()) return;
    setBusy(true);
    const kept = (initial?.skillIds ?? []).filter((id) => !optionIds.has(id));
    try {
      await onSave({ title: f.title.trim(), description: f.description.trim(), type: f.type, strength: f.strength, url: f.url.trim() || undefined, date: f.date || undefined, organization: f.organization.trim() || undefined, skillIds: [...skills, ...kept] });
    } catch (err) { setErrors(saveErrors(err)); setBusy(false); guard.current.leave(); }
  }
  const Err = ({ k }: { k: string }) => errors[k] ? <p role="alert" className="mt-1 text-sm text-bad">⚠ {errors[k]}</p> : null;
  const meaning = STRENGTH_LEVELS.find((l) => l.value === f.strength)?.meaning;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/70" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="flex min-h-full items-start justify-center p-3 sm:items-center sm:p-4"><div role="dialog" aria-modal="true" aria-labelledby="ev-form-h" className="card w-full max-w-xl animate-rise">
        <h2 id="ev-form-h" className="text-xl font-semibold">{initial ? 'Edit evidence' : 'Add evidence'}</h2>
        <p className="mt-1 text-sm text-bark2">Add a project, certificate or experience to show what you can do. Fields marked * are required.</p>
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          {errors.form && <p role="alert" className="rounded-lg border border-bad bg-bad/10 p-3 text-sm text-bad">⚠ {errors.form}</p>}
          <div><label htmlFor="ev-title" className="mb-1 block text-sm font-medium">What did you do? (title) *</label><input id="ev-title" autoFocus className={`${field} ${errors.title ? 'border-bad' : 'border-sand'}`} value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={120} /><Err k="title" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="ev-type" className="mb-1 block text-sm font-medium">Type</label><select id="ev-type" className={`${field} border-sand`} value={f.type} onChange={(e) => set('type', e.target.value)}>{EVIDENCE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label htmlFor="ev-date" className="mb-1 block text-sm font-medium">Date (optional)</label><input id="ev-date" type="date" className={`${field} border-sand`} value={f.date} onChange={(e) => set('date', e.target.value)} /></div>
          </div>
          <div><label htmlFor="ev-desc" className="mb-1 block text-sm font-medium">What did it show? *</label><textarea id="ev-desc" rows={3} className={`${field} ${errors.description ? 'border-bad' : 'border-sand'}`} value={f.description} onChange={(e) => set('description', e.target.value)} /><Err k="description" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="ev-org" className="mb-1 block text-sm font-medium">Organization (optional)</label><input id="ev-org" className={`${field} border-sand`} value={f.organization} onChange={(e) => set('organization', e.target.value)} /></div>
            <div><label htmlFor="ev-url" className="mb-1 block text-sm font-medium">Link (optional)</label><input id="ev-url" inputMode="url" className={`${field} ${errors.url ? 'border-bad' : 'border-sand'}`} value={f.url} onChange={(e) => set('url', e.target.value)} /><Err k="url" /></div>
          </div>
          <div><label htmlFor="ev-str" className="mb-1 block text-sm font-medium">How strong is it? *</label><select id="ev-str" className={`${field} border-sand`} value={f.strength} onChange={(e) => set('strength', e.target.value)}>{STRENGTH_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select><p className="mt-1 text-xs text-bark2">{meaning} This is CareerGraph's own quality scale, not an objective rating.</p></div>
          <fieldset><legend className="mb-1 text-sm font-medium">Which skills does it support? * <span className="font-normal text-bark2">(pick at least one)</span></legend>
            {capabilities.map((c) => (
              <div key={c.id} className="mt-2"><p className="text-xs uppercase tracking-wide text-bark2">{c.name}</p>
                <div className="mt-1 flex flex-wrap gap-2">{c.skills.map((s) => (
                  <label key={s.id} className="cursor-pointer"><input type="checkbox" className="peer sr-only" checked={skills.includes(s.id)} onChange={() => setSkills((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))} />
                    <span className="block rounded-lg border border-sand px-3 py-1 text-sm peer-checked:border-ember peer-checked:bg-ember peer-checked:font-semibold peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ember">{skills.includes(s.id) ? '✓ ' : ''}{s.name}</span></label>
                ))}</div></div>
            ))}
            <Err k="skills" />
          </fieldset>
          <div className="sticky bottom-0 -mx-1 flex justify-end gap-3 bg-panel px-1 py-2">
            <button type="button" className="rounded-lg border border-sand px-4 py-2" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Add evidence'}</button>
          </div>
        </form>
      </div>
    </div>
    </div>
  );
}
