import { Link } from 'react-router-dom';
import type { Action, Gap } from '../../types';
import { LEVELS } from '../../utils/readiness';
import { whyGap } from '../../utils/skillStatus';

// Five segments, as on the skill page: filled segments = level reached (only real, rated levels are drawn here).
const Bar = ({ level, fill }: { level: number; fill: string }) => <span className="flex gap-0.5" aria-hidden>{[1, 2, 3, 4, 5].map((i) => <span key={i} className={`h-2 flex-1 rounded-sm ${i <= level ? fill : 'bg-sand'}`} />)}</span>;

export default function GapList({ gaps, actions, unassessed = 0, limit = 3 }: { gaps: Gap[]; actions: Action[]; unassessed?: number; limit?: number }) {
  const row = (g: Gap) => {
    const next = actions.find((a) => a.relatedSkillIds.includes(g.skillId) && a.status !== 'completed');
    return (
      <div key={g.skillId} className="border-t border-sand py-3 first:border-0">
        <div className="flex items-baseline justify-between gap-2">
          <Link to={`/skills/${encodeURIComponent(g.skillId)}`} className="font-semibold underline-offset-2 hover:underline">{g.skillName}</Link>
          <span className="shrink-0 text-xs text-bark2">{g.kind === 'evidence' ? 'needs evidence' : g.kind === 'combined' ? 'below level · needs evidence' : 'below expected level'}</span>
        </div>
        <div className="mt-2 grid grid-cols-[4.5rem_1fr_auto] items-center gap-x-2 gap-y-1 text-xs text-bark2" aria-label={`${g.skillName}: your level ${LEVELS[g.currentLevel]}, expected ${LEVELS[g.requiredLevel]}`}>
          <span>Your level</span><Bar level={g.currentLevel} fill="bg-ember" /><span>{LEVELS[g.currentLevel]}</span>
          <span>Expected</span><Bar level={g.requiredLevel} fill="bg-bark" /><span>{LEVELS[g.requiredLevel]}</span>
        </div>
        {next && <p className="mt-2 text-sm"><b>Next:</b> {next.title} <Link to="/roadmap" className="text-ember underline">Roadmap</Link></p>}
        <details className="mt-1"><summary className="cursor-pointer text-xs text-bark2 underline">Why it matters</summary><p className="mt-1 text-sm text-bark2">{whyGap(g)}</p></details>
      </div>
    );
  };
  return (
    <section className="card" aria-labelledby="gaps-h">
      <div className="mb-2 flex items-baseline justify-between gap-2"><h2 id="gaps-h" className="text-lg font-semibold">Your career gaps</h2><Link to="/skills" className="text-sm text-ember underline">All skills</Link></div>
      {gaps.length === 0 && <p className="text-bark2">{unassessed > 0 ? `No gaps can be identified yet: ${unassessed} skill${unassessed === 1 ? ' is' : 's are'} not assessed.` : 'All assessed skills meet their required levels and have supporting evidence.'}</p>}
      {gaps.length > 0 && unassessed > 0 && <p className="mb-1 text-sm text-bark2">{unassessed} more skill{unassessed === 1 ? ' is' : 's are'} not assessed yet and not counted here.</p>}
      {gaps.slice(0, limit).map(row)}
      {gaps.length > limit && <details className="mt-1"><summary className="cursor-pointer py-2 text-sm text-ember underline">Show the other {gaps.length - limit} gap{gaps.length - limit === 1 ? '' : 's'}</summary>{gaps.slice(limit).map(row)}</details>}
    </section>
  );
}
