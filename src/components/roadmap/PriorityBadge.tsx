import type { Level3 } from '../../types';

const P: Record<Level3, [string, string]> = { high: ['▲ High priority', 'border-bad text-bad'], medium: ['◆ Medium priority', 'border-warn text-warn'], low: ['▽ Low priority', 'border-sand text-bark2'] };
export default function PriorityBadge({ priority }: { priority: Level3 }) {
  const [label, tone] = P[priority];
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>;
}
