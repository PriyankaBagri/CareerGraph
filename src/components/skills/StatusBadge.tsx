import type { SkillStatus } from '../../types';
import { SKILL_STATUS } from '../../utils/constants';

export default function StatusBadge({ status }: { status: SkillStatus }) {
  const s = SKILL_STATUS[status];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${s.tone}`}><span aria-hidden>{s.symbol}</span>{s.label}</span>;
}
