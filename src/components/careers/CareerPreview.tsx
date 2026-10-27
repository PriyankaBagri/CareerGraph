import type { ReactNode } from 'react';
import type { Career } from '../../types';
import CapabilityList from './CapabilityList';

interface Props { career: Career; onRetry: () => void; activate: ReactNode }

export default function CareerPreview({ career, onRetry, activate }: Props) {
  const skills = career.capabilities.reduce((n, c) => n + c.skills.length, 0);
  return (
    <section className="card animate-rise" aria-labelledby="prev-h">
      <p className="eyebrow">Template fallback · not AI-generated</p>
      <h2 id="prev-h" className="mt-1 text-2xl font-semibold">{career.name}</h2>
      <p className="text-sm text-bark2">{career.category} · {career.capabilities.length} capabilities · {skills} skills</p>
      <p className="mt-3">{career.description}</p>
      <p className="mt-3 text-sm text-bark2">This model will power your readiness, skill gaps, evidence analysis, prioritized actions and roadmap. It is a generic starting point built from a keyword template, not an AI model and not tailored to this career, so treat the required levels as editable assumptions.</p>
      <div className="mt-4"><CapabilityList career={career} /></div>
      {career.evidenceExpectations && career.evidenceExpectations.length > 0 && (
        <div className="mt-4"><h3 className="font-semibold">Evidence expectations</h3><ul className="mt-1 list-disc pl-5 text-sm">{career.evidenceExpectations.map((e) => <li key={e}>{e}</li>)}</ul></div>
      )}
      <div className="mt-6 flex flex-wrap items-start gap-3">
        {activate}
        <button className="rounded-lg border border-sand px-4 py-2" onClick={onRetry}>Edit / Try again</button>
      </div>
    </section>
  );
}
