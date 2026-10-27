import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeApp } from '../server/tests/helpers';
import { loadRemoteAnalysis } from '../src/services/analysisApi';
import { api, appMode } from '../src/services/api';
import { actionService } from '../src/services/actions';
import { authService } from '../src/services/auth';
import { saveDraft, type DraftModel } from '../src/services/careerDraft';
import { coreApi } from '../src/services/coreApi';
import { evidenceService } from '../src/services/evidence';
import { profileService } from '../src/services/profile';
import { LEVEL_MEANING, splitSkillText } from '../src/utils/skillText';
import { LEVELS } from '../src/utils/readiness';
import { resetStorage } from './helpers';

// REAL frontend services + REAL backend pipeline over in-memory repositories with a fake fetch. Not PostgreSQL, not a browser, not React rendering.
let backend: ReturnType<typeof makeApp>, real: typeof fetch;
beforeEach(() => {
  resetStorage(); backend = makeApp({ now: () => new Date() }); real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    const r = await backend.call(init?.method ?? 'GET', String(url).replace('http://api.test', ''), { body: init?.body ? JSON.parse(String(init.body)) : undefined, token: h.Authorization?.replace('Bearer ', '') });
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  api.setBase('http://api.test/api');
});
afterEach(() => { globalThis.fetch = real; api.setToken(null); api.setBase(''); });

const MODEL: DraftModel = {
  name: 'Data Analyst', category: 'Data', description: 'Turns data into decisions.',
  capabilities: [{ name: 'Querying', description: 'Ask data questions.', skills: [
    { name: 'Writing queries', description: 'Asking a database questions.', requiredLevel: 4, importance: 5, evidenceExpectation: 'A repository with five working queries' },
    { name: 'Cleaning data', description: 'Fixing messy data.', requiredLevel: 3, importance: 4, evidenceExpectation: 'A before/after notebook' },
    { name: 'Reading charts', description: 'Understanding charts.', requiredLevel: 2, importance: 3, evidenceExpectation: 'A short chart write-up' },
    { name: 'Basic statistics', description: 'Averages and spread.', requiredLevel: 3, importance: 4, evidenceExpectation: 'A worked example' }] }],
};

describe('one complete student journey (services + backend)', () => {
  it('sign up -> custom career -> unrated vs zero -> evidence -> readiness -> guidance -> complete -> reload: nothing changes silently', async () => {
    assert.equal(appMode(), 'backend');
    const user = await authService.signUp('Ada Student', 'ada@example.com', 'Passw0rdOK1');
    const saved = await saveDraft(MODEL); const careerId = saved.career.id; const sid = (n: string) => saved.skills.find((s) => s.name === n)?.id as string;
    await profileService.completeOnboarding(user.id, { targetCareerId: careerId, experienceLevel: 'beginner', skillAssessments: [] });

    // Nothing rated yet: unknown, not zero, no score, no gaps.
    let v = await loadRemoteAnalysis(careerId, []);
    assert.equal(v.readiness.assessment.state, 'not_assessed'); assert.equal(v.readiness.backend?.score, null); assert.equal(v.gaps.length, 0);
    assert.ok(v.skills.every((s) => !s.assessed && s.status === 'not_assessed'));
    assert.ok(v.actions.every((a) => a.detail?.kind === 'assess_skill'), 'only self-checks while nothing is rated');

    // A genuine 0 is a rating (and a gap); a skill left alone stays unrated.
    await profileService.setSkillLevel(user.id, sid('Writing queries'), 2); await profileService.setSkillLevel(user.id, sid('Cleaning data'), 0); await profileService.setSkillLevel(user.id, sid('Reading charts'), 2);
    v = await loadRemoteAnalysis(careerId, []);
    const by = (id: string) => v.skills.find((s) => s.skillId === id)!;
    assert.equal(by(sid('Cleaning data')).assessed, true); assert.equal(by(sid('Cleaning data')).currentLevel, 0); assert.ok(['skill_gap', 'combined_gap'].includes(by(sid('Cleaning data')).status));
    assert.equal(by(sid('Basic statistics')).assessed, false); assert.equal(by(sid('Basic statistics')).status, 'not_assessed');
    assert.ok(v.gaps.some((g) => g.skillId === sid('Cleaning data'))); assert.ok(!v.gaps.some((g) => g.skillId === sid('Basic statistics')));
    assert.equal(v.readiness.assessment.state, 'partial'); // 3 of 4 rated

    // Evidence the student adds is linked, counted and unverified.
    const ev = await evidenceService.createEvidence({ title: 'Query repo', description: 'Five queries', type: 'Project', strength: 'strong', skillIds: [sid('Writing queries')] });
    v = await loadRemoteAnalysis(careerId, [ev]);
    assert.equal(by(sid('Writing queries')).evidenceCount, 1); assert.ok(!JSON.stringify(v.evidence).includes('"verification":"verified"'));

    // Guidance is grounded: the skill's description/evidence note, current level and target level.
    const q = v.actions.find((a) => a.relatedSkillIds.includes(sid('Writing queries')))!; const g = q.detail!.guidance!;
    assert.match(g.basis, /not verified/); assert.match(g.whyItMatters, /Asking a database questions\./); assert.match(g.evidenceToSubmit, /five working queries/); assert.equal(g.kind, 'practice'); // rated 2 -> next level 3
    const clean = v.actions.find((a) => a.relatedSkillIds.includes(sid('Cleaning data')))!; assert.equal(clean.detail!.guidance!.kind, 'foundation'); // rated 0 -> basics, not a project
    assert.ok(v.actions.find((a) => a.relatedSkillIds.includes(sid('Basic statistics')))?.detail?.kind === 'assess_skill');

    // Complete an action, "reload", and confirm nothing else moved.
    const snapshot = async () => { const w = await loadRemoteAnalysis(careerId, [ev]); return JSON.stringify({ ratings: await coreApi.listSkillAssessments(), evidence: await coreApi.listEvidence(), score: w.readiness.backend?.score, gaps: w.gaps.map((x) => x.skillId), skills: w.skills.map((s) => [s.skillId, s.currentLevel, s.assessed, s.evidenceCount]) }); };
    const before = await snapshot();
    const store = await actionService.setStatus(careerId, q, 'completed'); assert.equal(store[q.id]?.status, 'completed');
    assert.equal((await actionService.getStore(careerId))[q.id]?.status, 'completed'); // fresh read = page reload
    assert.equal(await snapshot(), before);
    const again = await loadRemoteAnalysis(careerId, [ev]); assert.ok(again.actions.some((a) => a.id === q.id), 'the gap is still real, so the action is still listed');
  });

  it('another student sees none of it', async () => {
    const a = await authService.signUp('A', 'a@example.com', 'Passw0rdOK1'); const saved = await saveDraft(MODEL);
    await profileService.setSkillLevel(a.id, saved.skills[0].id, 3);
    await authService.logout(); await authService.signUp('B', 'b@example.com', 'Passw0rdOK1');
    await assert.rejects(loadRemoteAnalysis(saved.career.id, []));
    assert.deepEqual((await coreApi.listSkillAssessments()).filter((s) => s.skillId === saved.skills[0].id), []);
  });
});

describe('skill text helpers and level scale', () => {
  it('splits description from the evidence note and tolerates empty input', () => {
    assert.deepEqual(splitSkillText('Plain.\n\nEvidence to show: A thing'), { description: 'Plain.', evidenceNote: 'A thing' });
    assert.deepEqual(splitSkillText(undefined), { description: '', evidenceNote: '' });
  });
  it('has a plain-words meaning for every level, and says it is not an industry standard in the UI', () => {
    assert.equal(LEVEL_MEANING.length, LEVELS.length); assert.ok(LEVEL_MEANING.every((m) => m.length > 15));
    assert.match(readFileSync('src/pages/SkillDetail.tsx', 'utf8'), /not an industry standard/);
  });
});

describe('component source guards (not rendered)', () => {
  const src = (p: string) => readFileSync(`src/${p}`, 'utf8');
  it('an unrated skill never defaults to "None": the editor starts with no choice and cannot save one', () => {
    const e = src('components/skills/LevelEditor.tsx');
    assert.match(e, /useState<number \| null>\(assessed \? current : null\)/); assert.match(e, /Choose a level…/); assert.match(e, /value === null \|\|/);
  });
  it('the skill page shows what the skill means, how to demonstrate it, what to improve and what the level means', () => {
    const s = src('pages/SkillDetail.tsx'); for (const w of ['skill-meaning', 'What this skill means', 'How to demonstrate it', 'What you can improve', 'What the expected level means', 'not an industry standard']) assert.ok(s.includes(w), w);
  });
});

// Every internal link and navigate() target in src/ must match a <Route> in App.tsx (no dead links).
describe('no dead in-app links', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.tsx') ? [join(d, f)] : []));
  const routes = [...readFileSync('src/App.tsx', 'utf8').matchAll(/<Route[^>]*\bpath="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*');
  const toRegex = (p: string) => new RegExp(`^${p.replace(/:[A-Za-z]+/g, '[^/]+')}$`);
  it('finds the route table', () => { assert.ok(routes.length >= 15); assert.ok(routes.includes('/roadmap') && routes.includes('/skills/:id')); });
  it('every literal link target resolves', () => {
    const bad: string[] = [];
    for (const file of walk('src')) {
      const text = readFileSync(file, 'utf8');
      const targets = [...text.matchAll(/(?:\bto=|navigate\(|href=)(?:"|\{`|`|')(\/[^"'`]*?)(?:"|`|')/g)].map((m) => m[1]);
      for (const t of targets) {
        const path = t.split('?')[0].replace(/\$\{[^}]*\}/g, 'x').replace(/\/+$/, '') || '/';
        if (path.startsWith('//')) continue;
        if (!routes.some((r) => toRegex(r).test(path))) bad.push(`${file}: ${t}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});
