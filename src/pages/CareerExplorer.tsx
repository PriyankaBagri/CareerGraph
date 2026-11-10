import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import CareerDraftReview from '../components/careers/CareerDraftReview';
import CareerPreview from '../components/careers/CareerPreview';
import SetTargetButton from '../components/careers/SetTargetButton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Skeleton from '../components/ui/Skeleton';
import { useProfile } from '../hooks/useProfile';
import { careerIntelligenceService } from '../services/careerIntelligence';
import { careerService } from '../services/career';
import { friendlyDraftError, requestAiDraft, templateDraft, type DraftState } from '../services/careerDraft';
import { api } from '../services/api';
import { CAREER_DIRECTORY } from '../data/careerDirectory';
import type { Career, CareerSummary } from '../types';

const field = 'w-full rounded-lg border border-sand bg-white px-3 py-2 text-bark';

export default function CareerExplorer() {
  const me = useProfile();
  const flash = (useLocation().state as { removed?: string } | null)?.removed;
  const [careers, setCareers] = useState<CareerSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [fieldFilter, setFieldFilter] = useState('');
  const [form, setForm] = useState({ name: '', field: '', description: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'form' | 'busy' | 'preview'>('form');
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const serverDrafts = api.useBackend('careers');
  const [preview, setPreview] = useState<Career | null>(null);
  const [dup, setDup] = useState<CareerSummary | null>(null);
  const [removing, setRemoving] = useState<CareerSummary | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeMsg, setRemoveMsg] = useState<string | null>(null);

  useEffect(() => { document.title = 'Career Explorer · CareerGraph'; setError(false); careerService.list().then(setCareers).catch(() => setError(true)); }, [tick]);
  const fields = [...new Set((careers ?? []).map((c) => c.category).filter(Boolean))].sort((x, y) => x.localeCompare(y));
  const match = (c: CareerSummary) => (!fieldFilter || c.category === fieldFilter) && (!q || `${c.name} ${c.category} ${c.description}`.toLowerCase().includes(q.toLowerCase()));
  const mine = careers?.filter((c) => c.source !== 'seed' && match(c)) ?? [];
  const known = new Set((careers ?? []).map((c) => c.name.trim().toLowerCase()));
  const ideas = Object.entries(CAREER_DIRECTORY).map(([f, names]) => [f, names.filter((n) => !known.has(n.toLowerCase()) && (!fieldFilter || fieldFilter === f) && (!q || `${n} ${f}`.toLowerCase().includes(q.toLowerCase())))] as const).filter(([, names]) => names.length > 0);
  const startIdea = (name: string, f: string) => { setForm({ name, field: f, description: '' }); setFormError(null); setPhase('form'); document.getElementById('any-h')?.scrollIntoView({ behavior: 'smooth' }); };
  const catalog = careers?.filter((c) => c.source === 'seed' && match(c)) ?? [];

  async function analyze(force = false, nameOverride?: string) {
    const input = nameOverride ? { ...form, name: nameOverride } : form;
    const problem = careerIntelligenceService.validateInput(input);
    setFormError(problem);
    if (problem) return;
    const existing = careers?.find((c) => c.name.toLowerCase() === input.name.trim().toLowerCase());
    if (existing && !force) { setDup(existing); return; }
    setDup(null); setPhase('busy');
    try { setPreview(await careerIntelligenceService.generateCareerModel(input)); setPhase('preview'); }
    catch (e) { setFormError(e instanceof Error ? e.message : 'We could not create that career model.'); setPhase('form'); }
  }

  // Backend mode: both the AI draft and the template go to the same editable review screen. The template is used only when the user asks for it.
  async function makeDraft(kind: 'ai' | 'template') {
    const problem = careerIntelligenceService.validateInput(form);
    setFormError(problem); setDraftError(null);
    if (problem) return;
    setPhase('busy');
    try { setDraft(kind === 'ai' ? await requestAiDraft({ name: form.name.trim(), category: form.field.trim(), description: form.description.trim() }) : await templateDraft({ name: form.name.trim(), category: form.field.trim(), description: form.description.trim() })); }
    catch (e) { setDraftError(kind === 'ai' ? friendlyDraftError(e) : e instanceof Error ? e.message : 'We could not create that career model.'); }
    setPhase('form');
  }

  async function removeCareer() {
    if (!removing) return;
    setRemoveBusy(true); setRemoveMsg(null);
    try { await careerService.deleteCustomCareer(removing.id); setRemoveMsg(`Removed “${removing.name}”. Your evidence was kept.`); setRemoving(null); setTick((t) => t + 1); }
    catch { setRemoveMsg('We could not remove that career. Nothing was changed; please try again.'); setRemoving(null); } finally { setRemoveBusy(false); }
  }
  const Card = ({ c }: { c: CareerSummary }) => (
    <article className="card flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-sand px-2 py-0.5">{c.category}</span>
        <span className="rounded-full border border-sand px-2 py-0.5">{c.source === 'seed' ? 'Demo career' : 'Your model'}</span>
        {me?.profile.targetCareerId === c.id && <span className="rounded-full border border-ok px-2 py-0.5 text-ok">✓ Current target</span>}
      </div>
      <h3 className="text-lg font-semibold">{c.name}</h3>
      <p className="text-sm text-bark2">{c.description}</p>
      <div className="mt-1 flex flex-wrap gap-4 text-sm font-semibold"><Link to={`/career/${encodeURIComponent(c.id)}`} className="text-ember underline">View details</Link><Link to={`/compare?b=${encodeURIComponent(c.id)}`} className="text-ember underline">Compare</Link>{c.source === 'seed' ? <Link to={`/career/new?from=${encodeURIComponent(c.id)}`} className="text-ember underline">Use as a template</Link> : <Link to={`/career/${encodeURIComponent(c.id)}/edit`} className="text-ember underline">Edit</Link>}{c.source !== 'seed' && (me?.profile.targetCareerId === c.id ? <span className="text-xs font-normal text-mute">Change your target before removing</span> : <button type="button" className="font-normal text-bad underline" onClick={() => setRemoving(c)}>Remove</button>)}</div>
    </article>
  );

  return (
    <div className="animate-rise space-y-8">
      {flash && !removeMsg && <p role="status" className="rounded-lg border border-line p-3 text-sm">Removed “{flash}”. Your evidence was kept.</p>}
      {removeMsg && <p role="status" className="rounded-lg border border-line p-3 text-sm">{removeMsg}</p>}
      {removing && <ConfirmDialog title="Remove this career?" confirmLabel="Remove career" busy={removeBusy} onConfirm={() => void removeCareer()} onCancel={() => setRemoving(null)}><p>“{removing.name}” and the skill ratings you gave for its skills will be deleted. Your evidence is kept, but its links to this career's skills are removed.</p></ConfirmDialog>}
      <header>
        <p className="eyebrow">Career explorer</p>
        <h1 className="text-3xl font-semibold">Explore careers</h1>
        <p className="mt-1 max-w-2xl text-mute">See how your skills fit each career. Browsing never changes your target.</p>
        <div className="mt-4 flex flex-wrap gap-3"><Link to="/career/new" className="btn">Create your own career</Link><span className="self-center text-sm text-mute">Build a career from scratch.</span></div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Filter by field" value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)} className="rounded-lg border border-line bg-panel px-3 py-3 text-white"><option value="">All fields</option>{fields.map((f) => <option key={f} value={f}>{f}</option>)}</select>
        <input aria-label="Search or type any career" placeholder="Search or type any career..." value={q} onChange={(e) => setQ(e.target.value)} className="w-full max-w-md rounded-lg border-2 border-ember/50 bg-panel px-4 py-3 text-lg" />
        {q.trim() && !careers?.some((c) => c.name.toLowerCase() === q.trim().toLowerCase()) && <button className="btn" disabled={phase === 'busy'} onClick={() => { setForm((f) => ({ ...f, name: q.trim() })); void analyze(false, q.trim()); }}>Analyze career “{q.trim()}”</button>}
      </div>


      <section className="card-dark" aria-labelledby="any-h">
        <h2 id="any-h" className="text-xl font-semibold">Start any career</h2>
        {serverDrafts && draft && <div className="mt-4"><CareerDraftReview key={draft.source + draft.model.name} state={draft} onDiscard={() => setDraft(null)} /></div>}
        {phase !== 'preview' && !(serverDrafts && draft) && (
          <form className="mt-4 grid gap-4 md:grid-cols-2" noValidate onSubmit={(e) => { e.preventDefault(); if (serverDrafts) void makeDraft('ai'); else void analyze(); }}>
            <div><label htmlFor="cn" className="mb-1 block text-sm font-medium">Career name</label><input id="cn" className={field} value={form.name} placeholder="e.g. Corporate Lawyer" maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!formError} aria-describedby={formError ? 'cn-err' : undefined} />
              {formError && <p id="cn-err" role="alert" className="mt-1 text-sm text-bad">⚠ {formError}</p>}</div>
            <div><label htmlFor="cf" className="mb-1 block text-sm font-medium">Field (optional)</label><input id="cf" className={field} value={form.field} placeholder="e.g. Law" maxLength={60} onChange={(e) => setForm({ ...form, field: e.target.value })} /></div>
            <div className="md:col-span-2"><label htmlFor="cd" className="mb-1 block text-sm font-medium">Description (optional)</label><textarea id="cd" rows={2} className={field} value={form.description} placeholder="What do you want to do, and where?" maxLength={300} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="md:col-span-2 space-y-3">
              {draftError && <p role="alert" data-testid="draft-error" className="rounded-lg border border-bad p-3 text-sm text-bad">⚠ {draftError}</p>}
              {serverDrafts ? (
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn" disabled={phase === 'busy'}>{phase === 'busy' ? 'Drafting…' : 'Draft with AI'}</button>
                  <button type="button" className="rounded-lg border border-sand px-4 py-2" disabled={phase === 'busy'} onClick={() => void makeDraft('template')}>Use the template instead (not AI)</button>
                  <span className="text-xs text-mute">The AI draft is unverified and is never saved until you review it and confirm.</span>
                </div>
              ) : <button className="btn" disabled={phase === 'busy'}>{phase === 'busy' ? 'Analyzing career…' : 'Analyze Career'}</button>}
            </div>
          </form>
        )}
        {dup && (
          <div role="status" className="mt-4 rounded-xl border border-line p-4 text-sm">
            <p><b>{dup.name}</b> already exists {dup.source === 'seed' ? 'in the catalog' : 'in your career models'}.</p>
            <div className="mt-2 flex flex-wrap gap-3"><Link to={`/career/${encodeURIComponent(dup.id)}`} className="btn">Open existing</Link>{dup.source !== 'seed' && <button className="rounded-lg border border-line px-4 py-2" onClick={() => void analyze(true)}>Regenerate</button>}<button className="px-2 underline" onClick={() => setDup(null)}>Dismiss</button></div>
          </div>
        )}
        {phase === 'preview' && preview && (
          <div className="mt-4"><CareerPreview career={preview} onRetry={() => { setPhase('form'); setPreview(null); }} activate={<SetTargetButton careerId={preview.id} careerName={preview.name} label="Use this career" beforeActivate={async () => (await careerService.saveCustomCareer(preview)).id} onDone={() => setTick((t) => t + 1)} />} /></div>
        )}
      </section>

      {error && <div className="card-dark" role="alert"><p className="font-semibold">We couldn't load careers right now.</p><button className="btn mt-3" onClick={() => setTick((t) => t + 1)}>Try again</button></div>}
      {!careers && !error && <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>}
      {careers && mine.length > 0 && <section aria-label="Your career models" className="space-y-3"><h2 className="text-lg font-semibold">Your career models</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{mine.map((c) => <Card key={c.id} c={c} />)}</div></section>}
      {careers && (
        <section aria-label="Explore careers" className="space-y-3"><h2 className="text-lg font-semibold">Careers with a ready skills model</h2>
          {catalog.length === 0 ? (
            <div className="card-dark"><p>No saved career matches your search.</p>{q.trim() && <button className="btn mt-3" onClick={() => { setForm({ ...form, name: q.trim() }); setQ(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Analyze “{q.trim()}”</button>}</div>
          ) : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{catalog.map((c) => <Card key={c.id} c={c} />)}</div>}
        </section>
      )}
      {careers && ideas.length > 0 && (
        <section aria-label="More careers to try" className="space-y-3">
          <h2 className="text-lg font-semibold">More careers to try <span className="text-sm font-normal text-mute">· no skills model yet, we draft one for you to review</span></h2>
          <div className="space-y-3">
            {ideas.map(([f, names]) => (
              <div key={f}><p className="mb-1 text-sm text-mute">{f}</p><ul className="flex flex-wrap gap-2">{names.map((n) => <li key={n}><button className="btn-quiet" onClick={() => startIdea(n, f)}>{n}</button></li>)}</ul></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
