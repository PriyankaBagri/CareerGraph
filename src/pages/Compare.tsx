import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SetTargetButton from '../components/careers/SetTargetButton';
import Skeleton from '../components/ui/Skeleton';
import { useCareerAnalysis } from '../hooks/useCareerAnalysis';
import { useProfile } from '../hooks/useProfile';
import { careerService } from '../services/career';
import type { CareerSummary, SkillAnalysis } from '../types';
import { compareCareers, type CareerSide } from '../utils/compare';
import { LEVELS } from '../utils/readiness';

const sel = 'w-full rounded-lg border border-line bg-panel px-3 py-2 text-white';
const names = (l: SkillAnalysis[]) => (l.length ? l.map((s) => s.name).join(', ') : 'None');

function Two({ title, hint, a, b, nameA, nameB }: { title: string; hint?: string; a: ReactNode; b: ReactNode; nameA: string; nameB: string }) {
  return (
    <section className="card" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>{hint && <p className="text-sm text-bark2">{hint}</p>}
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-sand p-4"><h3 className="eyebrow mb-2">{nameA}</h3><div className="space-y-2 text-sm">{a}</div></div>
        <div className="rounded-xl border border-sand p-4"><h3 className="eyebrow mb-2">{nameB}</h3><div className="space-y-2 text-sm">{b}</div></div>
      </div>
    </section>
  );
}

export default function Compare() {
  const me = useProfile();
  const [params, setParams] = useSearchParams();
  const [careers, setCareers] = useState<CareerSummary[]>([]);
  useEffect(() => { document.title = 'Compare careers · CareerGraph'; careerService.list().then(setCareers).catch(() => {}); }, []);
  const target = me?.profile.targetCareerId ?? '';
  const a = params.get('a') ?? target;
  const b = params.get('b') ?? '';
  const same = !!a && a === b;
  const A = useCareerAnalysis(a);
  const B = useCareerAnalysis(same ? '' : b);
  const comp = useMemo(() => (A.view && B.view && !same ? compareCareers(A.view, B.view) : null), [A.view, B.view, same]);
  const setSel = (k: 'a' | 'b', v: string) => { const n = new URLSearchParams(params); n.set(k, v); setParams(n, { replace: true }); };
  const targetName = careers.find((c) => c.id === target)?.name ?? 'your current target career';
  const loading = !!a && !!b && !same && !comp && !A.error && !B.error;

  const side = (s: CareerSide) => ({
    overview: <><p>{s.career.description}</p><p><b>Capabilities:</b> {s.career.capabilities.map((c) => c.name).join(', ')}</p><p><b>Evidence expectations:</b> {s.career.evidenceExpectations?.join('; ') || 'Some career information is still being developed.'}</p></>,
    readiness: s.assessment.state === 'not_assessed' ? <><p className="text-xl font-bold">Not assessed</p><p>{s.assessment.assessed} of {s.assessment.total} skills rated. Make this your target career, or open its skills, to rate them and see a score.</p></> : <><p className="text-2xl font-bold">{s.overall}%</p>{s.assessment.state === 'partial' && <p className="text-bark2">Based on {s.assessment.assessed} of {s.assessment.total} rated skills.</p>}{s.metrics.map((m) => <p key={m.key}>{m.label}: <b>{m.value}%</b></p>)}<ul className="list-disc pl-5">{s.reasons.map((r, i) => <li key={i}>{r.text}</li>)}</ul></>,
    gaps: <>{s.notAssessed.length > 0 && <p><b>Not assessed:</b> {s.notAssessed.length} of {s.totalSkills} skills</p>}<p><b>Skill gaps:</b> {names(s.skillGaps)}</p><p><b>Evidence gaps:</b> {names(s.evidenceGaps)}</p><p><b>Skill + evidence gaps:</b> {names(s.combinedGaps)}</p><p><b>Already on track:</b> {names(s.onTrack)}</p><p className="text-bark2">{s.skillsWithEvidence} of {s.totalSkills} skills have supporting evidence.</p></>,
    actions: s.previewActions.length ? <ul className="space-y-2">{s.previewActions.map((x) => <li key={x.id}><b>{x.title}</b> <span className="text-bark2">· {x.priority} priority</span></li>)}</ul> : <p>No gaps in this model: nothing to plan right now.</p>,
  });

  return (
    <div className="animate-rise space-y-6">
      <header><p className="eyebrow">Compare careers</p><h1 className="text-3xl font-semibold">Career comparison</h1>
        <p className="max-w-2xl text-mute">See the factual differences between two career models and how your current skills and evidence relate to each. CareerGraph does not score or order careers; the decision is yours.</p></header>

      <div className="grid gap-4 md:grid-cols-2">
        <div><label htmlFor="ca" className="mb-1 block text-sm text-mute">Career A</label><select id="ca" className={sel} value={a} onChange={(e) => setSel('a', e.target.value)}><option value="">Select a career</option>{careers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label htmlFor="cb" className="mb-1 block text-sm text-mute">Career B</label><select id="cb" className={sel} value={b} onChange={(e) => setSel('b', e.target.value)}><option value="">Select a career</option>{careers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
      <p className="text-sm text-mute">Don't see your career? <Link to="/career" className="text-ember underline">Analyze it in Career Explorer</Link>, then come back.</p>

      {(!a || !b) && (
        <div className="card-dark" data-testid="compare-empty">
          <p className="font-semibold">{a ? `Pick a second career to compare with ${careers.find((c) => c.id === a)?.name ?? 'your target'}.` : 'Choose two careers to compare.'}</p>
          <p className="mt-1 text-sm text-mute">You will see how the two models differ and how your current ratings relate to each. A career you have not rated yet is shown as "Not assessed", never as a score.</p>
          {a && careers.filter((c) => c.id !== a).length > 0 && <div className="mt-3 flex flex-wrap gap-2" aria-label="Quick picks">{careers.filter((c) => c.id !== a).slice(0, 5).map((c) => <button key={c.id} type="button" className="btn-quiet" onClick={() => setSel('b', c.id)}>{c.name}</button>)}</div>}
        </div>
      )}
      {same && <div className="card-dark" role="alert"><p>⚠ Choose two different careers.</p></div>}
      {(A.error || B.error) && <div className="card-dark" role="alert"><p className="font-semibold">We couldn't load one of those careers.</p><button className="btn mt-3" onClick={() => { A.retry(); B.retry(); }}>Try again</button></div>}
      {loading && <Skeleton className="h-96" />}

      {comp && (comp.a.assessment.state === 'not_assessed' || comp.b.assessment.state === 'not_assessed') && <p className="rounded-lg border border-warn p-3 text-sm text-warn" role="note">Incomplete comparison: {[comp.a, comp.b].filter((x) => x.assessment.state === 'not_assessed').map((x) => x.career.name).join(' and ')} {[comp.a, comp.b].filter((x) => x.assessment.state === 'not_assessed').length > 1 ? 'have' : 'has'} not been assessed, so only the career models are compared for {[comp.a, comp.b].filter((x) => x.assessment.state === 'not_assessed').length > 1 ? 'them' : 'it'}. Rate its skills to see your readiness.</p>}
      {comp && (
        <>
          <Two title="Overview" nameA={comp.a.career.name} nameB={comp.b.career.name} a={side(comp.a).overview} b={side(comp.b).overview} />
          <section className="card" aria-label="Skill comparison">
            <h2 className="text-lg font-semibold">Skills</h2>
            <p className="text-sm text-bark2">Shared skills match by name across the two models. Differences are descriptive, not a judgment.</p>
            <div className="mt-3 space-y-3 text-sm">
              <div><h3 className="font-semibold">Shared skills ({comp.sharedSkills.length})</h3>{comp.sharedSkills.length ? <ul className="mt-1 space-y-1">{comp.sharedSkills.map((p) => <li key={p.name}>{p.name} <span className="text-bark2">· requires {LEVELS[p.a.requiredLevel]} in A, {LEVELS[p.b.requiredLevel]} in B</span></li>)}</ul> : <p className="text-bark2">No skills appear in both models.</p>}</div>
              {comp.sharedCapabilities.length > 0 && <p><b>Shared capabilities:</b> {comp.sharedCapabilities.join(', ')}</p>}
              <div className="grid gap-4 md:grid-cols-2"><div className="rounded-xl border border-sand p-3"><h3 className="font-semibold">Only in {comp.a.career.name}</h3><p>{names(comp.onlyA)}</p></div><div className="rounded-xl border border-sand p-3"><h3 className="font-semibold">Only in {comp.b.career.name}</h3><p>{names(comp.onlyB)}</p></div></div>
            </div>
          </section>
          <Two title="Your readiness for each model" hint="Computed separately by the same readiness engine. This is descriptive, not a recommendation." nameA={comp.a.career.name} nameB={comp.b.career.name} a={side(comp.a).readiness} b={side(comp.b).readiness} />
          <Two title="Gaps" nameA={comp.a.career.name} nameB={comp.b.career.name} a={side(comp.a).gaps} b={side(comp.b).gaps} />
          <Two title="Next actions (preview)" hint={`Previews only. Your active roadmap stays ${targetName} until you set a new target career.`} nameA={comp.a.career.name} nameB={comp.b.career.name} a={side(comp.a).actions} b={side(comp.b).actions} />
          <div className="grid gap-4 md:grid-cols-2"><div className="card-dark"><p className="mb-2 font-semibold">{comp.a.career.name}</p><SetTargetButton careerId={comp.a.career.id} careerName={comp.a.career.name} /></div><div className="card-dark"><p className="mb-2 font-semibold">{comp.b.career.name}</p><SetTargetButton careerId={comp.b.career.id} careerName={comp.b.career.name} /></div></div>
        </>
      )}
    </div>
  );
}
