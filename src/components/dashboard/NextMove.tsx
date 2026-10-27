import { Link } from 'react-router-dom';
import type { Action, Roadmap } from '../../types';
import { nextActions, summarize } from '../../utils/actions';

// The single most useful next action, with where to go to do it. Everything else lives on the roadmap.
export default function NextMove({ actions, roadmap }: { actions: Action[]; roadmap: Roadmap }) {
  const [top] = nextActions(actions, 1);
  const s = summarize(actions);
  const g = top?.detail?.guidance;
  return (
    <section className="card" aria-labelledby="nm-h" data-testid="next-step">
      <h2 id="nm-h" className="eyebrow">Your next step</h2>
      {s.total === 0 && <p className="mt-2 text-bark2">You're currently on track. Keep building evidence and maintaining your skills.</p>}
      {s.total > 0 && !top && <p className="mt-2 text-bark2">Every planned action is completed. Keep your evidence up to date.</p>}
      {top && (
        <>
          <h3 className="mt-2 text-xl font-semibold leading-snug">{g?.title ?? top.title}</h3>
          <p className="mt-2 text-sm text-bark2">{g?.whyNow ?? top.reason}</p>
          {g && <p className="mt-2 text-xs text-bark2">{g.kindLabel} · {g.effort.text} (estimate)</p>}
          <Link to="/roadmap" className="btn mt-4 inline-block">See the steps</Link>
        </>
      )}
      {s.total > 0 && <p className="mt-3 text-xs text-bark2">Roadmap progress {roadmap.progress}% · {s.completed} of {s.total} actions completed. {s.total - s.completed > 1 ? <>{s.total - s.completed - (top ? 1 : 0)} more on the <Link to="/roadmap" className="text-ember underline">roadmap</Link>.</> : null}</p>}
    </section>
  );
}
