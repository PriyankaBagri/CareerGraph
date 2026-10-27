import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import EvidenceForm from '../components/evidence/EvidenceForm';
import LevelCompare from '../components/skills/LevelCompare';
import LevelEditor from '../components/skills/LevelEditor';
import SkillExplanation from '../components/skills/SkillExplanation';
import Disclosure from '../components/ui/Disclosure';
import Skeleton from '../components/ui/Skeleton';
import { useAuth } from '../context/AuthContext';
import { useEvidence } from '../context/EvidenceContext';
import { useCareerAnalysis } from '../hooks/useCareerAnalysis';
import { useProfile } from '../hooks/useProfile';
import type { Evidence, EvidenceInput } from '../types';
import { COVERAGE_LABEL, STRENGTH_LABEL } from '../utils/constants';
import { linkError, linkableEvidence } from '../utils/evidenceLink';
import { provenanceBadge } from '../utils/provenance';
import { LEVELS } from '../utils/readiness';
import { LEVEL_MEANING, splitSkillText } from '../utils/skillText';

export default function SkillDetail() {
  const { id = '' } = useParams();
  const me = useProfile();
  const { view, actions, error, retry } = useCareerAnalysis(me?.profile.targetCareerId ?? '');
  const { updateSkillLevel } = useAuth();
  const ev = useEvidence();
  const [form, setForm] = useState<{ edit?: Evidence } | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [linkMsg, setLinkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pick, setPick] = useState('');
  const s = view?.skills.find((x) => x.skillId === id);
  const back = <Link to="/skills" className="text-sm text-ember underline">← All skills</Link>;

  if (error) return <div className="card-dark" role="alert"><p className="font-semibold">We couldn't load this skill right now.</p><button className="btn mt-3" onClick={retry}>Try again</button></div>;
  if (!view) return <Skeleton className="h-96" />;
  if (!s) return <div className="card-dark"><p className="font-semibold">We couldn't find that skill in your current career.</p><p className="mt-1">{back}</p></div>;

  const cap = view.career.capabilities.find((c) => c.id === s.capabilityId);
  const save = async (input: EvidenceInput) => { if (form?.edit) await ev.update(form.edit.id, input); else await ev.create(input); setForm(null); };
  const rules = view.readiness.backend?.evaluation?.rules;
  const skillId = s.skillId, skillName = s.name; // captured after the `!s` guard: narrowing does not carry into the hoisted async function below
  const linkable = linkableEvidence(ev.items, skillId);
  async function changeLink(e: Evidence, link: boolean) {
    if (linkBusy) return; // one change at a time: a double click must not send two requests
    setLinkBusy(e.id); setLinkMsg(null);
    try { await ev.setSkillLink(e, skillId, link); setPick(''); setLinkMsg({ ok: true, text: link ? `Linked "${e.title}" to ${skillName}. Your readiness has been recalculated.` : `Unlinked "${e.title}" from ${skillName}. Your readiness has been recalculated.` }); }
    catch (err) { const r = linkError(err, link); setLinkMsg({ ok: false, text: r.message }); if (r.gone) ev.reload(); }
    finally { setLinkBusy(null); }
  }
  const text = splitSkillText(cap?.skills.find((k) => k.id === skillId)?.description);
  const expected = view.guidance?.evidenceExpectations ?? [];
  const evGap = s.status === 'evidence_gap' || s.status === 'combined_gap';

  const related = (actions ?? []).filter((a) => a.relatedSkillIds.includes(s.skillId) && a.status !== 'completed').slice(0, 2);
  const improve = !s.assessed ? 'You have not rated this skill yet, so CareerGraph cannot tell where you stand. Choose your level above.'
    : [s.skillGap > 0 ? `Your level (${LEVELS[s.currentLevel]}) is ${s.skillGap} level${s.skillGap > 1 ? 's' : ''} below the expected ${LEVELS[s.requiredLevel]}.` : '', evGap ? (s.evidenceCount ? `Your evidence is thin (${COVERAGE_LABEL[s.coverage].toLowerCase()} coverage).` : 'No evidence is recorded yet.') : ''].filter(Boolean).join(' ') || 'You meet the expected level and have enough evidence for this skill.';

  return (
    <div className="animate-rise space-y-6">
      <header>
        {back}
        <h1 className="mt-2 text-3xl font-semibold">{s.name}</h1>
        <p className="mt-1 text-mute">{s.capabilityName} · {s.careerName}</p>
      </header>

      <section className="card" aria-labelledby="mean-h" data-testid="skill-meaning">
        <h2 id="mean-h" className="text-lg font-semibold">What this skill means</h2>
        <p className="mt-1 text-sm">{text.description || 'This career model does not describe this skill yet. Ask the assistant, or edit a custom career to add a description.'}</p>
        <p className="mt-2 text-sm"><b>How to demonstrate it:</b> {text.evidenceNote || (expected.length ? `Real work that shows this skill, for example: ${expected.slice(0, 2).join('; ')}.` : 'Real work that shows this skill, such as a project, a write-up or a course result. Evidence you add yourself is shown as unverified.')}</p>
        <p className="mt-2 text-sm"><Link to={`/assistant?skill=${encodeURIComponent(s.skillId)}`} className="text-ember underline">Ask the assistant about this skill</Link></p>
      </section>

      <section className="card" aria-labelledby="lv-h">
        <h2 id="lv-h" className="mb-3 text-lg font-semibold">Your level and the expected level</h2>
        <LevelCompare required={s.requiredLevel} current={s.currentLevel} assessed={s.assessed} />
        <LevelEditor key={`${s.currentLevel}-${s.assessed}`} current={s.currentLevel} assessed={s.assessed} onSave={(l) => updateSkillLevel(s.skillId, l)} />
      </section>

      <section className="card" aria-labelledby="ec-h">
        <h2 id="ec-h" className="text-lg font-semibold">Your evidence</h2>
        {s.evidenceCount > 0 && <p className="mt-1 text-sm text-bark2">{s.evidenceCount} piece{s.evidenceCount === 1 ? '' : 's'} · strongest: {s.strongest ? STRENGTH_LABEL[s.strongest] : 'none'} · {COVERAGE_LABEL[s.coverage].toLowerCase()} coverage</p>}
        {s.evidenceCount === 0 ? (
          <p className="mt-3 text-sm text-bark2">No evidence is linked to this skill yet. That only means nothing is recorded; it does not mean you lack the skill.</p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {s.evidence.map((e) => {
              const pb = provenanceBadge(e), pts = rules?.strengthPoints?.[e.strength];
              return (
                <li key={e.id} className="rounded-xl border border-sand p-3">
                  <p className="font-semibold">{e.title}</p>
                  <p className="text-sm text-bark2">{e.type} · {STRENGTH_LABEL[e.strength]}{pts !== undefined ? ` (${pts} pt${pts === 1 ? '' : 's'})` : ''}{e.date ? ` · ${e.date}` : ''}{e.organization ? ` · ${e.organization}` : ''}</p>
                  <p className="text-xs text-bark2" title={pb.detail}>{pb.text}</p>
                  {e.source === 'user' ? (
                    <div className="mt-2 flex flex-wrap gap-3 text-sm">
                      <button className="text-ember underline" onClick={() => setForm({ edit: e })}>View / edit</button>
                      <button className="text-ember underline disabled:opacity-50" disabled={linkBusy !== null} onClick={() => void changeLink(e, false)} aria-label={`Unlink ${e.title} from ${s.name}`}>{linkBusy === e.id ? 'Unlinking…' : 'Unlink from this skill'}</button>
                    </div>
                  ) : <p className="mt-1 text-xs text-warn">Demo example (read-only)</p>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-sand pt-3">
          <button className="btn" onClick={() => setForm({})}>Add new evidence</button>
          {linkable.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm"><span className="block text-bark2">Or link evidence you already have</span>
                <select value={pick} onChange={(e) => setPick(e.target.value)} className="mt-1 rounded-lg border border-sand bg-white px-2 py-1.5 text-bark" disabled={linkBusy !== null}>
                  <option value="">Choose evidence…</option>{linkable.map((e) => <option key={e.id} value={e.id}>{e.title} ({STRENGTH_LABEL[e.strength]})</option>)}
                </select></label>
              <button className="btn" disabled={!pick || linkBusy !== null} onClick={() => { const e = linkable.find((x) => x.id === pick); if (e) void changeLink(e, true); }}>{linkBusy && linkBusy === pick ? 'Linking…' : 'Link to this skill'}</button>
            </div>
          )}
        </div>
        {linkMsg && <p role={linkMsg.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${linkMsg.ok ? 'text-ok' : 'text-bad'}`}>{linkMsg.ok ? '✓ ' : '⚠ '}{linkMsg.text}</p>}
        <p className="mt-3 text-sm"><Link to="/evidence" className="text-ember underline">Open Evidence library</Link></p>
      </section>

      <section className="card-dark" aria-labelledby="na-h">
        <h2 id="na-h" className="text-lg font-semibold">What you can improve</h2>
        <p className="mt-1 text-sm">{improve}</p>
        <p className="mt-3 text-xl font-semibold">{s.nextAction}</p>
        {related.length > 0 && <ul className="mt-3 space-y-1 text-sm">{related.map((a) => <li key={a.id}>{a.title} <span className="text-mute">· {a.detail?.guidance ? `${a.detail.guidance.effort.text} (estimate)` : a.estimatedTime}</span></li>)}</ul>}
        {related.length > 0 && <p className="mt-3 text-sm"><Link to="/roadmap" className="text-ember underline">See the steps on the roadmap</Link></p>}
      </section>

      <Disclosure title="What the expected level means" hint="CareerGraph's own self-rating scale">
        <p className="text-sm">This career expects {LEVELS[s.requiredLevel]} ({s.requiredLevel}/5): {LEVEL_MEANING[s.requiredLevel]} <span className="text-bark2">This is CareerGraph's own scale for self-rating, not an industry standard.</span>{cap ? ` It is one of ${cap.skills.length} skill${cap.skills.length > 1 ? 's' : ''} in ${s.capabilityName}.` : ''}</p>
      </Disclosure>
      <Disclosure title="Why this assessment" hint="how the status was worked out"><SkillExplanation skill={s} rules={rules} /></Disclosure>

      {form && <EvidenceForm initial={form.edit} presetSkillIds={[s.skillId]} capabilities={view.career.capabilities} onClose={() => setForm(null)} onSave={save} />}
    </div>
  );
}
