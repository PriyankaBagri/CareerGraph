import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Action, Career, EvaluationRulesView, Evidence, SkillAnalysis } from '../../types';
import { STRENGTH_LABEL } from '../../utils/constants';
import { explainAction, skillPanel, type Guidance } from '../../utils/graphDetail';
import { columnY, graphHeight, isCrowded } from '../../utils/graphLayout';
import { COLUMN_TITLES, actionNodeId, buildGraphModel, isActionNode, neighborId, actionShortLabel, type Dir, type GNode, type NodeKind } from '../../utils/graphModel';
import { provenanceBadge } from '../../utils/provenance';
import { skillState, type SkillTone } from '../../utils/skillStatus';
import { shortLabel } from '../../utils/text';
import { LEVELS } from '../../utils/readiness';

// The drawing is laid out for the width it is actually given: the SVG viewBox equals the measured container width, so text keeps its real size, nothing
// needs a horizontal scrollbar, and each column gets an equal share with a label budget derived from that share.
const MIN_W = 480, DEFAULT_W = 960, CHAR_PX = 6.4, PAD = 14;
// Relative width of each column (career, capabilities, skills, evidence, actions): the columns that carry long text get a larger share.
const WEIGHT = [1.05, 1, 1.05, 1.1, 1.25];
const R: Record<NodeKind, number> = { career: 13, capability: 10, skill: 8, evidence: 7, action: 7 };
const FILL: Record<NodeKind, string> = { career: '#e0813f', capability: '#d9b58b', skill: '#c7c0b6', evidence: '#f3ece3', action: '#e0813f' };
// Colour is never the only signal: shapes differ (actions are squares), and the legend, tooltips, the list view and the panel all say the status in words.
const TONE_FILL: Record<SkillTone, string> = { unknown: '#8a7f74', below: '#c98a1b', evidence: '#4d8ab5', ok: '#3f8f5f' };
const TONE_TEXT: Record<SkillTone, string> = { unknown: 'text-mute', below: 'text-warn', evidence: 'text-[#4d8ab5]', ok: 'text-ok' };
const TONE_MARK: Record<SkillTone, string> = { unknown: '?', below: '△', evidence: '◇', ok: '✓' };
const PRIORITY_FILL: Record<Action['priority'], string> = { high: '#e0813f', medium: '#d9b58b', low: '#c7c0b6' };
const KEY_DIR: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const KIND_WORD: Record<NodeKind, string> = { career: 'Career', capability: 'Capability', skill: 'Skill', evidence: 'Evidence', action: 'Next action' };

interface Props {
  career: Career; evidence: Evidence[]; overall: number; readinessText?: string; skills: SkillAnalysis[]; actions?: Action[];
  guidance?: Guidance; rules?: EvaluationRulesView; /** true while newer data is being fetched after an evidence/rating change */ refreshing?: boolean;
}

// Career -> Capabilities -> Skills -> Evidence -> Next actions, as an interactive graph OR a list, sharing ONE selection and ONE detail panel. Everything shown is
// derived from the analysis the app already holds (see utils/graphModel.ts); there is no skill->skill prerequisite link because the data model has none.
export default function CareerGraph({ career, evidence, overall, readinessText, skills: analysis, actions = [], guidance, rules, refreshing = false }: Props) {
  const crowded = useMemo(() => isCrowded(career, evidence), [career, evidence]);
  const narrow = () => { try { return window.matchMedia('(max-width: 767px)').matches; } catch { return false; } };
  const [view, setView] = useState<'graph' | 'list'>(() => (crowded || narrow() ? 'list' : 'graph'));
  const [hover, setHover] = useState<string | null>(null);
  const [selRaw, setSel] = useState<string | null>(null);
  const [focusRaw, setFocus] = useState<string | null>(null);
  const [attention, setAttention] = useState(false);
  const refs = useRef(new Map<string, SVGGElement>());
  const wrap = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null);
  const [measured, setMeasured] = useState(DEFAULT_W);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => { const w = Math.round(entry.contentRect.width); if (w > 0) setMeasured(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  const W = Math.max(MIN_W, measured), unit = (W - PAD * 2) / WEIGHT.reduce((a, b) => a + b, 0);
  const colWs = WEIGHT.map((w) => w * unit), X = colWs.map((_, i) => PAD + colWs.slice(0, i).reduce((a, b) => a + b, 0));
  useEffect(() => { setSel(null); setHover(null); setFocus(null); }, [career.id]);

  const byId = useMemo(() => new Map(analysis.map((s) => [s.skillId, s])), [analysis]);
  const model = useMemo(() => buildGraphModel({ career, evidence, skills: analysis, actions, attentionOnly: attention }), [career, evidence, analysis, actions, attention]);
  const nodeById = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model]);
  // A selection whose node disappeared after fresh data (for example an action that is no longer needed) is dropped instead of showing stale details.
  const sel = selRaw && nodeById.has(selRaw) ? selRaw : null;
  const focusId = focusRaw && nodeById.has(focusRaw) ? focusRaw : sel ?? model.nodes[0]?.id ?? null;

  const layout = useMemo(() => {
    const cols = [0, 1, 2, 3, 4].map((c) => model.nodes.filter((n) => n.col === c));
    const H = graphHeight(cols.map((c) => c.length));
    const pos = new Map<string, { x: number; y: number }>();
    cols.forEach((col, ci) => col.forEach((n, i) => pos.set(n.id, { x: X[ci], y: ci === 0 ? H / 2 : columnY(H, col.length, i) })));
    return { H, pos };
  }, [model, W]);

  const active = hover ?? sel;
  const near = useMemo(() => { if (!active) return null; const s = new Set([active]); model.links.forEach((l) => { if (l.a === active) s.add(l.b); if (l.b === active) s.add(l.a); }); return s; }, [active, model.links]);
  const stateOf = (id: string) => { const a = byId.get(id); return a ? skillState(a) : null; };
  const actionById = (nid: string) => model.openActions.find((a) => actionNodeId(a) === nid);
  const open = model.openActions;
  const needAttention = analysis.filter((s) => skillState(s).tone !== 'ok').length;
  const select = (id: string) => {
    setSel(id); setFocus(id);
    // Below the wide layout the details sit under the graph: bring them into view so a click visibly does something.
    try { if (!window.matchMedia('(min-width: 1536px)').matches) panel.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); } catch { /* no layout APIs */ }
  };
  const go = (id: string, dir: Dir) => { const to = neighborId(model, id, dir); setFocus(to); refs.current.get(to)?.focus(); };

  const nodeLabel = (n: GNode): string => {
    if (n.kind === 'skill') { const st = stateOf(n.id); return st ? `${KIND_WORD.skill}: ${n.label}, ${st.label}` : `${KIND_WORD.skill}: ${n.label}`; }
    if (n.kind === 'action') { const a = actionById(n.id); return `${KIND_WORD.action}${a?.detail ? ` number ${a.detail.rank}` : ''}: ${n.label}${a ? `, ${a.priority} priority` : ''}`; }
    return `${KIND_WORD[n.kind]}: ${n.label}`;
  };
  // Characters that fit between a node and the next column; the full text stays in the tooltip, the accessible name and the details panel.
  const budget = (n: GNode) => Math.max(8, Math.floor((colWs[n.col] - R[n.kind] - 26) / CHAR_PX));
  const shortOf = (n: GNode) => (n.kind === 'action' ? `${actionById(n.id)?.detail ? `#${actionById(n.id)?.detail?.rank} ` : ''}${shortLabel(actionShortLabel(actionById(n.id) as Action, byId.get(actionById(n.id)?.relatedSkillIds[0] ?? '')?.name), budget(n) - (actionById(n.id)?.detail ? 3 : 0))}` : shortLabel(n.label, budget(n)));

  const skillBtn = (id: string, label?: string) => <button type="button" className="underline" onClick={() => select(id)}>{label ?? byId.get(id)?.name ?? id}</button>;

  const detail = () => {
    if (!sel) return <p className="text-mute">Select any item to see what it means for you.</p>;
    const n = nodeById.get(sel);
    if (!n) return null;
    if (n.kind === 'career') return <><b>{career.name}</b><p>Readiness {readinessText ?? `${overall}%`} across {career.capabilities.length} capabilities and {analysis.length} skills.</p><p className="text-mute">{needAttention} of {analysis.length} skills need attention (below target, evidence missing or thin, or not assessed). {open.length} open next action{open.length === 1 ? '' : 's'}.</p></>;
    if (n.kind === 'capability') {
      const c = career.capabilities.find((x) => x.id === sel)!;
      return <><b>{c.name}</b>{c.description && <p className="text-mute">{c.description}</p>}<ul className="mt-1 space-y-1">{c.skills.map((s) => { const st = stateOf(s.id); return <li key={s.id}>{skillBtn(s.id, s.name)}{st && <span className={`ml-2 ${TONE_TEXT[st.tone]}`}>{TONE_MARK[st.tone]} {st.label}</span>}</li>; })}</ul></>;
    }
    if (n.kind === 'skill') {
      const a = byId.get(sel);
      if (!a) return null;
      const p = skillPanel(a, evidence, actions, rules);
      return (
        <>
          <b>{p.name}</b> <span className="text-mute">in {p.capability}</span>
          <p><b className={TONE_TEXT[p.tone]}>{TONE_MARK[p.tone]} {p.label}</b> · {p.detail}</p>
          {p.whatIf && <p><b>What would change it:</b> {p.whatIf}</p>}
          <p><b>Evidence ({p.evidence.length}):</b> {p.evidence.length ? p.evidence.map((e, i) => <span key={e.id}>{i > 0 && '; '}{skillBtn(e.id, e.title)} ({STRENGTH_LABEL[e.strength as keyof typeof STRENGTH_LABEL]}, {e.provenance.toLowerCase()})</span>) : 'none linked yet'}</p>
          <p><b>Open actions:</b> {p.actions.length ? p.actions.map((x, i) => <span key={x.id}>{i > 0 && '; '}{open.some((o) => o.id === x.id) ? skillBtn(actionNodeId(x), x.title) : x.title}</span>) : p.assessed ? 'none needed right now' : 'none yet: rate this skill first'}</p>
          <Link className="font-semibold text-ember underline" to={`/skills/${encodeURIComponent(p.id)}`}>Open skill: full explanation, link or unlink evidence</Link>
        </>
      );
    }
    if (n.kind === 'action') {
      const a = actionById(sel);
      if (!a) return null;
      const x = explainAction(a, analysis, open.length, guidance);
      return (
        <>
          <b>{a.title}</b>
          <p className="text-mute">{x.rank !== null ? `Rank ${x.rank} of ${x.ofOpen} open actions · ` : ''}{x.priority} priority · status: {a.status.replace('_', ' ')}</p>
          {x.skill && <p><b>Addresses:</b> {skillBtn(x.skill.id, x.skill.name)}. <b className="font-semibold">{x.skill.label}.</b> {x.skill.detail}</p>}
          <div><b>Why it is ranked here</b><ul className="mt-1 list-disc space-y-1 pl-5">{x.whyRanked.map((t, i) => <li key={i}>{t}</li>)}</ul>
            {x.ruleText && <details className="mt-1 text-xs text-mute"><summary className="cursor-pointer">How actions are ranked</summary><p className="mt-1">{x.ruleText}</p></details>}</div>
          {x.doneWhen && <p><b>Done when:</b> {x.doneWhen}</p>}
          <div><b>Evidence that could show progress</b><ul className="mt-1 list-disc space-y-1 pl-5">{x.evidenceToProduce.map((e, i) => <li key={i}>{e.text} <span className="text-xs text-mute">({e.source})</span></li>)}</ul></div>
          <p className="text-xs text-mute">Ranks come from your own ratings and evidence. They are not deadlines or predictions.</p>
          <Link className="font-semibold text-ember underline" to="/roadmap">Open Roadmap to track this action</Link>
        </>
      );
    }
    const e = evidence.find((y) => y.id === sel);
    if (!e) return null;
    const supports = career.capabilities.flatMap((c) => c.skills).filter((s) => s.evidenceIds.includes(e.id));
    const pb = provenanceBadge(e);
    return (
      <>
        <b>{e.title}</b><p>{e.type} · {e.date ?? 'undated'} · {STRENGTH_LABEL[e.strength]} evidence</p>
        <p><b>{pb.text}.</b> <span className="text-mute">{pb.detail}</span></p>
        <p>Supports: {supports.length ? supports.map((s, i) => <span key={s.id}>{i > 0 && ', '}{skillBtn(s.id, s.name)}</span>) : 'no skills in this career yet'}.</p>
        <Link className="font-semibold text-ember underline" to="/evidence">Manage evidence</Link>
      </>
    );
  };

  const tab = (v: 'graph' | 'list', label: string) => (
    <button type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${view === v ? 'border-ember bg-ember text-ink' : 'border-line text-mute hover:border-ember'}`}>{label}</button>
  );
  const noSkills = analysis.length === 0 || career.capabilities.every((c) => c.skills.length === 0);

  return (
    <section className="card-dark" aria-labelledby="graph-h" aria-busy={refreshing}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="graph-h" className="text-lg font-semibold">Career action graph</h2>
          <p className="mb-2 max-w-2xl text-sm text-mute">Career → capabilities → skills → evidence → next actions. Select anything to see why. {crowded ? 'This career is large, so the list view is shown first.' : ''}</p></div>
        <div role="tablist" aria-label="Graph view" className="flex gap-2">{tab('graph', 'Graph')}{tab('list', 'List')}</div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-mute">
        <p aria-label="Summary">{analysis.length} skills · {needAttention} need attention · {open.length + model.hiddenActions} open action{open.length + model.hiddenActions === 1 ? '' : 's'}{model.completedActions ? ` · ${model.completedActions} marked complete` : ''}</p>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} /> Only skills that need attention</label>
        {refreshing && <p role="status" className="font-semibold text-ember">Updating with your latest changes…</p>}
      </div>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute" aria-label="Legend">
        {(['ok', 'below', 'evidence', 'unknown'] as SkillTone[]).map((t) => <li key={t}><span aria-hidden className={TONE_TEXT[t]}>{TONE_MARK[t]}</span> {({ ok: 'On track', below: 'Below target', evidence: 'Evidence missing or thin', unknown: 'Not assessed' })[t]}</li>)}
        <li><span aria-hidden className="text-ember">■</span> Next action, #1 = most important</li>
        <li><span aria-hidden>◆</span> Evidence · <span aria-hidden>●</span> career, capability, skill</li>
        <li><span aria-hidden>- - -</span> action addresses a skill</li>
      </ul>

      {noSkills ? (
        <div className="rounded-xl border border-line p-4 text-sm" role="status"><p className="font-semibold">This career has no skills defined yet.</p><p className="text-mute">Edit the career to add capabilities and skills, then rate them to see your graph.</p></div>
      ) : (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0" ref={wrap}>
            {attention && model.hiddenSkills === analysis.length && <p className="mb-2 rounded-lg border border-ok p-3 text-sm text-ok" role="status">Every skill is on track, so nothing needs attention. Untick the filter to see them all.</p>}
            {view === 'graph' ? (
              <div className="w-full min-w-0">
                {measured < 640 && <p className="mb-2 text-xs text-mute" role="note">The graph is drawn small on narrow screens. The List view shows the same information at full size.</p>}
                <svg viewBox={`0 0 ${W} ${layout.H}`} className="block h-auto w-full" role="group" aria-label="Career action graph. Use arrow keys to move between connected nodes, Enter to select, Escape to clear.">
                  {COLUMN_TITLES.map((t, i) => <text key={t} x={X[i] - 6} y={16} className="fill-[#d6c9ba]" fontSize={12} letterSpacing="0.08em">{measured < 640 ? t.slice(0, 5) : t}</text>)}
                  {model.links.map((l) => {
                    const A = layout.pos.get(l.a), B = layout.pos.get(l.b);
                    if (!A || !B) return null;
                    const on = active === l.a || active === l.b, dim = active && !on ? 0.3 : l.kind === 'addresses' ? 0.7 : 1;
                    return l.kind === 'addresses'
                      ? <path key={l.a + l.b} d={`M${A.x} ${A.y} C ${(A.x + B.x) / 2} ${A.y}, ${(A.x + B.x) / 2} ${B.y}, ${B.x} ${B.y}`} fill="none" stroke={on ? '#e0813f' : '#9a7350'} strokeWidth={on ? 2.5 : 1.5} strokeDasharray="5 4" opacity={dim} />
                      : <line key={l.a + l.b} x1={A.x} y1={A.y} x2={B.x} y2={B.y} className="transition-all" stroke={on ? '#e0813f' : '#75634f'} strokeWidth={on ? 2.5 : 1.5} opacity={dim} />;
                  })}
                  {model.nodes.map((n) => {
                    const p = layout.pos.get(n.id)!, st = n.kind === 'skill' ? stateOf(n.id) : null, a = n.kind === 'action' ? actionById(n.id) : undefined;
                    const fill = st ? TONE_FILL[st.tone] : a ? PRIORITY_FILL[a.priority] : FILL[n.kind], r = R[n.kind] + (sel === n.id ? 3 : 0);
                    return (
                      <g key={n.id} ref={(el) => { if (el) refs.current.set(n.id, el); else refs.current.delete(n.id); }} data-gid={n.id} tabIndex={n.id === focusId ? 0 : -1} role="button" aria-label={nodeLabel(n)} aria-pressed={sel === n.id} className="cursor-pointer transition-opacity" opacity={near && !near.has(n.id) ? 0.5 : 1}
                        onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onFocus={() => { setHover(n.id); setFocus(n.id); }} onBlur={() => setHover(null)} onClick={() => select(n.id)}
                        onKeyDown={(e) => {
                          const dir = KEY_DIR[e.key];
                          if (dir) { e.preventDefault(); go(n.id, dir); }
                          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n.id); }
                          else if (e.key === 'Escape') { setSel(null); }
                        }}>
                        {sel === n.id && <circle cx={p.x} cy={p.y} r={R[n.kind] + 8} fill="none" stroke="#e0813f" strokeWidth={2} />}
                        <title>{st ? `${n.label} · ${st.label}` : nodeLabel(n)}</title>
                        {n.kind === 'action'
                          ? <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={2} fill={fill} stroke={sel === n.id ? '#fff' : 'none'} strokeWidth={2} />
                          : n.kind === 'evidence'
                            ? <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={1} transform={`rotate(45 ${p.x} ${p.y})`} fill={fill} stroke={sel === n.id ? '#fff' : 'none'} strokeWidth={2} />
                            : <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke={sel === n.id ? '#fff' : st?.tone === 'evidence' ? '#f3ece3' : 'none'} strokeWidth={2} strokeDasharray={st?.tone === 'evidence' && sel !== n.id ? '3 2' : undefined} />}
                        <text x={p.x + R[n.kind] + 8} y={p.y + 4} fontSize={13} fontWeight={sel === n.id ? 700 : 400} className="fill-cream" stroke="#16100d" strokeWidth={3} paintOrder="stroke">{shortOf(n)}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : (
              <div className="space-y-4" aria-label="Career structure list">
                <p className="text-sm"><button type="button" className="font-semibold underline" onClick={() => select(career.id)} aria-pressed={sel === career.id}>{career.name}</button> <span className="text-mute">· {career.capabilities.length} capabilities</span></p>
                {career.capabilities.map((c) => {
                  const rows = c.skills.filter((s) => nodeById.has(s.id));
                  if (!rows.length) return null;
                  return (
                    <section key={c.id} aria-label={c.name}>
                      <h3 className="text-sm font-semibold"><button type="button" className="underline" onClick={() => select(c.id)} aria-pressed={sel === c.id}>{c.name}</button></h3>
                      <ul className="mt-1 divide-y divide-line rounded-xl border border-line">
                        {rows.map((s) => {
                          const st = stateOf(s.id), ev = evidence.filter((e) => s.evidenceIds.includes(e.id)), isOpen = sel === s.id, acts = open.filter((a) => a.relatedSkillIds.includes(s.id));
                          return (
                            <li key={s.id}>
                              <button type="button" aria-pressed={isOpen} onClick={() => select(s.id)} className={`flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm ${isOpen ? 'bg-ink/60' : ''}`}>
                                <span className="font-medium">{s.name}</span>
                                <span className="flex items-center gap-3 text-xs"><span className="text-mute">{ev.length} evidence{acts.length ? ` · ${acts.length} action${acts.length > 1 ? 's' : ''}` : ''}</span>{st && <span className={`font-semibold ${TONE_TEXT[st.tone]}`}>{TONE_MARK[st.tone]} {st.label}</span>}</span>
                              </button>
                              {isOpen && ev.length > 0 && <ul className="border-t border-line px-3 py-2 text-xs text-mute">{ev.map((e) => <li key={e.id}><button type="button" className="underline" onClick={() => select(e.id)}>{e.title}</button> · {STRENGTH_LABEL[e.strength]} · {provenanceBadge(e).text}</li>)}</ul>}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
                <section aria-label="Next actions in priority order">
                  <h3 className="text-sm font-semibold">Next actions, most important first</h3>
                  {open.length === 0 ? <p className="mt-1 text-sm text-mute">{analysis.some((s) => s.assessed) ? 'No open actions: nothing needs doing right now, or every action is marked complete.' : 'No actions yet: rate your skills first and CareerGraph will rank what to do next.'}</p> : (
                    <ol className="mt-1 divide-y divide-line rounded-xl border border-line">{open.map((a) => (
                      <li key={a.id}><button type="button" aria-pressed={sel === actionNodeId(a)} onClick={() => select(actionNodeId(a))} className={`flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm ${sel === actionNodeId(a) ? 'bg-ink/60' : ''}`}>
                        <span className="font-medium">{a.detail ? `#${a.detail.rank} ` : ''}{a.title}</span><span className="text-xs text-mute">{a.priority} priority · {a.status.replace('_', ' ')}</span></button></li>
                    ))}</ol>
                  )}
                  {model.hiddenActions > 0 && <p className="mt-1 text-xs text-mute">{model.hiddenActions} lower-ranked action{model.hiddenActions > 1 ? 's' : ''} not shown. <Link to="/roadmap" className="text-ember underline">See all in the Roadmap</Link>.</p>}
                </section>
              </div>
            )}
            {view === 'graph' && open.length === 0 && <p className="mt-2 text-xs text-mute" role="status">No open actions to draw: {analysis.some((s) => s.assessed) ? 'nothing needs doing right now, or every action is marked complete.' : 'rate your skills first and CareerGraph will rank what to do next.'}</p>}
            {evidence.length === 0 && <p className="mt-2 text-xs text-mute">You haven't added evidence yet, so no evidence nodes are shown. <Link to="/evidence" className="text-ember underline">Add evidence</Link></p>}
            {evidence.some((e) => e.source === 'example') && <p className="mt-2 text-xs text-mute">Evidence marked "Demo example" is sample data, not your own.</p>}
            {model.hiddenActions > 0 && view === 'graph' && <p className="mt-1 text-xs text-mute">Showing the top {open.length} actions; {model.hiddenActions} lower-ranked not drawn. <Link to="/roadmap" className="text-ember underline">See all in the Roadmap</Link>.</p>}
          </div>
          <aside ref={panel} className="min-w-0 space-y-2 self-start rounded-xl border border-line bg-ink/50 p-4 text-sm text-[#f3ece3] 2xl:sticky 2xl:top-4" aria-label="Details" aria-live="polite" data-testid="graph-panel">{detail()}</aside>
        </div>
      )}
      <p className="sr-only">Levels run from {LEVELS[0]} to {LEVELS[5]}.</p>
    </section>
  );
}
