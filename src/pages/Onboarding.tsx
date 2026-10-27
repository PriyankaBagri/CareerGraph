import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CareerPreview from '../components/careers/CareerPreview';
import { useAuth } from '../context/AuthContext';
import { careerIntelligenceService } from '../services/careerIntelligence';
import { careerService } from '../services/career';
import { api } from '../services/api';
import { profileService } from '../services/profile';
import type { Career, CareerDataset, CareerSummary, OnboardingState } from '../types';
import { ASSESSMENT_LABELS, EXPERIENCE_LEVELS } from '../utils/constants';

const STEPS = ['Welcome', 'Career', 'Experience', 'Skills', 'Review'];
const pick = 'rounded-xl border p-4 text-left transition hover:border-ember focus-visible:outline-ember';

export default function Onboarding() {
  const { user, completeOnboarding } = useAuth();
  const navigate = useNavigate();
  const legacy = !!user && api.useBackend('profile') && !!profileService.peekLocalProfile(user.id)?.onboardingComplete;
  const [step, setStep] = useState(0);
  const [s, setS] = useState<OnboardingState>({ headline: '', targetCareerId: null, experienceLevel: null, assessments: {} });
  const [careers, setCareers] = useState<CareerSummary[] | null>(null);
  const [dataset, setDataset] = useState<CareerDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [careerInput, setCareerInput] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [gen, setGen] = useState<'idle' | 'busy' | 'preview'>('idle');
  const [preview, setPreview] = useState<Career | null>(null);
  const [careerMsg, setCareerMsg] = useState<string | null>(null);

  useEffect(() => { setError(null); }, [s, step]);
  useEffect(() => { careerService.list().then(setCareers).catch(() => setError('We could not load careers. Refresh to try again.')); }, []);
  useEffect(() => {
    if (!s.targetCareerId) { setDataset(null); return; }
    let live = true;
    setDataset(null);
    careerService.getDataset(s.targetCareerId).then((d) => live && setDataset(d)).catch(() => live && setError('We could not load that career. Try again.'));
    return () => { live = false; };
  }, [s.targetCareerId]);

  const skills = useMemo(() => dataset?.career.capabilities.flatMap((c) => c.skills.map((k) => ({ id: k.id, name: k.name }))) ?? [], [dataset]);
  const career = careers?.find((c) => c.id === s.targetCareerId);
  const norm = (x: string) => x.trim().toLowerCase();
  const typed = careerInput.trim();
  const existing = typed ? careers?.find((c) => norm(c.name) === norm(typed)) : undefined;
  const suggestions = typed ? (careers ?? []).filter((c) => `${c.name} ${c.category}`.toLowerCase().includes(norm(typed)) && c.id !== s.targetCareerId).slice(0, 4) : [];

  // Prefill the career box once from Step 1 when it looks like a short career phrase; always editable.
  useEffect(() => {
    if (step !== 1 || prefilled) return;
    setPrefilled(true);
    const h = s.headline.trim();
    if (h && h.length <= 60 && h.split(/\s+/).length <= 6) setCareerInput(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function chooseCareer(id: string) {
    setS((p) => (p.targetCareerId === id ? p : { ...p, targetCareerId: id, assessments: {} }));
    setGen('idle'); setPreview(null);
  }
  // Same service as Career Explorer: one source of truth for career model generation.
  async function analyze() {
    const problem = careerIntelligenceService.validateInput({ name: typed });
    if (problem) { setCareerMsg(problem); return; }
    if (existing) { chooseCareer(existing.id); setCareerMsg(`Using the existing ${existing.name} career model.`); return; }
    setGen('busy'); setCareerMsg(null);
    try { setPreview(await careerIntelligenceService.generateCareerModel({ name: typed })); setGen('preview'); }
    catch (e) { setGen('idle'); setCareerMsg(e instanceof Error ? e.message : 'We could not analyze that career. Try again, or pick a suggestion below.'); }
  }
  async function useGenerated() {
    if (!preview) return;
    setGen('busy'); setCareerMsg(null);
    try { const saved = await careerService.saveCustomCareer(preview); setCareers(await careerService.list()); chooseCareer(saved.id); }
    catch { setGen('preview'); setCareerMsg('We could not save that career model. Please try again.'); }
  }
  const level = EXPERIENCE_LEVELS.find((l) => l.value === s.experienceLevel);

  function next() {
    let e: string | null = null;
    if (step === 1 && !s.targetCareerId) e = typed ? `Click “Analyze career” to build a model for “${typed}”, or pick a suggestion.` : 'Enter a career, or pick one of the examples, to continue.';
    if (step === 2 && !s.experienceLevel) e = 'Select your experience level to continue.';
    if (step === 3) {
      if (!dataset) e = 'Skills are still loading.';
      else { const m = skills.filter((k) => s.assessments[k.id] === undefined).length; if (m) e = `Rate ${m} more skill${m > 1 ? 's' : ''} to continue.`; }
    }
    setError(e);
    if (!e) setStep(step + 1);
  }
  async function finish() {
    if (!s.targetCareerId || !s.experienceLevel) return;
    setBusy(true); setError(null);
    try {
      await completeOnboarding({ targetCareerId: s.targetCareerId, experienceLevel: s.experienceLevel, headline: s.headline.trim() || undefined, skillAssessments: skills.map((k) => ({ skillId: k.id, currentLevel: s.assessments[k.id] })) });
      navigate('/dashboard', { replace: true });
    } catch { setError('We could not save your profile. Please try again.'); setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <p className="mb-4 text-center text-xl font-semibold">Career<span className="text-ember">Graph</span></p>
      {legacy && <p role="note" className="mb-4 rounded-lg border border-line bg-ink/60 p-3 text-sm text-mute">A profile saved in this browser from an earlier version was found. Your account does not use it automatically. Finish setup here, then open Settings → “Data saved in this browser” to copy it over; you choose what is kept.</p>}
      <div className="mb-1 flex justify-between text-sm text-mute"><span>Step {step + 1} of {STEPS.length}: {STEPS[step]}</span></div>
      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Onboarding progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
        <div className="h-full bg-ember transition-all duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <section className="card animate-rise" aria-live="polite">
        {step === 0 && (<>
          <h1 className="text-2xl font-semibold">Welcome{user ? `, ${user.name.split(' ')[0]}` : ''}</h1>
          <p className="mt-2 text-bark2">Understand where you stand. See what you're missing. Know what to do next.</p>
          <label htmlFor="headline" className="mb-1 mt-6 block text-sm font-medium">Describe yourself in a line (optional)</label>
          <input id="headline" maxLength={120} value={s.headline} onChange={(e) => setS({ ...s, headline: e.target.value })} placeholder="e.g. Final-year student exploring my options" className="w-full rounded-lg border border-sand bg-white px-3 py-2" />
        </>)}
        {step === 1 && (<>
          <h1 className="text-2xl font-semibold">Choose your target career</h1>
          <p className="mt-1 text-bark2">Tell us the career you want to be ready for. You can search for a career or describe it in your own words.</p>
          <form className="mt-4" noValidate onSubmit={(e) => { e.preventDefault(); void analyze(); }}>
            <label htmlFor="career-input" className="mb-1 block text-sm font-medium">Career</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input id="career-input" autoFocus maxLength={80} value={careerInput} placeholder="Search or type a career..." aria-describedby="career-hint"
                onChange={(e) => { setCareerInput(e.target.value); setCareerMsg(null); if (gen === 'preview') { setGen('idle'); setPreview(null); } }}
                className="w-full rounded-lg border-2 border-ember/60 bg-white px-4 py-3 text-lg" />
              <button className="btn whitespace-nowrap" disabled={gen === 'busy'}>{gen === 'busy' ? 'Working…' : existing ? `Use ${existing.name}` : 'Analyze career'}</button>
            </div>
            <p id="career-hint" className="mt-1 text-xs text-bark2">Any career works, for example Fashion Designer, Corporate Lawyer, UPSC Civil Services, Architect or Teacher.</p>
            {careerMsg && <p role="alert" className="mt-2 text-sm text-bad">⚠ {careerMsg}</p>}
          </form>
          {suggestions.length > 0 && <div className="mt-3 flex flex-wrap gap-2" aria-label="Matching careers">{suggestions.map((c) => <button key={c.id} type="button" className="rounded-full border border-sand px-3 py-1 text-sm hover:border-ember" onClick={() => { chooseCareer(c.id); setCareerInput(c.name); setCareerMsg(null); }}>{c.name}</button>)}</div>}
          {gen === 'preview' && preview && (
            <div className="mt-4 rounded-card border border-sand"><CareerPreview career={preview} onRetry={() => { setGen('idle'); setPreview(null); }} activate={<button type="button" className="btn" onClick={() => void useGenerated()}>Use {preview.name}</button>} /></div>
          )}
          {career && <p role="status" className="mt-4 rounded-lg border border-ok p-3 text-sm">✓ Selected target career: <b>{career.name}</b>. Press Continue, or choose a different one.</p>}
          <h2 className="eyebrow mt-6">{careers?.some((c) => c.source !== 'seed') ? 'Popular careers and your models' : 'Popular careers'} · examples, not limits</h2>
          {!careers && <p className="mt-2 text-bark2" role="status">Loading examples…</p>}
          <div role="radiogroup" aria-label="Example careers" className="mt-2 grid gap-3 sm:grid-cols-2">
            {careers?.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={s.targetCareerId === c.id} onClick={() => { chooseCareer(c.id); setCareerInput(c.name); setCareerMsg(null); }}
                className={`${pick} ${s.targetCareerId === c.id ? 'border-ember bg-ember/10' : 'border-sand'}`}>
                <span className="text-xs uppercase tracking-wide text-bark2">{c.category}{c.source !== 'seed' ? ' · your model' : ''}</span>
                <span className="block font-semibold">{s.targetCareerId === c.id ? '✓ ' : ''}{c.name}</span>
                <span className="block text-sm text-bark2">{c.description}</span>
              </button>
            ))}
          </div>
        </>)}
        {step === 2 && (<>
          <h1 className="text-2xl font-semibold">Your experience level</h1>
          <div role="radiogroup" aria-label="Experience level" className="mt-4 grid gap-3 sm:grid-cols-2">
            {EXPERIENCE_LEVELS.map((l) => (
              <button key={l.value} type="button" role="radio" aria-checked={s.experienceLevel === l.value} onClick={() => setS({ ...s, experienceLevel: l.value })} className={`${pick} ${s.experienceLevel === l.value ? 'border-ember bg-ember/10' : 'border-sand'}`}>
                <span className="block font-semibold">{s.experienceLevel === l.value ? '✓ ' : ''}{l.label}</span><span className="text-sm text-bark2">{l.hint}</span>
              </button>
            ))}
          </div>
        </>)}
        {step === 3 && (<>
          <h1 className="text-2xl font-semibold">Rate your current skills</h1>
          <p className="mt-1 text-bark2">For {career?.name}. Be honest: this sets your starting point.</p>
          {!dataset && <p className="mt-4 text-bark2" role="status">Loading skills…</p>}
          {dataset?.career.capabilities.map((c) => (
            <div key={c.id} className="mt-5">
              <h2 className="eyebrow">{c.name}</h2>
              {c.skills.map((k) => (
                <fieldset key={k.id} className="border-t border-sand py-3 first:border-0">
                  <legend className="font-medium">{k.name}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ASSESSMENT_LABELS.map((l, v) => (
                      <label key={l} className="cursor-pointer">
                        <input type="radio" name={k.id} className="peer sr-only" checked={s.assessments[k.id] === v} onChange={() => setS((p) => ({ ...p, assessments: { ...p.assessments, [k.id]: v } }))} />
                        <span className="block rounded-lg border border-sand px-3 py-1.5 text-sm peer-checked:border-ember peer-checked:bg-ember peer-checked:font-semibold peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ember">{l}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          ))}
        </>)}
        {step === 4 && (<>
          <h1 className="text-2xl font-semibold">Your CareerGraph</h1>
          <dl className="mt-4 divide-y divide-sand">
            <div className="flex justify-between gap-4 py-2"><dt className="text-bark2">Target career</dt><dd className="font-semibold">{career?.name}</dd></div>
            <div className="flex justify-between gap-4 py-2"><dt className="text-bark2">Experience</dt><dd className="font-semibold">{level?.label}</dd></div>
            <div className="flex justify-between gap-4 py-2"><dt className="text-bark2">Skills</dt><dd className="font-semibold">{skills.length} skills assessed</dd></div>
            {s.headline.trim() && <div className="flex justify-between gap-4 py-2"><dt className="text-bark2">About you</dt><dd className="text-right">{s.headline}</dd></div>}
          </dl>
        </>)}
        {error && <p role="alert" className="mt-4 text-sm text-bad">⚠ {error}</p>}
        <div className="mt-6 flex justify-between gap-3">
          <button type="button" className="rounded-lg border border-sand px-4 py-2 disabled:invisible" disabled={step === 0 || busy} onClick={() => { setError(null); setStep(step - 1); }}>Back</button>
          {step < 4 ? <button type="button" className="btn" onClick={next}>Continue</button> : <button type="button" className="btn" onClick={finish} disabled={busy}>{busy ? 'Building…' : 'Build my CareerGraph'}</button>}
        </div>
      </section>
    </main>
  );
}
