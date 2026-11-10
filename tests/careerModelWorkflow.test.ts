import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeApp } from '../server/tests/helpers';
import { NO_AI } from '../server/src/config';
import { AiProviderError, type AiProvider, type AiRequest } from '../server/src/ai/provider';
import { ApiError, _setInsideViteForTests, api, appMode, resolveMode } from '../src/services/api';
import { authService, AuthError } from '../src/services/auth';
import { coreApi, toCareer } from '../src/services/coreApi';
import { draftProblems, draftToApiInput, friendlyDraftError, requestAiDraft, saveDraft, SOURCE_LABEL, templateDraft, type DraftModel } from '../src/services/careerDraft';
import { resetStorage } from './helpers';

// REAL frontend services + REAL backend pipeline over in-memory repositories with a fake fetch (and a FakeAi test double). Not PostgreSQL, not a browser.
class FakeAi implements AiProvider {
  readonly id = 'fake'; readonly label = 'Fake model (tests only)'; readonly model = 'fake-1'; calls: AiRequest[] = []; reply: string | Error = '';
  async complete(r: AiRequest) { this.calls.push(r); if (this.reply instanceof Error) throw this.reply; return { text: this.reply }; }
}
const skill = (n: string) => ({ name: n, description: `Plain words about ${n}.`, requiredLevel: 3, importance: 4, evidenceExpectation: `A project showing ${n}.` });
const cap = (n: string) => ({ name: n, description: `About ${n}.`, skills: [skill(`${n} one`), skill(`${n} two`)] });
const GOOD = { name: 'Data Analyst', description: 'Turns data into decisions.', capabilities: [cap('Querying'), cap('Statistics'), cap('Communication')] };
let backend: ReturnType<typeof makeApp>, ai: FakeAi, real: typeof fetch, urls: string[], offline = false;
beforeEach(() => {
  resetStorage(); ai = new FakeAi(); ai.reply = JSON.stringify(GOOD); urls = []; offline = false; real = globalThis.fetch;
  backend = makeApp({ now: () => new Date(), aiProvider: ai, config: { ai: { ...NO_AI, provider: 'anthropic', apiKey: 'k', model: 'm', ratePerMinute: 50 } } });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (offline) throw new TypeError('Failed to fetch');
    urls.push(String(url)); const h = (init?.headers ?? {}) as Record<string, string>;
    const r = await backend.call(init?.method ?? 'GET', String(url).replace('http://api.test', ''), { body: init?.body ? JSON.parse(String(init.body)) : undefined, token: h.Authorization?.replace('Bearer ', '') });
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  api.setBase('http://api.test/api');
});
afterEach(() => { globalThis.fetch = real; api.setToken(null); api.setBase(''); _setInsideViteForTests(null); });

describe('explicit backend / demo / unconfigured mode', () => {
  it('resolves the mode from the base URL and the explicit demo flag only', () => {
    assert.equal(resolveMode('http://x/api', false, true), 'backend');
    assert.equal(resolveMode('http://x/api', true, true), 'backend'); // a configured backend wins over the demo flag
    assert.equal(resolveMode('', true, true), 'demo');
    assert.equal(resolveMode('', false, true), 'unconfigured'); // a Vite build with no URL and no demo flag must NOT become demo
    assert.equal(resolveMode('', false, false), 'demo'); // outside Vite (the Node test runner)
  });
  it('with the API URL set the app is in backend mode and talks to the server', async () => {
    assert.equal(appMode(), 'backend'); await authService.signUp('Ada', 'a@x.com', 'Passw0rdOK1');
    assert.ok(urls.some((u) => u === 'http://api.test/api/auth/register'));
  });
  it('unconfigured: sign-in and sign-up are refused, no request is made, and a leftover demo session does not sign anyone in', async () => {
    api.setBase(''); _setInsideViteForTests(true); assert.equal(appMode(), 'unconfigured');
    localStorage.setItem('careergraph:session', JSON.stringify({ userId: 'u1' }));
    await assert.rejects(authService.login('alex@example.com', 'Password1'), AuthError);
    await assert.rejects(authService.signUp('A', 'a@x.com', 'Passw0rdOK1'), AuthError);
    assert.equal(authService.getCurrentUser(), null); assert.equal(urls.length, 0);
  });
  it('demo mode (explicit) still lets the demo account in locally', async () => {
    api.setBase(''); _setInsideViteForTests(false); assert.equal(appMode(), 'demo');
    await authService.signUp('Ada', 'demo@x.com', 'Passw0rdOK1'); assert.equal(authService.getCurrentUser()?.email, 'demo@x.com'); assert.equal(urls.length, 0);
  });
  it('an unreachable server is a connection error: nobody is signed in and the demo account does not work', async () => {
    offline = true;
    await assert.rejects(authService.login('alex@example.com', 'Password1'), (e: unknown) => e instanceof AuthError && /Could not reach the server/.test(e.message));
    assert.equal(authService.getCurrentUser(), null);
  });
  it('tells a wrong password (401) apart from a network failure and a server error', async () => {
    await authService.signUp('Ada', 'a@x.com', 'Passw0rdOK1'); await authService.logout();
    await assert.rejects(authService.login('a@x.com', 'WrongPass99x'), (e: unknown) => e instanceof AuthError && !/reach/.test(e.message));
    offline = true; await assert.rejects(authService.login('a@x.com', 'Passw0rdOK1'), (e: unknown) => e instanceof AuthError && /reach/.test(e.message));
  });
});

describe('AI career draft flow (frontend service + real backend)', () => {
  const token = async () => { await authService.signUp('Ada', 'a@x.com', 'Passw0rdOK1'); };
  it('returns an AI draft labelled as such and persists nothing', async () => {
    await token(); const d = await requestAiDraft({ name: 'Data Analyst', category: 'Data', description: '' });
    assert.equal(d.source, 'ai'); assert.equal(d.provider?.id, 'fake'); assert.match(SOURCE_LABEL[d.source], /unverified/); assert.equal(d.model.capabilities.length, 3);
    assert.equal((await coreApi.listCareers()).filter((c) => c.source !== 'seed').length, 0);
  });
  it('provider failures and malformed output are thrown, never replaced by the template', async () => {
    await token();
    for (const [reply, code] of [[new AiProviderError('timeout'), 'ai_timeout'], [new AiProviderError('upstream_error', 500), 'ai_unavailable'], ['not json at all', 'ai_invalid_output'], [JSON.stringify({ ...GOOD, capabilities: [] }), 'ai_invalid_output']] as const) {
      ai.reply = reply as string | Error;
      await assert.rejects(requestAiDraft({ name: 'Data Analyst', category: '', description: '' }), (e: unknown) => e instanceof ApiError && e.code === code);
    }
    assert.equal((await coreApi.listCareers()).filter((c) => c.source !== 'seed').length, 0);
  });
  it('AI not configured is reported as such', async () => {
    backend = makeApp(); await token();
    await assert.rejects(requestAiDraft({ name: 'X Career', category: '', description: '' }), (e: unknown) => e instanceof ApiError && e.code === 'ai_not_configured');
  });
  it('friendly messages are honest about what happened and never claim a saved or AI result', () => {
    for (const code of ['ai_not_configured', 'ai_timeout', 'ai_unavailable', 'ai_invalid_output']) assert.match(friendlyDraftError(new ApiError(502, code, 'x')), /template|not set up/i);
    for (const code of ['ai_timeout', 'ai_unavailable', 'ai_invalid_output']) assert.match(friendlyDraftError(new ApiError(502, code, 'x')), /Nothing was saved/);
    assert.match(friendlyDraftError(new ApiError(429, 'rate_limited', 'x')), /quickly/);
  });
  it('the template draft is labelled as a template fallback, not AI, and has no AI provider', async () => {
    const t = await templateDraft({ name: 'Corporate Lawyer', category: 'Law', description: '' });
    assert.equal(t.source, 'template'); assert.equal(t.provider, null); assert.match(SOURCE_LABEL.template, /Template fallback/); assert.ok(!/AI-generated draft/.test(SOURCE_LABEL.template));
    assert.ok(t.model.capabilities.length > 0); assert.equal(ai.calls.length, 0);
  });
  it('edit before save: only the edited model is saved, after validation, with descriptions and evidence notes surviving a read', async () => {
    await token(); const d = await requestAiDraft({ name: 'Data Analyst', category: 'Data', description: '' });
    const m: DraftModel = structuredClone(d.model);
    m.name = 'My Analyst Path'; m.capabilities.pop(); m.capabilities[0].skills.push({ name: 'Dashboards', description: 'Build a simple dashboard.', requiredLevel: 2, importance: 3, evidenceExpectation: 'A screenshot of a dashboard' }); m.capabilities[1].skills.shift();
    assert.deepEqual(draftProblems(m), []);
    const saved = await saveDraft(m); const read = toCareer(await coreApi.getCareer(saved.career.id));
    assert.equal(read.name, 'My Analyst Path'); assert.equal(read.capabilities.length, 2);
    const names = read.capabilities.flatMap((c) => c.skills.map((s) => s.name)); assert.ok(names.includes('Dashboards')); assert.ok(!names.includes('Statistics one'));
    const dash = read.capabilities.flatMap((c) => c.skills).find((s) => s.name === 'Dashboards'); assert.match(dash?.description ?? '', /Build a simple dashboard\.\n\nEvidence to show: A screenshot of a dashboard/);
    assert.equal(read.capabilities.flatMap((c) => c.skills).find((s) => s.name === 'Querying one')?.requiredLevel, 3);
  });
  it('refuses to save an invalid edit (no request is sent) and checks levels, duplicates and empties', async () => {
    await token(); const m = structuredClone(GOOD) as unknown as DraftModel & { category: string }; m.category = 'Data';
    m.capabilities[0].skills[0].requiredLevel = 9; m.capabilities[1].skills[0].name = m.capabilities[0].skills[1].name; m.capabilities[2].name = '  ';
    const p = draftProblems(m).join('|'); assert.match(p, /1 to 5/); assert.match(p, /twice/); assert.match(p, /needs a name/);
    urls.length = 0; await assert.rejects(saveDraft(m)); assert.equal(urls.length, 0);
    assert.match(draftProblems({ ...m, name: '', capabilities: [] }).join('|'), /name the career|Give the career a name/);
  });
  it('draftToApiInput caps lengths and keeps the evidence note labelled inside the description', () => {
    const m = structuredClone(GOOD) as unknown as DraftModel & { category: string }; m.category = '';
    m.capabilities[0].skills[0].description = 'd'.repeat(500);
    const input = draftToApiInput(m); assert.equal(input.category, 'Other');
    const s = input.capabilities[0].skills[0]; assert.ok((s.description ?? '').length <= 300 + 2 + 18 + 200); assert.match(s.description ?? '', /Evidence to show: A project showing Querying one\.$/);
  });
  it("another user cannot read or edit a saved draft-based career", async () => {
    await token(); const saved = await saveDraft({ ...(structuredClone(GOOD) as unknown as DraftModel), category: 'Data' } as DraftModel);
    await authService.logout(); await authService.signUp('Bob', 'b@x.com', 'Passw0rdOK1');
    await assert.rejects(coreApi.getCareer(saved.career.id), (e: unknown) => e instanceof ApiError && e.status === 404);
    assert.equal((await coreApi.listCareers()).some((c) => c.id === saved.career.id), false);
  });
  it('a model call gets the long timeout, like the assistant', async () => {
    const { requestTimeoutMs, ASSISTANT_TIMEOUT_MS, REQUEST_TIMEOUT_MS } = await import('../src/services/api');
    assert.equal(requestTimeoutMs('/careers/draft'), ASSISTANT_TIMEOUT_MS); assert.equal(requestTimeoutMs('/careers'), REQUEST_TIMEOUT_MS);
  });
});

import { readFileSync } from 'node:fs';
describe('component source guards (not rendered; the real browser is unverified)', () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  it('login and signup show setup guidance when unconfigured and demo credentials only in demo mode', () => {
    for (const f of ['pages/Login.tsx', 'pages/Signup.tsx']) assert.match(src(f), /appMode\(\) === 'unconfigured' \? <SetupNotice/);
    const login = src('pages/Login.tsx'); assert.match(login, /appMode\(\) === 'demo' && /); assert.ok(!/!api\.useBackend\('auth'\) &&/.test(login));
  });
  it('the review screen labels the source, saves only after the confirmation dialog, and can discard', () => {
    const r = src('components/careers/CareerDraftReview.tsx');
    assert.match(r, /SOURCE_LABEL\[state\.source\]/); assert.match(r, /Nothing is saved yet/);
    assert.ok(r.indexOf('<ConfirmDialog') > 0 && /onConfirm=\{\(\) => void save\(\)\}/.test(r)); assert.equal((r.match(/saveDraft\(/g) ?? []).length, 1); // one call site, inside save()
    assert.match(r, /setConfirm\(true\)/); assert.match(r, /Discard draft/); assert.match(r, /Remove capability/); assert.match(r, /Add a skill/);
  });
  it('the explorer never substitutes the template after an AI failure', () => {
    const x = src('pages/CareerExplorer.tsx'); const fn = /async function makeDraft[\s\S]*?\n  }\n/.exec(x)?.[0] ?? '';
    assert.ok(fn.length > 0); assert.match(fn, /kind === 'ai' \? await requestAiDraft/); assert.ok(!/catch[^]*templateDraft/.test(fn));
    assert.match(x, /Use the template instead \(not AI\)/);
  });
});

import { plainSummary } from '../src/utils/plainSummary';
import { mapActions } from '../src/services/analysisApi';
describe('guidance reaches the student and the dashboard explanation matches the data', () => {
  const skill = (o: Record<string, unknown>) => ({ assessed: true, skillId: 's', name: 'S', capabilityId: 'c', capabilityName: 'C', careerName: 'X', requiredLevel: 3, currentLevel: 3, skillGap: 0, evidence: [], evidenceCount: 0, strongest: null, coverage: 'none', status: 'on_track', nextAction: '', ...o });
  const view = (skills: unknown[], state: string, overall = 40) => ({ career: { name: 'Data Analyst' }, skills, evidence: [], readiness: { overall, assessment: { state, assessed: 1, total: 3 } } }) as never;
  it('says unrated skills are unknown and does not show a percentage as the answer when not assessed', () => {
    const s = plainSummary(view([skill({ assessed: false, name: 'A' }), skill({ assessed: false, name: 'B' }), skill({ name: 'C', currentLevel: 1 })], 'not_assessed'), []);
    assert.match(s.where, /cannot say yet/); assert.match(s.where, /unknown, not zero/); assert.ok(!/%/.test(s.where)); assert.match(s.rated, /1 of 3 skills are rated; 2 still unrated: A and B \(unknown, not counted as gaps\)/);
    assert.match(s.honesty, /not a prediction of getting a job/);
  });
  it('lists real contributing skills and real gaps, and calls evidence unverified', () => {
    const s = plainSummary(view([skill({ name: 'SQL', currentLevel: 4, requiredLevel: 3, evidenceCount: 1 }), skill({ name: 'Stats', currentLevel: 1, requiredLevel: 4 }), skill({ name: 'Charts', currentLevel: 2, requiredLevel: 3 })], 'assessed', 55), []);
    assert.match(s.where, /^55%/); assert.match(s.contributing ?? '', /SQL/); assert.match(s.gaps ?? '', /Stats and Charts/); assert.match(s.evidence, /1 of your 3 rated skills.*unverified/);
  });
  it('the best next step is the first open action, with its own reason; none left is reported honestly', () => {
    const a = (id: string, status: string, why: string) => ({ id, status, title: `T-${id}`, reason: 'r', detail: { guidance: { title: `G-${id}`, whyNow: why } } });
    const n = plainSummary(view([skill({})], 'assessed'), [a('1', 'completed', 'w1'), a('2', 'not_started', 'w2')] as never).next; assert.deepEqual(n, { title: 'G-2', why: 'w2' });
    assert.equal(plainSummary(view([skill({})], 'assessed'), [a('1', 'completed', 'w1')] as never).next, null);
  });
  it('real server guidance is mapped onto the action (title, outcome, steps, done-criteria) and nothing is invented client-side', async () => {
    const { token } = await (async () => { await authService.signUp('Ada', 'g@x.com', 'Passw0rdOK1'); return { token: 1 }; })(); void token;
    const acts = mapActions(await coreApi.getActions('swe', 10), 'swe'); assert.ok(acts.length > 0);
    for (const a of acts) { const g = a.detail?.guidance; assert.ok(g && g.steps.length >= 3 && g.definitionOfDone.length >= 1 && g.effort.isEstimate); assert.equal(a.title, g.title); assert.ok(!/https?:\/\//.test(JSON.stringify(g))); }
  });
});

import { actionService } from '../src/services/actions';
describe('action completion through the real client', () => {
  it('survives a reload, is per user, and never edits ratings', async () => {
    await authService.signUp('Ada', 'p@x.com', 'Passw0rdOK1');
    const acts = mapActions(await coreApi.getActions('swe', 10), 'swe'); const first = acts[0];
    const ratings = async () => JSON.stringify(await coreApi.listSkillAssessments()); const before = await ratings();
    const store = await actionService.setStatus('swe', first, 'completed'); assert.equal(store[first.id]?.status, 'completed');
    assert.equal((await actionService.getStore('swe'))[first.id]?.status, 'completed'); // a fresh read, as after a page refresh
    assert.equal(await ratings(), before);
    await actionService.setStatus('swe', first, 'in_progress'); assert.equal((await actionService.getStore('swe'))[first.id]?.status, 'in_progress'); // reopening works and does not duplicate
    assert.equal(Object.keys(await actionService.getStore('swe')).filter((k) => k === first.id).length, 1);
    await authService.logout(); await authService.signUp('Bob', 'q@x.com', 'Passw0rdOK1');
    assert.equal((await actionService.getStore('swe'))[first.id], undefined); // another user sees none of it
  });
  it('the guide has ONE disclosure level (a "More guidance" toggle button, not a nested <details>) and the card does not repeat itself', () => {
    const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
    const g = src('components/roadmap/ActionGuide.tsx'), c = src('components/roadmap/ActionCard.tsx');
    assert.equal((g.match(/<details/g) ?? []).length, 1, 'no nested accordion'); assert.match(g, /aria-expanded=\{more\}/); assert.match(g, /aria-controls=/);
    assert.match(g, /'Steps'|>Steps</); assert.ok(g.indexOf('>Steps<') < g.indexOf("'More guidance'"), 'the steps come before the secondary guidance');
    assert.match(c, /shown=\{a\.description\}/); // the outcome is not printed twice when it equals the description
    assert.equal((c.match(/Done when/g) ?? []).length, 1); assert.equal((c.match(/'Why'/g) ?? []).length, 1);
    assert.ok(c.indexOf('<button className="btn"') < c.indexOf('<ActionGuide guidance='), 'the primary button sits above the guide');
  });
  it('the roadmap and dashboard render the guide and the plain-words summary', () => {
    const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
    assert.match(src('components/roadmap/ActionCard.tsx'), /<ActionGuide guidance=\{a\.detail\.guidance\}/); assert.match(src('pages/Dashboard.tsx'), /<PlainSummary view=\{view\} actions=\{actions\}/);
    const g = src('components/roadmap/ActionGuide.tsx'); for (const w of ['<details', 'Steps', 'More guidance', 'Definition of done', 'Evidence to add', '(estimate)', 'ratingNote', 'guidance-basis']) assert.ok(g.includes(w), w);
  });
});
