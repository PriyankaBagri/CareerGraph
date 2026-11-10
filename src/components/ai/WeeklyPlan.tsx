import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { aiClient, friendlyAiError, type PlanReply } from '../../services/assistant';
import PriorityBadge from '../roadmap/PriorityBadge';

// Only ever reaches 'ready' through a successful aiClient.plan() call below — a failed or malformed response is
// always shown as 'error' or 'empty', never silently rendered as a plan.
type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'empty' } | { kind: 'ready'; plan: PlanReply };

export default function WeeklyPlan({ careerId }: { careerId: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function build() {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', plan: await aiClient.plan(careerId) });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_actions_available') setState({ kind: 'empty' });
      else setState({ kind: 'error', message: friendlyAiError(e) });
    }
  }

  return (
    <section className="card-dark space-y-3" aria-label="Weekly plan">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-lg font-semibold">Weekly plan</h2><p className="text-sm text-mute">A week-by-week plan built from your current readiness and next actions.</p></div>
        <button type="button" className="btn" disabled={state.kind === 'loading'} onClick={() => void build()}>
          {state.kind === 'loading' ? 'Building…' : state.kind === 'ready' ? 'Rebuild plan' : 'Build my weekly plan'}
        </button>
      </div>
      {state.kind === 'error' && <p role="alert" className="text-sm text-bad">{state.message}</p>}
      {state.kind === 'empty' && <p className="text-sm text-mute">There are no open actions for this career yet. Rate a few skills or add evidence first, then try again.</p>}
      {state.kind === 'ready' && <PlanView plan={state.plan} />}
    </section>
  );
}

function PlanView({ plan }: { plan: PlanReply }) {
  return (
    <div className="space-y-4">
      <p data-testid="plan-source" className="text-xs font-semibold uppercase tracking-wide text-bark2">{plan.source === 'ai' ? 'AI-generated plan' : 'Rule-based starter plan'}</p>
      <p className="text-sm text-mute">{plan.notice}</p>
      {plan.weeks.map((w) => (
        <article key={w.week} className="card space-y-2">
          <h3 className="font-semibold">Week {w.week}: {w.focus}</h3>
          <p className="text-sm text-bark2">{w.rationale}</p>
          <ul className="space-y-2">
            {w.actions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-sand pt-2 first:border-0 first:pt-0">
                <div className="min-w-0">
                  <p className="font-medium">{a.skillName} <span className="font-normal text-bark2">· {a.capabilityName}</span></p>
                  <p className="text-sm leading-6">{a.recommendation}</p>
                  <p className="text-xs text-bark2">Done when: {a.completionCriterion}</p>
                </div>
                <PriorityBadge priority={a.priority} />
              </li>
            ))}
          </ul>
        </article>
      ))}
      <p className="text-xs text-mute">Mark actions done on your <Link to="/roadmap" className="underline">Roadmap</Link> — this page always reflects your latest status.</p>
    </div>
  );
}
