import { Link } from 'react-router-dom';
import type { Action, DashboardView } from '../../types';
import { plainSummary } from '../../utils/plainSummary';

// "Where am I now, what should I do next, and why?" in plain words. The numbers and graphs remain; this explains them.
// compact: used on the dashboard, where the next step and the gap list sit right next to it, so they are not repeated here.
export default function PlainSummary({ view, actions, compact = false }: { view: DashboardView; actions: Action[]; compact?: boolean }) {
  const s = plainSummary(view, actions);
  const empty = view.skills.every((k) => !k.assessed) && view.evidence.length === 0;
  return (
    <section className={compact ? 'px-1' : 'card'} aria-labelledby="plain-h" data-testid="plain-summary">
      <h2 id="plain-h" className="eyebrow">In plain words</h2>
      {empty && <p className="mt-2 rounded-lg border border-line p-3 text-sm">You have not rated any skills or added evidence yet, so there is nothing to compare. <Link to="/skills" className="text-ember underline">Rate a few skills</Link> to begin: it takes a few minutes and an honest rough rating is enough.</p>}
      <ul className="mt-2 space-y-2 text-sm">
        {!compact && <li><b>Where you are:</b> {s.where}</li>}
        <li><b>What is rated:</b> {s.rated}{s.contributing ? ` ${s.contributing}` : ''}{!compact && s.gaps ? ` ${s.gaps}` : ''}</li>
        <li><b>Evidence:</b> {s.evidence}</li>
        {!compact && (s.next ? <li><b>Best next step:</b> {s.next.title}. <span className="text-bark2">{s.next.why}</span> <Link to="/roadmap" className="text-ember underline">See the steps</Link></li> : <li><b>Best next step:</b> every planned action is done. Keep your ratings and evidence up to date.</li>)}
      </ul>
      <p className={`mt-3 text-xs ${compact ? 'text-mute' : 'text-bark2'}`}>{s.honesty}</p>
    </section>
  );
}
