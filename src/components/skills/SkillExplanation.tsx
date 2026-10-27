import type { EvaluationRulesView, SkillAnalysis } from '../../types';
import { explainSkill } from '../../utils/explain';

// "Why is this skill rated like this?" Every figure comes from the server's per-skill breakdown (see utils/explain.ts).
export default function SkillExplanation({ skill, rules }: { skill: SkillAnalysis; rules?: EvaluationRulesView }) {
  const x = explainSkill(skill, rules);
  if (!x) {
    return (
      <section className="card" aria-labelledby="why-score-h">
        <h2 id="why-score-h" className="text-lg font-semibold">Why this assessment</h2>
        <p className="mt-1 text-sm text-bark2">Step-by-step score explanations appear when the app is connected to the CareerGraph server. In local mode only the status above is available.</p>
      </section>
    );
  }
  return (
    <section className="card" aria-labelledby="why-score-h" data-testid="skill-explanation">
      <h2 id="why-score-h" className="text-lg font-semibold">Why this assessment</h2>
      <p className="mt-1 font-semibold">{x.headline}</p>
      <ol className="mt-3 space-y-2 text-sm">
        {x.steps.map((s) => <li key={s.key}><b>{s.title}.</b> {s.text}</li>)}
      </ol>
      <p className="mt-3 text-sm"><b>Evidence status.</b> {x.statusReason}</p>
      {x.evidenceLines.length > 0 && (
        <ul className="mt-2 divide-y divide-sand rounded-xl border border-sand text-sm" aria-label="Evidence and the points it earns">
          {x.evidenceLines.map((l) => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"><span className="font-medium">{l.title}</span><span className="text-bark2">{l.strength} · {l.points} pt{l.points === 1 ? '' : 's'} · {l.provenance}</span></li>)}
        </ul>
      )}
      <h3 className="mt-4 font-semibold">What would change it</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{x.whatIf.map((t, i) => <li key={i}>{t}</li>)}</ul>
      <p className="mt-3 text-xs text-bark2">{x.caveat} This is a rule-based estimate from your own ratings, not a prediction of hiring or job success.</p>
    </section>
  );
}
