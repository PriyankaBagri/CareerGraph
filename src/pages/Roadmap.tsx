import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import ActionCard from '../components/roadmap/ActionCard';
import Skeleton from '../components/ui/Skeleton';
import { useCareerAnalysis } from '../hooks/useCareerAnalysis';
import { useProfile } from '../hooks/useProfile';
import { PHASES, blockedBy, nextActions, summarize } from '../utils/actions';
import { readinessLabel } from '../utils/readiness';

const SHOW = 4; // rows shown per milestone before the rest are folded away

export default function Roadmap() {
  const me = useProfile();
  const { view, actions, roadmap, error, retry, setActionStatus } = useCareerAnalysis(me?.profile.targetCareerId ?? '');
  useEffect(() => { document.title = 'Roadmap · CareerGraph'; }, []);
  const names = useMemo(() => new Map(view?.skills.map((s) => [s.skillId, s.name] as const) ?? []), [view]);

  if (error) return <div className="card-dark" role="alert"><p className="font-semibold">We couldn't build your roadmap right now.</p><button className="btn mt-3" onClick={retry}>Try again</button></div>;
  if (!view || !actions || !roadmap) return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;

  const sum = summarize(actions);
  const onTrack = view.skills.filter((s) => s.status === 'on_track').length;
  const next = nextActions(actions, 1); // one featured action; the full list below holds the rest
  const stat = (label: string, value: string) => <div className="rounded-xl border border-line bg-panel px-4 py-3"><p className="text-xs text-mute">{label}</p><p className="text-xl font-semibold">{value}</p></div>;

  return (
    <div className="animate-rise space-y-8">
      <header className="space-y-4">
        <div><p className="eyebrow">Roadmap</p><h1 className="text-3xl font-semibold">{view.career.name}</h1>
          <p className="max-w-2xl text-mute">Readiness is how well you match this career. Progress is how much of this plan you've done.</p></div>
        <div className="grid grid-cols-3 gap-3 sm:max-w-xl">
          {stat('Readiness', readinessLabel(view.readiness))}{stat('Plan progress', `${roadmap.progress}%`)}{stat('Done', `${sum.completed} of ${actions.length}`)}
        </div>
        <p className="text-sm text-mute">{sum.inProgress} in progress · {sum.remaining} remaining · {onTrack} of {view.skills.length} skills on track</p>
      </header>

      {view.evidence.length === 0 && <p className="text-sm text-mute">No evidence added yet. <Link to="/evidence" className="text-ember underline">Add evidence</Link> to make readiness more meaningful.</p>}

      {actions.length === 0 ? (
        <div className="card-dark"><p className="font-semibold">{view.gaps.length === 0 ? "You're currently on track. Keep building evidence and maintaining your skills." : 'Your roadmap will appear as CareerGraph learns more about your skills and evidence.'}</p></div>
      ) : (
        <>
          <section aria-labelledby="na-h" className="space-y-3">
            <h2 id="na-h" className="text-lg font-semibold">Do this next</h2>
            {next.length === 0 ? <p className="text-mute">Every planned action is completed. Keep your evidence up to date.</p> : (
              <div className="max-w-3xl">{next.map((a) => <ActionCard key={a.id} action={a} skillNames={names} waitingOn={blockedBy(a, actions)} onStatus={setActionStatus} />)}</div>
            )}
          </section>
          <section aria-labelledby="tl-h" className="space-y-3">
            <h2 id="tl-h" className="text-lg font-semibold">All actions, in order</h2>
            <ol className="relative space-y-6 border-l border-line pl-6">
              {PHASES.filter((p) => roadmap.milestones.some((x) => x.phase === p.key)).map((p, idx) => {
                const m = roadmap.milestones.find((x) => x.phase === p.key);
                if (!m) return null;
                const items = actions.filter((a) => a.phase === p.key);
                const shown = items.slice(0, SHOW), rest = items.slice(SHOW);
                const row = (a: (typeof items)[number]) => <ActionCard key={a.id} compact action={a} skillNames={names} waitingOn={blockedBy(a, actions)} onStatus={setActionStatus} />;
                return (
                  <li key={p.key} className="relative">
                    <span aria-hidden className={`absolute -left-[2.15rem] top-0.5 grid h-6 w-6 place-items-center rounded-full border text-xs font-semibold ${m.completed === m.total && m.total > 0 ? 'border-ok bg-ok text-ink' : 'border-ember bg-ink text-ember'}`}>{idx + 1}</span>
                    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{p.label} <span className="font-normal text-mute">· {p.blurb}</span></h3><span className="text-sm text-mute">{m.completed} of {m.total} done</span></div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={`${p.label} progress`} aria-valuenow={m.progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-ember transition-all" style={{ width: `${m.progress}%` }} /></div>
                    <ul className="mt-1">{shown.map(row)}</ul>
                    {rest.length > 0 && <details className="mt-1"><summary className="cursor-pointer py-1 text-sm text-ember underline">Show {rest.length} more in {p.label}</summary><ul>{rest.map(row)}</ul></details>}
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
