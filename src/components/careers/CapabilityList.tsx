import type { Career } from '../../types';
import { LEVELS } from '../../utils/readiness';

export default function CapabilityList({ career }: { career: Career }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {career.capabilities.map((c) => (
        <section key={c.id} className="rounded-xl border border-sand p-4" aria-label={c.name}>
          <h3 className="font-semibold">{c.name}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {c.skills.map((s) => <li key={s.id} className="flex justify-between gap-3"><span>{s.name}</span><span className="whitespace-nowrap text-bark2">Requires {LEVELS[s.requiredLevel]}</span></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
