import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SkillCard from '../components/skills/SkillCard';
import Skeleton from '../components/ui/Skeleton';
import { useCareerAnalysis } from '../hooks/useCareerAnalysis';
import { useProfile } from '../hooks/useProfile';
import type { SkillAnalysis } from '../types';
import { COVERAGE_RANK } from '../utils/constants';

type Filter = 'all' | 'skill' | 'evidence' | 'ok' | 'unassessed';
type Sort = 'capability' | 'gap' | 'evidence';
const sel = 'rounded-lg border border-line bg-panel px-3 py-2 text-white';

export default function Skills() {
  const me = useProfile();
  const { view, error, retry } = useCareerAnalysis(me?.profile.targetCareerId ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('capability');

  const rows = useMemo(() => {
    if (!view) return [];
    const f = view.skills.filter((s) => filter === 'all' || (filter === 'unassessed' ? s.status === 'not_assessed' : filter === 'ok' ? s.status === 'on_track' : filter === 'skill' ? s.skillGap > 0 : s.status === 'evidence_gap' || s.status === 'combined_gap'));
    if (sort === 'gap') return [...f].sort((a, b) => b.skillGap - a.skillGap || a.name.localeCompare(b.name));
    if (sort === 'evidence') return [...f].sort((a, b) => COVERAGE_RANK[a.coverage] - COVERAGE_RANK[b.coverage] || a.name.localeCompare(b.name));
    return f;
  }, [view, filter, sort]);
  const groups = useMemo(() => (sort === 'capability' ? [...rows.reduce((m, s) => m.set(s.capabilityName, [...(m.get(s.capabilityName) ?? []), s]), new Map<string, SkillAnalysis[]>())] : [['Sorted skills', rows] as [string, SkillAnalysis[]]]), [rows, sort]);

  return (
    <div className="animate-rise space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">Skill intelligence</p><h1 className="text-3xl font-semibold">{view ? `Skills for ${view.career.name}` : 'Skills'}</h1>
          <p className="text-mute">Required level, your level and supporting evidence for each skill.</p></div>
        <div className="flex flex-wrap gap-3">
          <select aria-label="Filter skills" className={sel} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}><option value="all">All skills</option><option value="skill">Skill gaps</option><option value="evidence">Evidence gaps</option><option value="ok">On track</option><option value="unassessed">Not assessed</option></select>
          <select aria-label="Sort skills" className={sel} value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="capability">Group by capability</option><option value="gap">Largest gap</option><option value="evidence">Weakest evidence</option></select>
        </div>
      </header>
      {error && <div className="card-dark" role="alert"><p className="font-semibold">We couldn't load your skills right now.</p><button className="btn mt-3" onClick={retry}>Try again</button></div>}
      {!me && <p className="text-mute" role="status">Loading your profile…</p>}
      {me && !me.profile.targetCareerId && <div className="card-dark"><p className="font-semibold">No target career selected.</p><p className="text-mute">Complete onboarding to choose a career.</p></div>}
      {!view && !error && me && <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>}
      {view && view.skills.length === 0 && <div className="card-dark"><p className="font-semibold">This career has no skills defined yet.</p></div>}
      {view && view.skills.length > 0 && rows.length === 0 && (
        <div className="card-dark"><p>{filter === 'skill' ? (view.skills.some((s) => s.assessed) ? 'No skill gaps among the skills you have assessed.' : 'No skills are assessed yet, so no gaps can be identified.') : 'No skills match this filter.'}</p></div>
      )}
      {groups.map(([name, list]) => list.length > 0 && (
        <section key={name} aria-label={name}>
          <h2 className="eyebrow mb-3">{name}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.map((s) => <SkillCard key={s.skillId} s={s} />)}</div>
        </section>
      ))}
      {view && <p className="text-sm text-mute">Evidence is added in the <Link to="/evidence" className="text-ember underline">Evidence library</Link>.</p>}
    </div>
  );
}
