import { Link } from 'react-router-dom';
import type { Readiness, SkillAnalysis } from '../../types';
import { readinessBreakdown } from '../../utils/explain';

const link = (id: string) => `/skills/${encodeURIComponent(id)}`;
// Which skills make up the readiness number, which are unknown (not counted), and where evidence is missing. All figures are the server's.
export default function ReadinessBreakdown({ readiness, skills }: { readiness: Readiness; skills: SkillAnalysis[] }) {
  const b = readinessBreakdown(skills);
  if (!b) return null;
  const none = readiness.assessment.state === 'not_assessed';
  return (
    <section className="card" aria-labelledby="bd-h" data-testid="readiness-breakdown">
      <h2 id="bd-h" className="text-lg font-semibold">What is behind your readiness</h2>
      {none ? (
        <p className="mt-1 text-sm text-bark2">No skills are rated yet, so there is no score to explain. Unrated skills are unknown, not zero. <Link to="/skills" className="text-ember underline">Rate your skills</Link> to start.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-bark2">Each rated skill adds points in proportion to its importance. The points below add up to about {b.pointsTotal}, the {readiness.overall}% shown above (rounding aside).</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Rated skills and their contribution to readiness</caption>
              <thead className="text-xs text-bark2"><tr><th scope="col" className="py-1 pr-3">Skill</th><th scope="col" className="pr-3">Level</th><th scope="col" className="pr-3">Skill score</th><th scope="col" className="pr-3">Weight</th><th scope="col">Points</th></tr></thead>
              <tbody>{b.contributors.map((c) => (
                <tr key={c.skillId} className="border-t border-sand"><th scope="row" className="py-1.5 pr-3 font-medium"><Link to={link(c.skillId)} className="underline">{c.name}</Link></th><td className="pr-3">{c.level} of {c.required}</td><td className="pr-3">{c.score}/100</td><td className="pr-3">{c.share}%</td><td className="font-semibold">{c.points}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {b.unassessed.length > 0 && !none && (
        <div className="mt-4"><h3 className="text-sm font-semibold">Not assessed ({b.unassessed.length}): unknown, not counted either way</h3>
          <ul className="mt-1 flex flex-wrap gap-2 text-sm">{b.unassessed.map((s) => <li key={s.skillId}><Link to={link(s.skillId)} className="rounded-full border border-sand px-2 py-0.5 underline">{s.name}</Link></li>)}</ul></div>
      )}
      {b.evidenceGaps.length > 0 && (
        <div className="mt-4"><h3 className="text-sm font-semibold">Rated, but evidence is missing or thin ({b.evidenceGaps.length})</h3>
          <ul className="mt-1 flex flex-wrap gap-2 text-sm">{b.evidenceGaps.map((s) => <li key={s.skillId}><Link to={link(s.skillId)} className="rounded-full border border-sand px-2 py-0.5 underline">{s.name} · {s.evidenceCount === 0 ? 'no evidence' : 'thin'}</Link></li>)}</ul></div>
      )}
      <p className="mt-4 text-xs text-bark2">Levels and evidence strength are self-reported and have not been independently verified.</p>
    </section>
  );
}
