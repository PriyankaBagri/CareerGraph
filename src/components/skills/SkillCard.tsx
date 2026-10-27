import { Link } from 'react-router-dom';
import type { SkillAnalysis } from '../../types';
import { COVERAGE_LABEL, STRENGTH_LABEL } from '../../utils/constants';
import { LEVELS } from '../../utils/readiness';
import StatusBadge from './StatusBadge';

export default function SkillCard({ s }: { s: SkillAnalysis }) {
  return (
    <Link to={`/skills/${encodeURIComponent(s.skillId)}`} className="card block transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start justify-between gap-2"><h3 className="font-semibold leading-snug">{s.name}</h3><StatusBadge status={s.status} /></div>
      <p className="text-xs uppercase tracking-wide text-bark2">{s.capabilityName}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-bark2">Level</dt><dd>{s.assessed ? LEVELS[s.currentLevel] : 'Not assessed'} → needs {LEVELS[s.requiredLevel]}{s.assessed && s.skillGap > 0 ? ` (${s.skillGap} to go)` : ''}</dd>
        <dt className="text-bark2">Evidence</dt><dd>{s.evidenceCount} piece{s.evidenceCount === 1 ? '' : 's'}{s.strongest ? ` · strongest ${STRENGTH_LABEL[s.strongest]}` : ''}{s.evidenceCount ? ` · ${COVERAGE_LABEL[s.coverage].toLowerCase()} coverage` : ''}</dd>
      </dl>
    </Link>
  );
}
