import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from '../ui/ConfirmDialog';
import { draftProblems, friendlyDraftError, saveDraft, SOURCE_LABEL, type DraftCapability, type DraftModel, type DraftSkill, type DraftState } from '../../services/careerDraft';

const field = 'w-full rounded-lg border border-sand bg-white px-3 py-2 text-bark';
const LEVELS = ['Aware', 'Basic', 'Working', 'Advanced', 'Expert'];
const blankSkill = (): DraftSkill => ({ name: '', description: '', requiredLevel: 3, importance: 3, evidenceExpectation: '' });

// Editable review of a career draft. NOTHING is saved until the user presses "Save career" and then confirms in the dialog.
export default function CareerDraftReview({ state, onDiscard }: { state: DraftState; onDiscard: () => void }) {
  const nav = useNavigate();
  const [m, setM] = useState<DraftModel>(state.model);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const problems = draftProblems(m);
  const ai = state.source === 'ai';

  const setCap = (i: number, patch: Partial<DraftCapability>) => setM({ ...m, capabilities: m.capabilities.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const setSkill = (i: number, j: number, patch: Partial<DraftSkill>) => setCap(i, { skills: m.capabilities[i].skills.map((s, k) => (k === j ? { ...s, ...patch } : s)) });

  async function save() {
    setBusy(true); setErr(null);
    try { const saved = await saveDraft(m); nav(`/career/${encodeURIComponent(saved.career.id)}`); }
    catch (e) { setErr(e instanceof Error && !('status' in e) ? e.message : friendlyDraftError(e)); setConfirm(false); setBusy(false); }
  }

  return (
    <section className="card animate-rise space-y-4" aria-labelledby="draft-h" data-testid="draft-review" data-source={state.source}>
      <div role="note" data-testid="draft-label" className={`rounded-lg border p-3 text-sm ${ai ? 'border-warn text-warn' : 'border-line text-bark2'}`}>
        <p className="font-semibold">{SOURCE_LABEL[state.source]}</p>
        <p>{ai
          ? `Drafted by ${state.provider?.label ?? 'an AI model'}${state.provider?.model ? ` (${state.provider.model})` : ''}. It can be wrong or incomplete and nobody has verified it. Check every level and description, change what does not fit, then save.`
          : 'This came from a built-in keyword template, not an AI model. It is generic and not tailored to this career, so treat every level as an assumption to edit.'}</p>
        <p className="mt-1">Nothing is saved yet.</p>
      </div>
      <h2 id="draft-h" className="text-xl font-semibold">Review and edit your career model</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium">Career title<input className={`${field} mt-1`} value={m.name} maxLength={120} onChange={(e) => setM({ ...m, name: e.target.value })} /></label>
        <label className="text-sm font-medium">Field<input className={`${field} mt-1`} value={m.category} maxLength={60} onChange={(e) => setM({ ...m, category: e.target.value })} /></label>
        <label className="text-sm font-medium md:col-span-2">Description<textarea rows={2} className={`${field} mt-1`} value={m.description} maxLength={1000} onChange={(e) => setM({ ...m, description: e.target.value })} /></label>
      </div>
      {m.capabilities.map((c, i) => (
        <fieldset key={i} className="rounded-xl border border-line p-3" data-testid="draft-capability">
          <legend className="px-1 text-sm font-semibold">Capability {i + 1}</legend>
          <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
            <input aria-label={`Capability ${i + 1} name`} className={field} value={c.name} maxLength={100} onChange={(e) => setCap(i, { name: e.target.value })} />
            <input aria-label={`Capability ${i + 1} description`} className={field} value={c.description} maxLength={300} onChange={(e) => setCap(i, { description: e.target.value })} />
            <button type="button" className="rounded-lg border border-sand px-3 py-2 text-sm" onClick={() => setM({ ...m, capabilities: m.capabilities.filter((_, k) => k !== i) })}>Remove capability</button>
          </div>
          <ul className="mt-3 space-y-3">
            {c.skills.map((s, j) => (
              <li key={j} className="rounded-lg border border-line p-3" data-testid="draft-skill">
                <div className="grid gap-2 md:grid-cols-[2fr_1fr_auto]">
                  <input aria-label={`Skill ${j + 1} name in capability ${i + 1}`} className={field} value={s.name} maxLength={100} onChange={(e) => setSkill(i, j, { name: e.target.value })} />
                  <select aria-label={`Required level for ${s.name || `skill ${j + 1}`}`} className={field} value={s.requiredLevel} onChange={(e) => setSkill(i, j, { requiredLevel: Number(e.target.value) })}>
                    {LEVELS.map((l, k) => <option key={l} value={k + 1}>{k + 1} · {l}</option>)}
                  </select>
                  <button type="button" className="rounded-lg border border-sand px-3 py-2 text-sm" onClick={() => setCap(i, { skills: c.skills.filter((_, k) => k !== j) })}>Remove skill</button>
                </div>
                <textarea aria-label={`What ${s.name || 'this skill'} means`} rows={2} placeholder="What this skill means, in plain words" className={`${field} mt-2`} value={s.description} maxLength={300} onChange={(e) => setSkill(i, j, { description: e.target.value })} />
                <input aria-label={`Evidence that shows ${s.name || 'this skill'}`} placeholder="What evidence would show this skill (a project, a deliverable…)" className={`${field} mt-2`} value={s.evidenceExpectation} maxLength={200} onChange={(e) => setSkill(i, j, { evidenceExpectation: e.target.value })} />
              </li>
            ))}
          </ul>
          <button type="button" className="mt-3 rounded-lg border border-sand px-3 py-2 text-sm" onClick={() => setCap(i, { skills: [...c.skills, blankSkill()] })}>Add a skill</button>
        </fieldset>
      ))}
      <button type="button" className="rounded-lg border border-sand px-3 py-2 text-sm" onClick={() => setM({ ...m, capabilities: [...m.capabilities, { name: '', description: '', skills: [blankSkill()] }] })}>Add a capability</button>
      <p className="text-xs text-mute">Saved with each skill: its name, required level and description. Each skill's evidence note is stored inside its description (labelled “Evidence to show”).</p>
      {problems.length > 0 && <ul role="alert" data-testid="draft-problems" className="list-disc rounded-lg border border-bad p-3 pl-7 text-sm text-bad">{problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul>}
      {err && <p role="alert" className="rounded-lg border border-bad p-3 text-sm text-bad">⚠ {err}</p>}
      <div className="flex flex-wrap gap-3">
        <button className="btn" disabled={problems.length > 0 || busy} onClick={() => setConfirm(true)}>Save career…</button>
        <button className="rounded-lg border border-sand px-4 py-2" onClick={onDiscard} disabled={busy}>Discard draft</button>
      </div>
      {confirm && (
        <ConfirmDialog title="Save this career model?" confirmLabel="Yes, save career" busy={busy} onConfirm={() => void save()} onCancel={() => setConfirm(false)}>
          <p>“{m.name.trim()}” will be saved to your account with {m.capabilities.length} capabilities and {m.capabilities.reduce((n, c) => n + c.skills.length, 0)} skills. {ai ? 'It was drafted by AI and has not been verified.' : 'It came from a generic template.'} You can edit it later.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
