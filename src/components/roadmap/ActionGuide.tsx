import { useState, type ReactNode } from 'react';
import type { ActionGuidance } from '../../types';

// Expandable "how to do this" for one action. Collapsed by default so the roadmap stays short; everything here comes from the server's guidance.
// Opened, it shows a three-line summary and the numbered steps first. Everything else sits behind ONE "More guidance" toggle in the same panel
// (a button, not a second accordion), so there is never more than one level to open.
// Where the surrounding card already shows something (the full card shows "Why" and "Done when"), the guide keeps its longer version in "More guidance".
export default function ActionGuide({ guidance: g, completed, inline = false, shown }: { guidance: ActionGuidance; completed?: boolean; inline?: boolean; shown?: string }) {
  const [more, setMore] = useState(false);
  const mute = inline ? 'text-mute' : 'text-bark2'; // the inline guide sits on the dark roadmap list, the full one on a light card
  const line = inline ? 'border-line' : 'border-sand';
  const focus = 'rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember';
  const row = (k: string, v: ReactNode) => <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[6.5rem_1fr]"><dt className={mute}>{k}</dt><dd className="leading-6">{v}</dd></div>;
  const list = (items: string[]) => <ul className="list-disc space-y-1 pl-4">{items.map((t) => <li key={t}>{t}</li>)}</ul>;
  const id = `more-${g.kind}-${g.title.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)}`;
  return (
    <details className="text-sm" data-testid="action-guide">
      <summary className={`inline-block cursor-pointer select-none py-1 font-medium text-ember underline underline-offset-2 ${focus}`}>How to do this</summary>
      <div className={`mt-2 max-w-prose space-y-4 border-l-2 pl-4 ${line}`}>
        {completed && <p role="note" className="rounded-lg border border-warn p-2 text-warn">You marked this done, but the gap is still open: your rating or evidence has not changed. If you improved, update your rating on the skill page. If not, repeat it with a harder exercise.</p>}
        <dl className="space-y-1.5">
          {inline && row('Why it matters', g.whyItMatters)}
          {g.outcome.trim() !== shown?.trim() && row('You will have', g.outcome)} {/* skipped when the card above already says exactly this */}
          {!inline && row('Time', `${g.effort.text} (estimate)`)}
        </dl>
        <div>
          <h4 className="font-medium">Steps</h4>
          <ol className="mt-2 list-decimal space-y-2.5 pl-5 leading-6 marker:font-medium marker:text-ember">{g.steps.map((t) => <li key={t}>{t}</li>)}</ol>
        </div>
        <div className={`border-t pt-2 ${line}`}>
          <button type="button" aria-expanded={more} aria-controls={id} onClick={() => setMore((v) => !v)} className={`py-1 text-ember underline underline-offset-2 ${focus}`}>{more ? 'Hide more guidance' : 'More guidance'}</button>
          {more && (
            <div id={id} data-testid="more-guidance" className="mt-2 space-y-3">
              <dl className="space-y-2.5">
                {!inline && row('Why it matters', g.whyItMatters)}
                {row('Why now', g.whyNow)}
                {g.prerequisites.length > 0 && row('Before you start', list(g.prerequisites))}
                {row('Definition of done', list(g.definitionOfDone))}
                {row('Evidence to add', g.evidenceToSubmit)}
                {row('Where to look', <>{g.resources.note} <span className={mute}>Try searching: {g.resources.searchTerms.map((t) => `“${t}”`).join(', ')}.</span></>)}
                {row('Time estimate', <span className={mute}>{inline ? `${g.effort.text} (estimate). ` : ''}{g.effort.basis}</span>)}
              </dl>
              <div className={`space-y-1 border-t pt-2 text-xs ${mute} ${line}`}>
                <p>{g.ratingNote}</p>
                <p data-testid="guidance-basis">{g.basis}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
