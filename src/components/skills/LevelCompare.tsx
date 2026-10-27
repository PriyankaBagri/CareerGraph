import { LEVELS } from '../../utils/readiness';

function Bar({ label, level, fill }: { label: string; level: number; fill: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="text-bark2">{label}</span><b>{LEVELS[level]} <span className="font-normal text-bark2">({level}/5)</span></b></div>
      <div className="mt-1 flex gap-1" role="img" aria-label={`${label}: ${LEVELS[level]}, level ${level} of 5`}>
        {[1, 2, 3, 4, 5].map((i) => <span key={i} className={`h-3 flex-1 rounded-sm ${i <= level ? fill : 'bg-sand'}`} />)}
      </div>
    </div>
  );
}

export default function LevelCompare({ required, current, assessed = true }: { required: number; current: number; assessed?: boolean }) {
  if (!assessed) return <div className="space-y-3"><Bar label="Expected level" level={required} fill="bg-bark" /><p className="text-sm text-bark2">Your level: <b>Not assessed</b>. Set your current level below so CareerGraph can work out your gap.</p></div>;
  const gap = Math.max(0, required - current);
  return (
    <div className="space-y-3">
      <Bar label="Expected level" level={required} fill="bg-bark" />
      <Bar label="Your level" level={current} fill="bg-ember" />
      <p className="text-sm font-semibold">{gap ? `Gap: ${gap} level${gap > 1 ? 's' : ''}` : 'No skill gap: you meet the required level.'}</p>
    </div>
  );
}
