import { Link } from 'react-router-dom';
import type { Readiness, SkillAnalysis } from '../../types';
import { statusBreakdown } from '../../utils/skillStatus';

const ICON = { strong: ['✓', 'text-ok', 'Strong'], developing: ['△', 'text-warn', 'Developing'], missing: ['!', 'text-bad', 'Missing'] } as const;

// Honest states: "Not assessed" is not "0%". A number is shown only when enough skills have been rated.
export default function ReadinessCard({ readiness, skills }: { readiness: Readiness; skills?: SkillAnalysis[] }) {
  // Headline first: the number (or "Not assessed") and one sentence. The per-metric bars, reasons and skill tiles are folded away.
  const a = readiness.assessment;
  const b = skills ? statusBreakdown(skills) : null;
  return (
    <section className="card" aria-labelledby="ready-h">
      <h2 id="ready-h" className="eyebrow">Career readiness</h2>
      {a.state === 'not_assessed' ? (
        <>
          <div className="mt-1 text-3xl font-bold leading-tight">Not assessed</div>
          <p className="mt-2 text-bark2">{a.assessed === 0 ? 'None of the skills for this career have been rated yet.' : `Only ${a.assessed} of ${a.total} skills have been rated.`} Rate your current level for each skill and CareerGraph will show where you stand, what is missing and what to do next.</p>
          <Link to="/skills" className="btn mt-4">Complete assessment</Link>
          {readiness.backend && <p className="mt-3 text-xs text-bark2">Rule-based estimate, not a prediction of hiring or job success. Unrated skills are unknown, not zero.</p>}
        </>
      ) : (
        <>
          <div className="mt-1 text-6xl font-bold leading-none">{readiness.overall}%</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand" role="progressbar" aria-label="Career readiness" aria-valuenow={readiness.overall} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-ember" style={{ width: `${readiness.overall}%` }} /></div>
          <p className="mt-2 text-bark2">{readiness.summary}</p>
          {a.state === 'partial' && <p className="mt-1 text-sm text-warn">Based on {a.assessed} of {a.total} rated skills. <Link to="/skills" className="underline">Rate the rest</Link> for a fuller picture.</p>}
          <details className="mt-4" data-testid="why-score">
          <summary className="cursor-pointer font-semibold">Why this score?</summary>
          <div className="mt-3">
            {readiness.metrics.map((m) => (
              <div key={m.key} className="mt-3">
                <div className="flex justify-between text-sm text-bark2"><span>{m.label}</span><b className="text-bark">{m.value}%</b></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-sand" role="progressbar" aria-label={m.label} aria-valuenow={m.value} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-ember transition-all duration-700" style={{ width: `${m.value}%` }} />
                </div>
              </div>
            ))}
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {readiness.reasons.map((r, i) => { const [sym, cls, word] = ICON[r.tone]; return <li key={i}><b className={cls}>{sym} {word}</b> · {r.text}</li>; })}
          </ul>
          {readiness.backend && (
            <div className="mt-5 border-t border-sand pt-3 text-xs text-bark2" aria-label="About this estimate">
              {readiness.backend.range && a.state === 'partial' && <p>Possible range once every skill is rated: {readiness.backend.range.min}–{readiness.backend.range.max}%. Unrated skills are unknown, not counted as zero.</p>}
              <p className="mt-1">Rule-based estimate, not a prediction of hiring or job success.</p>
              {readiness.backend.caveats.length > 0 && <ul className="mt-1 list-disc space-y-1 pl-4">{readiness.backend.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>}
            </div>
          )}
          </details>
        </>
      )}
      {b && b.total > 0 && (
        <details className="mt-4 border-t border-sand pt-3" aria-label="Where your skills stand">
          <summary className="cursor-pointer text-sm font-semibold">Where your {b.total} skills stand</summary>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-lg border border-sand p-2"><dt className="text-xs text-bark2">Not assessed</dt><dd className="text-lg font-bold">{b.notAssessed}</dd><dd className="text-xs text-bark2">unknown, not zero</dd></div>
            <div className="rounded-lg border border-sand p-2"><dt className="text-xs text-bark2">Below target</dt><dd className="text-lg font-bold text-warn">{b.belowTarget}</dd><dd className="text-xs text-bark2">rated, under the level</dd></div>
            <div className="rounded-lg border border-sand p-2"><dt className="text-xs text-bark2">Evidence missing or thin</dt><dd className="text-lg font-bold">{b.evidenceMissing + b.evidenceThin}</dd><dd className="text-xs text-bark2">{b.evidenceMissing} none · {b.evidenceThin} thin</dd></div>
            <div className="rounded-lg border border-sand p-2"><dt className="text-xs text-bark2">On track</dt><dd className="text-lg font-bold text-ok">{b.onTrack}</dd><dd className="text-xs text-bark2">level and evidence</dd></div>
          </dl>
        </details>
      )}
      {readiness.backend?.evaluation && (
        <details className="mt-3 text-xs text-bark2">
          <summary className="cursor-pointer font-semibold">How this is calculated ({readiness.backend.evaluation.source === 'custom' ? "this career's own settings" : 'default rules'})</summary>
          <p className="mt-1">{readiness.backend.evaluation.description}.</p>
          <p className="mt-1">Based on what you entered. Not verified, and not an official standard.</p>
        </details>
      )}
    </section>
  );
}
