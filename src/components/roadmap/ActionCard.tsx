import { useState } from 'react';
import type { Action, ActionStatus } from '../../types';
import { STATUS_ICON, STATUS_LABEL } from '../../utils/actions';
import ActionGuide from './ActionGuide';
import PriorityBadge from './PriorityBadge';

interface Props { action: Action; skillNames: Map<string, string>; waitingOn: Action[]; onStatus: (a: Action, s: ActionStatus) => Promise<void>; compact?: boolean }
const NEXT: Record<ActionStatus, [string, ActionStatus]> = { not_started: ['Start', 'in_progress'], in_progress: ['Mark complete', 'completed'], completed: ['Reopen', 'not_started'] };

export default function ActionCard({ action: a, skillNames, waitingOn, onStatus, compact = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function set(s: ActionStatus) { setBusy(true); setFailed(false); try { await onStatus(a, s); } catch { setFailed(true); } finally { setBusy(false); } }
  const skills = a.relatedSkillIds.map((id) => skillNames.get(id)).filter(Boolean).join(', ');
  const select = (
    <select aria-label={`Status for ${a.title}`} value={a.status} disabled={busy} onChange={(e) => void set(e.target.value as ActionStatus)} className="rounded-lg border border-sand bg-white px-2 py-1 text-sm">
      {(Object.keys(STATUS_LABEL) as ActionStatus[]).map((s) => <option key={s} value={s}>{STATUS_ICON[s]} {STATUS_LABEL[s]}</option>)}
    </select>
  );
  const err = failed && <p role="alert" className="text-sm text-bad">⚠ We couldn't save that change. Try again.</p>;
  if (compact) {
    const tone = a.status === 'completed' ? 'text-ok' : a.status === 'in_progress' ? 'text-ember' : 'text-mute';
    const meta = [a.detail?.guidance ? `${a.detail.guidance.kindLabel} · ${a.detail.guidance.effort.text} (estimate)` : a.estimatedTime, waitingOn.length ? `waiting on: ${waitingOn.map((w) => w.title).join('; ')}` : ''].filter(Boolean).join(' · ');
    return (
      <li className="flex flex-wrap items-start justify-between gap-2 border-t border-line py-2.5 first:border-0">
        <div className="min-w-0 flex-1"><p className={`font-medium ${a.status === 'completed' ? 'text-mute line-through' : ''}`}><span aria-hidden className={tone}>{STATUS_ICON[a.status]}</span> {a.title}</p>
          <p className="text-xs text-mute">{meta}</p>{err}{a.detail?.guidance && <div className="mt-1"><ActionGuide inline guidance={a.detail.guidance} completed={a.status === 'completed'} /></div>}</div>
        <select aria-label={`Status for ${a.title}`} value={a.status} disabled={busy} onChange={(e) => void set(e.target.value as ActionStatus)} className={`rounded-lg border border-line bg-ink px-2 py-1 text-sm ${tone}`}>
          {(Object.keys(STATUS_LABEL) as ActionStatus[]).map((st) => <option key={st} value={st}>{STATUS_ICON[st]} {STATUS_LABEL[st]}</option>)}
        </select>
      </li>
    );
  }
  const [label, to] = NEXT[a.status];
  const fact = (k: string, v: string) => <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[6rem_1fr]"><dt className="text-bark2">{k}</dt><dd className="leading-6">{v}</dd></div>;
  // Each fact appears once. The time estimate lives in the guide's summary when there is a guide, otherwise here; the ranking figures are secondary, at the bottom.
  const rank = a.detail ? `Ranked #${a.detail.rank} · priority score ${a.priorityScore}${a.effort ? ` · effort ${a.effort}` : ''}. Rank is rule-based, not a deadline.` : a.effort ? `Effort: ${a.effort}` : '';
  return (
    <article className="card space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0"><h3 className="text-lg font-semibold leading-snug">{a.title}</h3>{a.detail?.guidance && <p className="text-xs text-bark2">{a.detail.guidance.kindLabel}</p>}</div>
        <PriorityBadge priority={a.priority} />
      </header>
      <p className="text-sm leading-6">{a.description}</p>
      <dl className="space-y-2 border-t border-sand pt-3 text-sm">
        {fact('Why', a.reason)}
        {a.detail && fact('Done when', a.detail.completionCriterion)}
        {skills && fact('Skills', skills)}
        {!a.detail?.guidance && a.estimatedTime && fact('Time', `${a.estimatedTime} (estimate)`)}
      </dl>
      {waitingOn.length > 0 && <p className="text-sm text-warn">Waiting on: {waitingOn.map((w) => w.title).join('; ')}</p>}
      <div className="flex flex-wrap items-center gap-3"><button className="btn" disabled={busy} onClick={() => void set(to)}>{busy ? 'Saving…' : label}</button>{select}</div>
      {err}
      {a.detail?.guidance && <ActionGuide guidance={a.detail.guidance} completed={a.status === 'completed'} shown={a.description} />}
      {rank && <p className="border-t border-sand pt-2 text-xs text-bark2">{rank}</p>}
    </article>
  );
}
