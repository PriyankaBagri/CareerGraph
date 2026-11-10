import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { AiProvider, AiRequest } from '../server/src/ai/provider';
import { AiProviderError } from '../server/src/ai/provider';
import { NO_AI } from '../server/src/config';
import { makeApp } from '../server/tests/helpers';
import { ApiError, api } from '../src/services/api';
import { aiClient, friendlyAiError } from '../src/services/assistant';
import type { AssistantMessage } from '../src/types';
import { AI_MAX_TURNS, AI_TOTAL_CHARS, AI_TURN_CHARS, buildHistory } from '../src/utils/aiHistory';
import { resetStorage } from './helpers';

// FakeAi is a TEST DOUBLE used only in this file. The real client/route/validation/auth/readiness pipeline is real; only the model is faked.
class FakeAi implements AiProvider {
  readonly id = 'fake'; readonly label = 'Fake model (tests only)'; readonly model = 'fake-1';
  calls: AiRequest[] = []; reply: string | Error = 'Here is a plan.';
  async complete(r: AiRequest) { this.calls.push(r); if (this.reply instanceof Error) throw this.reply; return { text: this.reply }; }
}
const msg = (role: 'user' | 'assistant', text: string, error = false): AssistantMessage => ({ id: Math.random().toString(36), role, text, error });

describe('AI conversation history is trimmed to what the server accepts', () => {
  it('drops error bubbles and empty text, and starts on a user turn', () => {
    const h = buildHistory([msg('assistant', 'hi'), msg('user', 'q1'), msg('assistant', 'oops', true), msg('assistant', ' '), msg('assistant', 'a1'), msg('user', 'q2')]);
    assert.deepEqual(h.map((t) => t.content), ['q1', 'a1', 'q2']); assert.equal(h[0].role, 'user');
  });
  it('cuts each turn to the per-turn cap (long AI replies must not make the next question fail)', () => {
    const h = buildHistory([msg('user', 'q'), msg('assistant', 'x'.repeat(5000)), msg('user', 'follow-up')]);
    assert.equal(h[1].content.length, AI_TURN_CHARS);
  });
  it('keeps the newest turns within the turn-count and total-size caps', () => {
    const many = Array.from({ length: 40 }, (_, i) => msg(i % 2 === 0 ? 'user' : 'assistant', `m${i}-` + 'y'.repeat(1500)));
    const h = buildHistory(many);
    assert.ok(h.length <= AI_MAX_TURNS); assert.ok(h.reduce((n, t) => n + t.content.length, 0) <= AI_TOTAL_CHARS);
    assert.equal(h[0].role, 'user'); assert.ok(h[h.length - 1].content.startsWith('m38-') || h[h.length - 1].content.startsWith('m39-'));
  });
  it('always keeps the latest question even if it alone is large', () => {
    const h = buildHistory([msg('user', 'a'), msg('assistant', 'b'), msg('user', 'z'.repeat(1900))]);
    assert.equal(h[h.length - 1].content.length, 1900);
  });
});

describe('AI client against the real backend pipeline (model is a test double)', () => {
  let backend: ReturnType<typeof makeApp>, ai: FakeAi, real: typeof fetch, seen: { url: string; headers: Record<string, string>; body?: string }[];
  const boot = (aiProvider: AiProvider | null) => {
    backend = makeApp({ aiProvider, config: { ai: { ...NO_AI, provider: aiProvider ? 'anthropic' : null, apiKey: 'sk-NEVER-IN-BROWSER', model: 'm', ratePerMinute: 3 } } });
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url: String(url), headers: h, body: init?.body ? String(init.body) : undefined });
      const r = await backend.call(init?.method ?? 'GET', String(url).replace('http://api.test', ''), { body: init?.body ? JSON.parse(String(init.body)) : undefined, token: h.Authorization?.replace('Bearer ', ''), headers: {} });
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers['Retry-After'] ? { 'Retry-After': r.headers['Retry-After'] } : {}) } });
    }) as typeof fetch;
  };
  const signIn = async (email = 'a@x.com') => { const r = await backend.call('POST', '/api/auth/register', { body: { name: 'Ada', email, password: 'Passw0rdOK1' } }); api.setToken(r.body.token as string, false); return r.body.token as string; };
  const token = () => (localStorage.getItem('careergraph:token') ?? sessionStorage.getItem('careergraph:token')) as string;
  const CAREER_BODY = { name: 'Corporate Lawyer', category: 'Law', description: '', evidenceExpectations: [], capabilities: [{ name: 'C', description: '', skills: [{ name: 'Legal research', requiredLevel: 3, importance: 3 }, { name: 'Contract drafting', requiredLevel: 4, importance: 5 }] }] };
  const createCareer = async (t = token()) => ((await (await fetch('http://api.test/api/careers', { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify(CAREER_BODY) })).json()) as { career: { id: string } }).career.id;
  beforeEach(() => { resetStorage(); seen = []; real = globalThis.fetch; ai = new FakeAi(); api.setBase('http://api.test/api'); });
  afterEach(() => { globalThis.fetch = real; api.setToken(null); api.setBase(''); });

  it('is routed to the backend only when a base URL is set', () => {
    assert.equal(aiClient.enabled(), true); api.setBase(''); assert.equal(aiClient.enabled(), false);
  });
  it('status() reports available with provider/model and exposes no key', async () => {
    boot(ai); await signIn();
    const st = await aiClient.status();
    assert.deepEqual(st, { available: true, provider: 'fake', model: 'fake-1', reason: null });
    assert.ok(!JSON.stringify(seen).includes('sk-NEVER'));
  });
  it('status() reports unavailable (not a fake "available") when the server has no model', async () => {
    boot(null); await signIn();
    assert.deepEqual(await aiClient.status(), { available: false, provider: null, model: null, reason: 'not_configured' });
    await assert.rejects(aiClient.chat([{ role: 'user', content: 'hi' }]), (e: unknown) => e instanceof ApiError && e.code === 'ai_not_configured');
  });
  it('chat() sends the bearer token, the history and the target career, and returns an AI-labelled reply', async () => {
    boot(ai); await signIn();
    const r = await aiClient.chat([{ role: 'user', content: 'What first?' }], 'swe');
    assert.equal(r.message.content, 'Here is a plan.'); assert.equal(r.generated, true); assert.equal(r.grounding?.careerId, 'swe');
    const call = seen[seen.length - 1]; assert.equal(call.url, 'http://api.test/api/assistant/chat'); assert.match(call.headers.Authorization, /^Bearer /);
    assert.deepEqual(JSON.parse(call.body ?? '{}'), { messages: [{ role: 'user', content: 'What first?' }], careerId: 'swe' });
    assert.equal(ai.calls.length, 1);
  });
  it('a signed-out request is rejected by the server (401), the model is never called', async () => {
    boot(ai); await backend.call('POST', '/api/auth/register', { body: { name: 'Ada', email: 'a@x.com', password: 'Passw0rdOK1' } });
    await assert.rejects(aiClient.chat([{ role: 'user', content: 'hi' }]), (e: unknown) => e instanceof ApiError && e.status === 401);
    assert.equal(ai.calls.length, 0);
  });
  it("another user's career id is refused (404) end to end", async () => {
    boot(ai); await signIn('a@x.com');
    const id = ((await (await fetch('http://api.test/api/careers', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('careergraph:token') ?? sessionStorage.getItem('careergraph:token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Private Career', category: 'X', description: '', evidenceExpectations: [], capabilities: [{ name: 'C', description: '', skills: [{ name: 'S', requiredLevel: 3, importance: 3 }] }] }) })).json()) as { career: { id: string } }).career.id;
    await signIn('b@x.com');
    await assert.rejects(aiClient.chat([{ role: 'user', content: 'hi' }], id), (e: unknown) => e instanceof ApiError && e.status === 404 && e.code === 'career_not_found');
    assert.equal(ai.calls.length, 0);
  });
  it('long histories built by buildHistory are always accepted by the server', async () => {
    boot(ai); await signIn(); ai.reply = 'y'.repeat(2600); // a long AI reply
    const log: AssistantMessage[] = [];
    for (let i = 0; i < 6; i++) { log.push(msg('user', `question ${i} ` + 'q'.repeat(900))); const r = await aiClient.chat(buildHistory(log), 'swe'); log.push(msg('assistant', r.message.content)); backend.clock.ms += 61_000; }
    assert.equal(log.length, 12);
  });
  it('friendlyAiError maps every server code to plain language and never echoes raw details', () => {
    const e = (status: number, code: string) => friendlyAiError(new ApiError(status, code, 'RAW SERVER TEXT sk-SECRET'));
    assert.match(e(429, 'rate_limited'), /quickly/); assert.match(e(504, 'ai_timeout'), /too long/); assert.match(e(502, 'ai_unavailable'), /could not answer/); assert.match(e(503, 'ai_busy'), /busy right now.*try again later/);
    assert.match(e(503, 'ai_not_configured'), /not configured/); assert.match(e(0, 'network_error'), /reach the server/); assert.match(e(401, 'token_expired'), /sign in/);
    assert.match(e(404, 'career_not_found'), /isn't available/); assert.match(friendlyAiError(new Error('x')), /try again/);
    assert.match(e(502, 'ai_invalid_output'), /could not be used/); assert.match(e(400, 'no_actions_available'), /no open actions/);
    for (const [s, c] of [[429, 'rate_limited'], [500, 'x'], [400, 'validation_failed']] as const) assert.ok(!/SECRET|RAW/.test(e(s, c)));
  });
  it('rate limiting surfaces as a clear error and no fallback answer is produced', async () => {
    boot(ai); await signIn();
    for (let i = 0; i < 3; i++) await aiClient.chat([{ role: 'user', content: 'hi' }]);
    await assert.rejects(aiClient.chat([{ role: 'user', content: 'hi' }]), (e: unknown) => e instanceof ApiError && e.status === 429 && /quickly/.test(friendlyAiError(e)));
    assert.equal(ai.calls.length, 3);
  });
  it('an upstream model failure is an error, not a canned answer', async () => {
    boot(ai); await signIn(); ai.reply = new AiProviderError('upstream_error', 500);
    await assert.rejects(aiClient.chat([{ role: 'user', content: 'hi' }]), (e: unknown) => e instanceof ApiError && e.status === 502);
  });

  // plan() — real ids from the real backend (never invented by the test), joined client-side against the real `actions` list.
  const actionIds = async (careerId: string) => ((await (await fetch(`http://api.test/api/careers/${careerId}/actions`, { headers: { Authorization: `Bearer ${token()}` } })).json()) as { actions: { id: string }[] }).actions.map((a) => a.id);
  const validReply = (ids: string[]) => JSON.stringify({ weeks: [{ week: 1, focus: 'Build the foundation', actionIds: [ids[0]], rationale: 'Highest-priority gap right now.' }] });

  it('plan() resolves an AI-generated plan into real action details, correctly labelled as AI-generated', async () => {
    boot(ai); await signIn(); const careerId = await createCareer(); const ids = await actionIds(careerId);
    ai.reply = validReply(ids);
    const r = await aiClient.plan(careerId);
    assert.equal(r.source, 'ai'); assert.equal(r.unverified, true); assert.ok(r.provider);
    assert.equal(r.weeks.length, 1); assert.equal(r.weeks[0].actions.length, 1);
    assert.equal(r.weeks[0].actions[0].id, ids[0]); assert.ok(r.weeks[0].actions[0].skillName);
  });

  it('plan() falls back to a rule-based plan, truthfully labelled, when no AI is configured', async () => {
    boot(null); await signIn(); const careerId = await createCareer(); const ids = await actionIds(careerId);
    const r = await aiClient.plan(careerId);
    assert.equal(r.source, 'rule_based'); assert.equal(r.unverified, false); assert.equal(r.provider, null);
    assert.match(r.notice, /not AI-generated/);
    assert.deepEqual(r.weeks.flatMap((w) => w.actions.map((a) => a.id)), ids); // every id real, none invented
  });

  it('plan() surfaces malformed AI output as a real error, never a fake plan', async () => {
    boot(ai); await signIn(); const careerId = await createCareer();
    ai.reply = 'not json at all';
    await assert.rejects(aiClient.plan(careerId), (e: unknown) => e instanceof ApiError && e.status === 502 && e.code === 'ai_invalid_output');
  });

  it("plan() refuses another user's career id (404) and never calls the model", async () => {
    boot(ai); await signIn('a@x.com'); const careerId = await createCareer();
    await signIn('b@x.com');
    await assert.rejects(aiClient.plan(careerId), (e: unknown) => e instanceof ApiError && e.status === 404 && e.code === 'career_not_found');
    assert.equal(ai.calls.length, 0);
  });
});

describe('browser code never holds a model credential or calls a vendor', () => {
  it('has no vendor URL, key header or key variable in any frontend source', () => {
    for (const f of ['src/services/assistant/aiClient.ts', 'src/services/assistant.ts', 'src/pages/Assistant.tsx', 'src/components/ai/WeeklyPlan.tsx', 'src/utils/aiHistory.ts', 'src/services/api.ts', 'vite.config.ts']) {
      const src = readFileSync(f, 'utf8');
      assert.ok(!/api\.anthropic\.com|api\.openai\.com|x-api-key|AI_API_KEY|VITE_AI|apiKey/i.test(src), f);
    }
  });
  it('the page labels the engine truthfully and has no code path that substitutes rules after an AI failure', () => {
    const src = readFileSync('src/pages/Assistant.tsx', 'utf8');
    assert.match(src, /not an AI model/); assert.match(src, /AI-generated/);
    const send = src.slice(src.indexOf('async function send'), src.indexOf('const submit'));
    assert.ok(/if \(mode\.kind === 'ai'\)[\s\S]*?\} else \{[\s\S]*?assistantService\.ask/.test(send), 'rules only in the non-AI branch');
    assert.ok(!/catch[\s\S]*assistantService\.ask/.test(send), 'catch must not call the rules engine');
  });
  it('the weekly plan never turns a failed build into a fake "ready" plan, and labels source truthfully', () => {
    const src = readFileSync('src/components/ai/WeeklyPlan.tsx', 'utf8');
    assert.match(src, /AI-generated plan/); assert.match(src, /Rule-based starter plan/);
    const build = src.slice(src.indexOf('async function build'), src.indexOf('return ('));
    const tryCatch = build.slice(build.indexOf('try {'));
    assert.ok(!/catch[\s\S]*kind: 'ready'/.test(tryCatch), "catch must not set state to 'ready'");
    assert.match(tryCatch, /catch[\s\S]*kind: 'empty'[\s\S]*kind: 'error'/, 'a failure is either the explicit empty state or an error, never silently dropped');
  });
});
