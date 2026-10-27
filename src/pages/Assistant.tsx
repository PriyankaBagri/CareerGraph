import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Skeleton from '../components/ui/Skeleton';
import { useCareerAnalysis } from '../hooks/useCareerAnalysis';
import { useProfile } from '../hooks/useProfile';
import { aiClient, assistantService, friendlyAiError } from '../services/assistant';
import { buildHistory } from '../utils/aiHistory';
import { useSettings } from '../hooks/useSettings';
import type { AssistantMessage } from '../types';
import { buildAssistantContext } from '../utils/assistant';

// Which engine answers is decided by the SERVER (it holds the model credentials). There is never a silent switch: a failed AI call shows an error.
type Mode = { kind: 'checking' } | { kind: 'ai'; label: string; model: string } | { kind: 'rules'; why: 'local' | 'not_configured' | 'misconfigured' | 'unknown' };
const WHY: Record<'local' | 'not_configured' | 'misconfigured' | 'unknown', string> = {
  local: 'AI answers need the CareerGraph server, which is not connected in this mode.',
  not_configured: 'No AI model is configured on this server (see the README, "AI assistant").',
  misconfigured: "The server's AI settings are incomplete, so the AI model is switched off.",
  unknown: "Couldn't check whether an AI model is available.",
};

export default function Assistant() {
  const [mode, setMode] = useState<Mode>(() => (aiClient.enabled() ? { kind: 'checking' } : { kind: 'rules', why: 'local' }));
  const [statusTry, setStatusTry] = useState(0);
  useEffect(() => {
    if (!aiClient.enabled()) { setMode({ kind: 'rules', why: 'local' }); return; }
    let live = true;
    setMode({ kind: 'checking' });
    aiClient.status().then((st) => { if (live) setMode(st.available ? { kind: 'ai', label: st.provider ?? 'AI', model: st.model ?? '' } : { kind: 'rules', why: st.reason ?? 'not_configured' }); })
      .catch(() => { if (live) setMode({ kind: 'rules', why: 'unknown' }); });
    return () => { live = false; };
  }, [statusTry]);
  const [params] = useSearchParams();
  const me = useProfile();
  const targetId = me?.profile.targetCareerId ?? '';
  const { view, actions, roadmap, error, retry } = useCareerAnalysis(targetId);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const counter = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const showSuggestions = useSettings().settings.assistantSuggestions;
  const ctx = useMemo(() => (view && actions && roadmap && me ? buildAssistantContext(view, actions, roadmap, me.profile) : null), [view, actions, roadmap, me]);

  useEffect(() => { document.title = 'Assistant · CareerGraph'; }, []);
  useEffect(() => { setMessages([]); }, [targetId]); // a conversation belongs to one target career
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [messages, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || !ctx || busy || mode.kind === 'checking') return;
    const id = () => `m${++counter.current}`;
    setInput(''); setBusy(true);
    const userMsg: AssistantMessage = { id: id(), role: 'user', text: q };
    setMessages((m) => [...m, userMsg]);
    try {
      if (mode.kind === 'ai') {
        const skillId = view?.skills.some((k) => k.skillId === params.get('skill')) ? params.get('skill') ?? undefined : undefined; // only a skill of the current career
        const r = await aiClient.chat(buildHistory([...messages, userMsg]), targetId || undefined, { page: 'assistant', skillId });
        setMessages((m) => [...m, { id: id(), role: 'assistant', text: r.message.content, ai: { label: r.provider.label, model: r.provider.model, notice: r.notice, basedOn: r.grounding?.careerName ?? null } }]);
      } else {
        const a = await assistantService.ask(q, ctx);
        setMessages((m) => [...m, { id: id(), role: 'assistant', text: a.text, references: a.references, items: a.items }]);
      }
    } catch (e) {
      const text = mode.kind === 'ai' ? friendlyAiError(e) : "I couldn't answer that right now. Please try again.";
      setMessages((m) => [...m, { id: id(), role: 'assistant', text, error: true }]);
    } finally { setBusy(false); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void send(input); };

  if (error) return <div className="card-dark" role="alert"><p className="font-semibold">We couldn't load your CareerGraph for the assistant.</p><button className="btn mt-3" onClick={retry}>Try again</button></div>;
  if (!ctx) return <Skeleton className="h-96" />;
  const p = assistantService.provider;
  return (
    <div className="animate-rise space-y-4">
      <header>
        <p className="eyebrow">Career assistant</p>
        <h1 className="text-3xl font-semibold">Ask about your career plan</h1>
        <p className="mt-1 max-w-2xl text-mute">{mode.kind === 'ai' ? `Ask about your ${ctx.careerName} skills, evidence, readiness, gaps and roadmap. Answers use your CareerGraph data and can be wrong. Questions outside career planning are politely redirected.` : `Without an AI model this can only explain your saved ${ctx.careerName} data: readiness, gaps, evidence and next steps. Open-ended questions need an AI model.`}</p>
        <p className="mt-2 inline-block rounded-lg px-0 py-1 text-xs text-mute" role="status" data-testid="assistant-engine">
          {mode.kind === 'checking' && 'Checking which assistant is available…'}
          {mode.kind === 'ai' && `AI model: ${mode.label}${mode.model ? ` (${mode.model})` : ''}. Replies are AI-generated and not verified.`}
          {mode.kind === 'rules' && `${p.label}. This is not an AI model. ${WHY[mode.why]}`}
          {mode.kind === 'rules' && mode.why === 'unknown' && <button type="button" className="ml-2 underline" onClick={() => setStatusTry((n) => n + 1)}>Check again</button>}
        </p>
      </header>

      <section className="card-dark" aria-label="Conversation">
        <div className="max-h-[28rem] min-h-[10rem] space-y-3 overflow-y-auto pr-1" aria-live="polite">
          {messages.length === 0 && <p className="text-mute">{mode.kind === 'ai' ? 'Try a suggestion below, or type your own question.' : 'Pick a suggestion below, or ask about your readiness, gaps, evidence or next steps.'}</p>}
          {messages.map((m) => (
            <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm ${m.role === 'user' ? 'bg-ember text-ink' : m.error ? 'border border-bad' : 'bg-cream text-bark'}`}>
                <p className="whitespace-pre-wrap"><span className="sr-only">{m.role === 'user' ? 'You: ' : m.ai ? 'AI assistant: ' : 'Assistant: '}</span>{m.text}</p>
                {m.ai && <p className="mt-2 text-[11px] text-bark2">AI-generated{m.ai.basedOn ? ` · your ${m.ai.basedOn} data was available as context` : ' · no CareerGraph data was available'}. AI answers are not verified and may contain mistakes.</p>}
                {m.items && m.items.length > 0 && (
                  <ul className="mt-2 space-y-2">{m.items.map((it, i) => (
                    <li key={i} className="rounded-lg border border-sand bg-white/60 p-2">
                      <span className="text-[11px] uppercase tracking-wide text-bark2">{it.kind}</span>
                      <p className="font-semibold">{it.href ? <Link to={it.href} className="underline">{it.title}</Link> : it.title}</p>
                      {it.detail && <p className="text-bark2">{it.detail}</p>}
                    </li>))}</ul>
                )}
                {!m.items?.length && m.references && m.references.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2 text-xs">{m.references.map((r, i) => <li key={i}>{r.href ? <Link to={r.href} className="rounded-full border border-sand px-2 py-0.5 text-bark2 underline">{r.label}</Link> : <span className="rounded-full border border-sand px-2 py-0.5 text-bark2">{r.label}</span>}</li>)}</ul>
                )}
              </div>
            </div>
          ))}
          {busy && <p role="status" className="text-sm text-mute">Working out an answer…</p>}
          <div ref={end} />
        </div>
        {showSuggestions && mode.kind !== 'checking' && <div className="mt-3 flex flex-wrap gap-2" aria-label="Suggested questions">{(mode.kind === 'ai' ? [`What skills should a beginner in ${ctx.careerName} focus on first?`, ...assistantService.suggestedPrompts(ctx).slice(0, 3)] : assistantService.suggestedPrompts(ctx).slice(0, 4)).map((s) => <button key={s} type="button" disabled={busy} className="rounded-full border border-line px-3 py-1 text-sm hover:border-ember disabled:opacity-50" onClick={() => void send(s)}>{s}</button>)}</div>}
        <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="ask" className="sr-only">Your question</label>
          <input id="ask" value={input} onChange={(e) => setInput(e.target.value)} maxLength={mode.kind === 'ai' ? 1000 : 300} placeholder={mode.kind === 'ai' ? 'Ask about a career, a skill, or your own plan…' : 'Ask about your readiness, gaps, evidence or next steps…'} className="w-full rounded-lg border border-line bg-ink px-4 py-3" />
          <button className="btn" disabled={busy || mode.kind === 'checking' || !input.trim()}>{busy ? 'Thinking…' : 'Send'}</button>
        </form>
      </section>
    </div>
  );
}
