import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Skeleton from '../components/ui/Skeleton';
import { api, ApiError } from '../services/api';
import { careerIntelligenceService } from '../services/careerIntelligence';
import { careerService } from '../services/career';
import { coreApi, type ApiCareerModel } from '../services/coreApi';
import type { Career } from '../types';
import {
  blankCapability, blankDraft, blankSkill, draftFromCareer, draftFromModel, IMPORTANCE_LABELS, LIMITS, move, newKey, removeAt, removedSkills, replaceAt, summarize,
  TARGET_LEVEL_LABELS, toModelInput, validateDraft, type CareerDraft, type DraftCapability, type DraftErrors, type DraftSkill,
} from '../utils/careerDraft';

const field = 'w-full rounded-lg border border-sand bg-white px-3 py-2 text-bark';
const small = 'rounded-lg border border-sand px-2.5 py-1 text-sm font-medium hover:border-ember disabled:opacity-40';

type Mode = { kind: 'new'; from: string | null } | { kind: 'edit'; id: string };
type Loaded = { draft: CareerDraft; model?: ApiCareerModel; legacyLocal: boolean; readOnlySeed: boolean };

// Create / edit / regenerate / delete a user-owned career. Works for ANY profession: the editor only knows capabilities, skills, target levels and importance.
// Target levels are the author's own definition of what the role needs; CareerGraph does not claim they match any professional standard.
export default function CareerEditor() {
  const params = useParams(); const [search] = useSearchParams(); const navigate = useNavigate();
  const mode: Mode = params.id ? { kind: 'edit', id: params.id } : { kind: 'new', from: search.get('from') };
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<CareerDraft>(blankDraft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: 'remove-skills'; names: string[] } | { kind: 'regenerate' } | { kind: 'delete' }>(null);
  const [regenNote, setRegenNote] = useState<string | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  const modeKey = mode.kind === 'edit' ? `edit:${mode.id}` : `new:${mode.from ?? ''}`;

  useEffect(() => {
    document.title = `${mode.kind === 'edit' ? 'Edit career' : 'Create career'} · CareerGraph`;
    let live = true; setLoaded(null); setLoadError(false); setDirty(false); setErrors({}); setServerError(null);
    (async () => {
      try {
        if (mode.kind === 'edit') {
          const local = careerService.isLocalCustom(mode.id);
          if (api.useBackend('careers') && !local) {
            const model = await coreApi.getCareer(mode.id);
            return { draft: draftFromModel(model), model, legacyLocal: false, readOnlySeed: model.career.source === 'seed' } satisfies Loaded;
          }
          const ds = await careerService.getDataset(mode.id);
          return { draft: draftFromCareer(ds.career, true), legacyLocal: local, readOnlySeed: ds.career.origin?.source === 'seed' } satisfies Loaded;
        }
        if (mode.from) { const ds = await careerService.getDataset(mode.from); return { draft: draftFromCareer(ds.career), legacyLocal: false, readOnlySeed: false } satisfies Loaded; }
        const d = blankDraft(); d.name = search.get('name') ?? ''; return { draft: d, legacyLocal: false, readOnlySeed: false } satisfies Loaded;
      } catch { throw new Error('load'); }
    })().then((l) => { if (live) { setLoaded(l); setDraft(l.draft); } }).catch(() => live && setLoadError(true));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey]);
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);

  const counts = useMemo(() => summarize(draft), [draft]);
  const edit = (next: CareerDraft) => { setDraft(next); setDirty(true); };
  const setCap = (i: number, c: DraftCapability) => edit({ ...draft, capabilities: replaceAt(draft.capabilities, i, c) });
  const setSkill = (i: number, j: number, s: DraftSkill) => setCap(i, { ...draft.capabilities[i], skills: replaceAt(draft.capabilities[i].skills, j, s) });

  async function save(confirmed = false) {
    const found = validateDraft(draft); setErrors(found); setServerError(null);
    if (Object.keys(found).length) { setTimeout(() => summary.current?.focus(), 0); return; }
    const input = toModelInput(draft, loaded?.model);
    const dropped = mode.kind === 'edit' && !loaded?.legacyLocal ? removedSkills(loaded?.model, input) : [];
    if (dropped.length && !confirmed) { setDialog({ kind: 'remove-skills', names: dropped }); return; }
    setDialog(null); setBusy(true);
    try {
      let id: string;
      if (api.useBackend('careers')) {
        const out = mode.kind === 'edit' && !loaded?.legacyLocal ? await coreApi.updateCareer(mode.id, input) : await coreApi.createCareer(input);
        id = out.career.id;
      } else {
        const base = mode.kind === 'edit' ? mode.id : `custom-${Date.now().toString(36)}`;
        const career: Career = {
          id: base, name: input.name, category: input.category, description: input.description, evidenceExpectations: input.evidenceExpectations, origin: { source: 'custom' },
          capabilities: input.capabilities.map((c, i) => ({ id: c.id ?? `${base}:c${i}-${newKey()}`, name: c.name, description: c.description, skills: c.skills.map((s, j) => ({ id: s.id ?? `${base}:s${i}-${j}-${newKey()}`, name: s.name, currentLevel: 0, requiredLevel: s.requiredLevel, evidenceIds: [] })) })),
        };
        id = (await careerService.saveCustomCareer(career)).id;
      }
      setDirty(false);
      navigate(`/career/${encodeURIComponent(id)}`, { state: { saved: mode.kind === 'edit' ? 'updated' : 'created' } });
    } catch (e) {
      setServerError(e instanceof ApiError && e.status === 0 ? 'Could not reach the server. Nothing was saved; please try again.' : e instanceof ApiError && e.status === 404 ? 'This career no longer exists in your account.' : e instanceof ApiError ? `${e.message}${e.fields ? ' ' + Object.values(e.fields).slice(0, 3).join(' ') : ''}` : 'We could not save this career. Nothing was changed; please try again.');
      setTimeout(() => summary.current?.focus(), 0);
    } finally { setBusy(false); }
  }

  async function regenerate() {
    setDialog(null);
    const found = validateDraft({ ...draft, capabilities: [{ key: 'x', name: 'x', description: '', skills: [{ key: 'y', name: 'y', requiredLevel: 3, importance: 3, minEvidence: null }] }] });
    if (found.name || found.category) { setErrors({ ...(found.name ? { name: found.name } : {}), ...(found.category ? { category: found.category } : {}) }); setServerError('Enter a career name and field first; the new structure is generated from them.'); return; }
    setBusy(true); setServerError(null);
    try {
      const generated = await careerIntelligenceService.generateCareerModel({ name: draft.name, field: draft.category, description: draft.description });
      const g = draftFromCareer(generated);
      edit({ ...draft, capabilities: g.capabilities, evidenceExpectations: g.evidenceExpectations });
      setRegenNote('Generated a new starting structure from your career name and description. It is a rule-based draft, not an official standard: review and change anything. Skills whose names match existing ones keep their ratings and evidence links when you save.');
    } catch (e) { setServerError(e instanceof Error ? e.message : 'We could not generate a structure. Your current draft was not changed.'); } finally { setBusy(false); }
  }

  async function remove() {
    if (mode.kind !== 'edit') return;
    setBusy(true);
    try { await careerService.deleteCustomCareer(mode.id); setDirty(false); navigate('/career', { state: { removed: draft.name } }); }
    catch { setServerError('We could not remove that career. Nothing was changed; please try again.'); setDialog(null); } finally { setBusy(false); }
  }

  if (loadError) return <div className="card-dark" role="alert"><p className="font-semibold">We couldn't load that career.</p><div className="mt-3 flex gap-3"><button className="btn" onClick={() => window.location.reload()}>Try again</button><Link to="/career" className="rounded-lg border border-line px-4 py-2">Back to Explorer</Link></div></div>;
  if (!loaded) return <Skeleton className="h-96" />;
  if (loaded.readOnlySeed) return (
    <div className="card-dark space-y-3" role="status"><p className="font-semibold">Catalog careers can't be edited.</p><p className="text-sm text-mute">They are shared starting points. Make your own copy and change it freely.</p>
      <div className="flex gap-3"><Link className="btn" to={`/career/new?from=${encodeURIComponent(params.id ?? '')}`}>Make my own copy</Link><Link to="/career" className="rounded-lg border border-line px-4 py-2">Back to Explorer</Link></div></div>
  );

  const Err = ({ k }: { k: string }): ReactNode => (errors[k] ? <p id={`e-${k}`} role="alert" className="mt-1 text-sm text-bad">⚠ {errors[k]}</p> : null);
  const inv = (k: string) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `e-${k}` : undefined });
  const errorList = Object.entries(errors);
  const title = mode.kind === 'edit' ? 'Edit career' : mode.from ? 'Create from a starting point' : 'Create a career';

  return (
    <form className="animate-rise space-y-6" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} aria-labelledby="ce-h">
      <header>
        <Link to={mode.kind === 'edit' ? `/career/${encodeURIComponent(mode.id)}` : '/career'} className="text-sm text-ember underline">← {mode.kind === 'edit' ? 'Back to career' : 'Career Explorer'}</Link>
        <p className="eyebrow mt-2">Custom career</p>
        <h1 id="ce-h" className="text-3xl font-semibold">{title}</h1>
        <p className="mt-1 max-w-2xl text-mute">Describe any career in your own terms: its capabilities, the skills inside them, and the level you aim for in each. CareerGraph then compares your ratings and evidence against <i>your</i> definition. The target levels are yours; they are not an official standard for the profession.</p>
        {loaded.legacyLocal && <p role="note" className="mt-3 rounded-lg border border-line p-3 text-sm text-mute">This career is saved only in this browser. Saving it here copies it to your account (the browser copy is kept); ratings and evidence tied to the browser-only version are not moved.</p>}
      </header>

      <div ref={summary} tabIndex={-1} className="focus:outline-none">
        {(errorList.length > 0 || serverError) && (
          <div role="alert" className="rounded-xl border border-bad bg-panel p-4 text-[#f3ece3]">
            <p className="font-semibold">{serverError ?? `Fix ${errorList.length} thing${errorList.length > 1 ? 's' : ''} before saving:`}</p>
            {!serverError && <ul className="mt-1 list-disc pl-5 text-sm">{errorList.slice(0, 6).map(([k, m]) => <li key={k}>{m}</li>)}{errorList.length > 6 && <li>…and {errorList.length - 6} more.</li>}</ul>}
          </div>
        )}
        {regenNote && <p role="status" className="mt-3 rounded-lg border border-line p-3 text-sm text-mute">{regenNote}</p>}
      </div>

      <section className="card space-y-4" aria-labelledby="ce-basics">
        <h2 id="ce-basics" className="text-lg font-semibold">About this career</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div><label htmlFor="ce-name" className="mb-1 block text-sm font-medium">Career name</label><input id="ce-name" className={field} maxLength={LIMITS.name} value={draft.name} placeholder="e.g. Corporate Lawyer" onChange={(e) => edit({ ...draft, name: e.target.value })} {...inv('name')} /><Err k="name" /></div>
          <div><label htmlFor="ce-cat" className="mb-1 block text-sm font-medium">Field</label><input id="ce-cat" className={field} maxLength={LIMITS.category} value={draft.category} placeholder="e.g. Law" onChange={(e) => edit({ ...draft, category: e.target.value })} {...inv('category')} /><Err k="category" /></div>
        </div>
        <div><label htmlFor="ce-desc" className="mb-1 block text-sm font-medium">Description <span className="font-normal text-bark2">(optional)</span></label><textarea id="ce-desc" rows={2} className={field} maxLength={LIMITS.description} value={draft.description} onChange={(e) => edit({ ...draft, description: e.target.value })} {...inv('description')} /><Err k="description" /></div>
        <div><label htmlFor="ce-exp" className="mb-1 block text-sm font-medium">Evidence expectations <span className="font-normal text-bark2">(optional, one per line: the kinds of proof that show this career's skills)</span></label>
          <textarea id="ce-exp" rows={3} className={field} value={draft.evidenceExpectations.join('\n')} onChange={(e) => edit({ ...draft, evidenceExpectations: e.target.value.split('\n').slice(0, LIMITS.expectations + 1) })} {...inv('expectations')} /><Err k="expectations" /></div>
      </section>

      <section className="card space-y-3" aria-labelledby="ce-eval">
        <h2 id="ce-eval" className="text-lg font-semibold">How readiness is evaluated <span className="text-sm font-normal text-bark2">(optional)</span></h2>
        <p className="text-sm text-bark2">By default each skill's score is 75% your self-rated level and 25% your evidence. You can change that split for this career. Skill-level “evidence items needed” below is a requirement shown on the skill and in next actions; it does not change the score. These are your own settings, not an official standard.</p>
        <div className="max-w-xs"><label htmlFor="ce-lw" className="mb-1 block text-sm font-medium">Share of a skill's score from your rated level</label>
          <select id="ce-lw" className={field} value={typeof draft.evaluationRules?.levelWeight === 'number' ? String(draft.evaluationRules.levelWeight) : ''} onChange={(e) => { const { levelWeight: _drop, ...rest } = draft.evaluationRules ?? {}; edit({ ...draft, evaluationRules: e.target.value === '' ? (Object.keys(rest).length ? rest : null) : { ...rest, levelWeight: Number(e.target.value) } }); }} {...inv('levelWeight')}>
            <option value="">Default (75% level, 25% evidence)</option>{[0.5, 0.6, 0.7, 0.8, 0.9, 0.95].map((n) => <option key={n} value={String(n)}>{Math.round(n * 100)}% level, {Math.round((1 - n) * 100)}% evidence</option>)}
          </select><Err k="levelWeight" /></div>
      </section>

      <section aria-labelledby="ce-struct" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="ce-struct" className="text-lg font-semibold">Capabilities and skills</h2><p className="text-sm text-mute">{counts.capabilities} capabilit{counts.capabilities === 1 ? 'y' : 'ies'} · {counts.skills} skill{counts.skills === 1 ? '' : 's'} (limits: {LIMITS.capabilities} capabilities, {LIMITS.skillsPerCapability} skills each). A capability is an area of competence; skills are the specific things you can rate and back with evidence.</p></div>
          <button type="button" className="rounded-lg border border-line px-3 py-2 text-sm" disabled={busy} onClick={() => setDialog({ kind: 'regenerate' })}>Regenerate structure…</button>
        </div>
        <Err k="capabilities" />
        {draft.capabilities.map((c, i) => (
          <fieldset key={c.key} className="card space-y-3">
            <legend className="sr-only">Capability {i + 1}</legend>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-[14rem] flex-1"><label htmlFor={`cap-${c.key}`} className="mb-1 block text-sm font-medium">Capability {i + 1}</label><input id={`cap-${c.key}`} className={field} maxLength={LIMITS.itemName} value={c.name} placeholder="e.g. Legal foundations" onChange={(e) => setCap(i, { ...c, name: e.target.value })} {...inv(`cap.${i}.name`)} /><Err k={`cap.${i}.name`} /></div>
              <div className="flex gap-2 pt-6" role="group" aria-label={`Capability ${i + 1} actions`}>
                <button type="button" className={small} aria-label={`Move capability ${i + 1} up`} disabled={i === 0} onClick={() => edit({ ...draft, capabilities: move(draft.capabilities, i, i - 1) })}>↑</button>
                <button type="button" className={small} aria-label={`Move capability ${i + 1} down`} disabled={i === draft.capabilities.length - 1} onClick={() => edit({ ...draft, capabilities: move(draft.capabilities, i, i + 1) })}>↓</button>
                <button type="button" className={`${small} text-bad`} aria-label={`Remove capability ${i + 1}`} disabled={draft.capabilities.length === 1} onClick={() => edit({ ...draft, capabilities: removeAt(draft.capabilities, i) })}>Remove</button>
              </div>
            </div>
            <div><label htmlFor={`capd-${c.key}`} className="mb-1 block text-sm font-medium">What this capability covers <span className="font-normal text-bark2">(optional)</span></label><input id={`capd-${c.key}`} className={field} maxLength={LIMITS.capDescription} value={c.description} onChange={(e) => setCap(i, { ...c, description: e.target.value })} {...inv(`cap.${i}.description`)} /><Err k={`cap.${i}.description`} /></div>
            <Err k={`cap.${i}.skills`} />
            <ul className="space-y-3">
              {c.skills.map((s, j) => (
                <li key={s.key} className="rounded-xl border border-sand p-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_10rem_10rem_9rem_auto] md:items-start">
                    <div><label htmlFor={`sk-${s.key}`} className="mb-1 block text-xs font-medium text-bark2">Skill {j + 1}</label><input id={`sk-${s.key}`} className={field} maxLength={LIMITS.itemName} value={s.name} placeholder="e.g. Legal research" onChange={(e) => setSkill(i, j, { ...s, name: e.target.value })} {...inv(`cap.${i}.skill.${j}.name`)} /><Err k={`cap.${i}.skill.${j}.name`} /></div>
                    <div><label htmlFor={`lv-${s.key}`} className="mb-1 block text-xs font-medium text-bark2">Target level</label><select id={`lv-${s.key}`} className={field} value={s.requiredLevel} onChange={(e) => setSkill(i, j, { ...s, requiredLevel: Number(e.target.value) })} {...inv(`cap.${i}.skill.${j}.level`)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} · {TARGET_LEVEL_LABELS[n]}</option>)}</select><Err k={`cap.${i}.skill.${j}.level`} /></div>
                    <div><label htmlFor={`im-${s.key}`} className="mb-1 block text-xs font-medium text-bark2">Importance</label><select id={`im-${s.key}`} className={field} value={s.importance} onChange={(e) => setSkill(i, j, { ...s, importance: Number(e.target.value) })} {...inv(`cap.${i}.skill.${j}.importance`)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} · {IMPORTANCE_LABELS[n]}</option>)}</select><Err k={`cap.${i}.skill.${j}.importance`} /></div>
                    <div><label htmlFor={`me-${s.key}`} className="mb-1 block text-xs font-medium text-bark2">Evidence items needed</label><input id={`me-${s.key}`} type="number" inputMode="numeric" min={1} max={10} className={field} placeholder="No minimum" value={s.minEvidence ?? ''} onChange={(e) => setSkill(i, j, { ...s, minEvidence: e.target.value === '' ? null : Number(e.target.value) })} {...inv(`cap.${i}.skill.${j}.minEvidence`)} /><Err k={`cap.${i}.skill.${j}.minEvidence`} /></div>
                    <div className="flex gap-2 md:pt-5" role="group" aria-label={`Skill ${j + 1} actions`}>
                      <button type="button" className={small} aria-label={`Move skill ${j + 1} up`} disabled={j === 0} onClick={() => setCap(i, { ...c, skills: move(c.skills, j, j - 1) })}>↑</button>
                      <button type="button" className={small} aria-label={`Move skill ${j + 1} down`} disabled={j === c.skills.length - 1} onClick={() => setCap(i, { ...c, skills: move(c.skills, j, j + 1) })}>↓</button>
                      <button type="button" className={`${small} text-bad`} aria-label={`Remove skill ${j + 1}`} disabled={c.skills.length === 1} onClick={() => setCap(i, { ...c, skills: removeAt(c.skills, j) })}>Remove</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <button type="button" className={small} disabled={c.skills.length >= LIMITS.skillsPerCapability} onClick={() => setCap(i, { ...c, skills: [...c.skills, blankSkill()] })}>+ Add a skill</button>
          </fieldset>
        ))}
        <button type="button" className="rounded-lg border border-line px-4 py-2 text-sm" disabled={draft.capabilities.length >= LIMITS.capabilities} onClick={() => edit({ ...draft, capabilities: [...draft.capabilities, blankCapability()] })}>+ Add a capability</button>
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : mode.kind === 'edit' && !loaded.legacyLocal ? 'Save changes' : 'Create career'}</button>
          <Link to={mode.kind === 'edit' ? `/career/${encodeURIComponent(mode.id)}` : '/career'} className="rounded-lg border border-line px-4 py-2">Cancel</Link>
          {dirty && <span className="text-sm text-mute" role="status">Unsaved changes</span>}
        </div>
        {mode.kind === 'edit' && !loaded.legacyLocal && <button type="button" className="rounded-lg border border-bad px-4 py-2 text-sm font-semibold text-bad" disabled={busy} onClick={() => setDialog({ kind: 'delete' })}>Delete career…</button>}
      </div>

      {dialog?.kind === 'remove-skills' && <ConfirmDialog title="Remove skills from this career?" confirmLabel="Save and remove" busy={busy} onConfirm={() => void save(true)} onCancel={() => setDialog(null)}>
        <p>These skills are no longer in the career: <b>{dialog.names.join(', ')}</b>. Your ratings for them and their evidence links are removed with them. The evidence itself is kept.</p></ConfirmDialog>}
      {dialog?.kind === 'regenerate' && <ConfirmDialog title="Regenerate the structure?" confirmLabel="Regenerate" busy={busy} onConfirm={() => void regenerate()} onCancel={() => setDialog(null)}>
        <p>This replaces the capabilities, skills and evidence expectations in this form with a new rule-based draft built from the name, field and description. Your name, field and description stay. Nothing is saved until you press save, and skills with the same name keep their ratings.</p></ConfirmDialog>}
      {dialog?.kind === 'delete' && <ConfirmDialog title="Delete this career?" confirmLabel="Delete career" busy={busy} onConfirm={() => void remove()} onCancel={() => setDialog(null)}>
        <p>“{draft.name}” and your ratings for its skills are deleted from your account. Evidence you added is kept, and if this was your target career you will need to choose a new one.</p></ConfirmDialog>}
    </form>
  );
}
