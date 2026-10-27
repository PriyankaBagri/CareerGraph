import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import SetTargetButton from '../components/careers/SetTargetButton';
import StatusBadge from '../components/skills/StatusBadge';
import Skeleton from '../components/ui/Skeleton';
import { useCareerAnalysis } from '../hooks/useCareerAnalysis';
import { useProfile } from '../hooks/useProfile';
import { LEVELS, readinessLabel } from '../utils/readiness';
import PriorityBadge from '../components/roadmap/PriorityBadge';

const ORIGIN = { seed: 'Catalog career', custom: 'Your career model', ai: 'AI-generated career model' } as const;

export default function CareerDetail() {
  const { id = '' } = useParams();
  const me = useProfile();
  const saved = (useLocation().state as { saved?: 'created' | 'updated' } | null)?.saved;
  const { view, error, retry } = useCareerAnalysis(id); // read-only analysis: nothing here changes target or roadmap
  useEffect(() => { if (view) document.title = `${view.career.name} · CareerGraph`; }, [view]);

  if (!id || error) return <div className="card-dark" role="alert"><p className="font-semibold">We couldn't load that career.</p><div className="mt-3 flex gap-3">{id && <button className="btn" onClick={retry}>Try again</button>}<Link to="/career" className="px-2 py-2 text-ember underline">← Career Explorer</Link></div></div>;
  if (!view) return <Skeleton className="h-96" />;

  const { career, readiness, skills, gaps } = view;
  const isTarget = me?.profile.targetCareerId === id;
  const count = (s: string) => skills.filter((x) => x.status === s).length;
  const withEv = skills.filter((s) => s.evidenceCount > 0).length;
  return (
    <div className="animate-rise space-y-6">
      <header>
        <Link to="/career" className="text-sm text-ember underline">← Career Explorer</Link>
        {saved && <p role="status" className="mt-2 rounded-lg border border-ok p-3 text-sm text-ok">{saved === 'created' ? 'Career created. Rate its skills to see where you stand.' : 'Career updated. Ratings and evidence for unchanged skills were kept.'}</p>}
        <h1 className="mt-2 text-3xl font-semibold">{career.name}</h1>
        <p className="text-mute">{career.category} · {ORIGIN[career.origin?.source ?? 'seed']}</p>
        <p className="mt-2 max-w-2xl">{career.description}</p>
        <div className="mt-4 flex flex-wrap items-start gap-4"><SetTargetButton careerId={career.id} careerName={career.name} />{career.origin?.source !== 'seed' ? <Link to={`/career/${encodeURIComponent(career.id)}/edit`} className="rounded-lg border border-line px-4 py-2">Edit career</Link> : <Link to={`/career/new?from=${encodeURIComponent(career.id)}`} className="rounded-lg border border-line px-4 py-2">Use as a template</Link>}<Link to={`/compare?b=${encodeURIComponent(career.id)}`} className="rounded-lg border border-line px-4 py-2">Compare with another career</Link></div>
      </header>

      <section className="card" aria-labelledby="rd-h">
        <h2 id="rd-h" className="text-lg font-semibold">Your current readiness for this career</h2>
        <p className="mt-1 text-3xl font-bold">{readinessLabel(readiness)}</p>{readiness.assessment.state === 'not_assessed' && <p className="text-sm text-bark2">{readiness.assessment.assessed} of {readiness.assessment.total} skills rated. Rate your skills to see a score; unrated skills are not counted as gaps.</p>}{readiness.assessment.state === 'partial' && <p className="text-sm text-warn">Based on {readiness.assessment.assessed} of {readiness.assessment.total} rated skills.</p>}
        <p className="text-sm text-bark2">Readiness measures how your skills and evidence match this career's model. It is separate from roadmap progress.</p>
        {readiness.assessment.state !== 'not_assessed' && <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">{readiness.metrics.map((m) => <div key={m.key} className="rounded-xl border border-sand p-3"><p className="text-xs text-bark2">{m.label}</p><p className="font-semibold">{m.value}%</p></div>)}</div>}
        <p className="mt-3 text-sm">Not assessed: <b>{count('not_assessed')}</b> · Skill gaps: <b>{count('skill_gap')}</b> · Evidence gaps: <b>{count('evidence_gap')}</b> · Skill + evidence gaps: <b>{count('combined_gap')}</b> · On track: <b>{count('on_track')}</b> · Evidence coverage: <b>{withEv} of {skills.length}</b> skills have supporting evidence</p>
        {!isTarget && !me?.profile.isDemo && !view.guidance && <p className="mt-2 text-sm text-bark2">Skills you haven't assessed for this career count as None until you make it your target and assess them.</p>}
      </section>

      <section className="card" aria-labelledby="sk-h">
        <h2 id="sk-h" className="mb-3 text-lg font-semibold">Capabilities and core skills</h2>
        {career.capabilities.length === 0 ? <p className="text-bark2">Some career information is still being developed.</p> : (
          <div className="grid gap-4 md:grid-cols-2">{career.capabilities.map((c) => (
            <section key={c.id} className="rounded-xl border border-sand p-4" aria-label={c.name}><h3 className="font-semibold">{c.name}</h3>
              <ul className="mt-2 space-y-2 text-sm">{skills.filter((s) => s.capabilityId === c.id).map((s) => (
                <li key={s.skillId}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{s.name}</span><StatusBadge status={s.status} /></div><span className="text-bark2">Requires {LEVELS[s.requiredLevel]} · You: {LEVELS[s.currentLevel]}</span></li>
              ))}</ul></section>
          ))}</div>
        )}
      </section>

      <section className="card" aria-labelledby="ee-h">
        <h2 id="ee-h" className="text-lg font-semibold">Evidence expectations</h2>
        {career.evidenceExpectations?.length ? <ul className="mt-1 list-disc pl-5 text-sm">{career.evidenceExpectations.map((e) => <li key={e}>{e}</li>)}</ul> : <p className="mt-1 text-sm text-bark2">Some career information is still being developed. Evidence you add is matched to individual skills.</p>}
      </section>

      <section className="card" aria-labelledby="ap-h">
        <h2 id="ap-h" className="text-lg font-semibold">Next actions {isTarget ? '' : '(preview)'}</h2>
        <p className="text-sm text-bark2">{isTarget ? 'These match your active roadmap.' : 'Preview only. These are not added to your roadmap unless you make this your target career.'}</p>
        {gaps.length === 0 ? <p className="mt-2">{count('not_assessed') > 0 ? `No gaps can be identified yet: ${count('not_assessed')} skills are not assessed.` : "You're currently on track for this model."}</p> : <ul className="mt-2 space-y-2">{view.actions.slice(0, 3).map((a) => <li key={a.id} className="text-sm"><b>{a.title}</b> <PriorityBadge priority={a.priority} /></li>)}</ul>}
        {isTarget && <p className="mt-2 text-sm"><Link to="/roadmap" className="text-ember underline">Open Roadmap</Link></p>}
      </section>
    </div>
  );
}
