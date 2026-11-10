import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { Action } from '../src/types';
import { actionShortLabel } from '../src/utils/graphModel';
import { profileProgress, ratingSummary } from '../src/utils/profileStatus';

const act = (over: Partial<Action>): Action => ({ id: 'a', careerId: 'c', title: 'Create evidence for Fashion Designer: core domain knowledge: Portfolio piece', description: '', type: 'create_evidence', relatedSkillIds: ['s'], relatedCapabilityIds: [], reason: '', priority: 'high', priorityScore: 1, impact: 'high', status: 'not_started', phase: 'evidence_building', prerequisites: [], createdAt: '', updatedAt: '', ...over } as Action);

describe('graph action labels stay distinguishable (recording: ten "Create evidence for..." nodes read the same once truncated)', () => {
  it('uses verb + skill so actions with a shared title prefix differ', () => {
    const a = actionShortLabel(act({}), 'Design fundamentals'), b = actionShortLabel(act({}), 'Prototyping and making');
    assert.equal(a, 'Evidence: Design fundamentals'); assert.notEqual(a, b);
  });
  it('maps the server action kinds, and falls back to the real title when there is nothing better', () => {
    const d = (kind: 'build_skill' | 'assess_skill' | 'add_evidence') => act({ type: 'other', detail: { kind, skillName: 'X', recommendation: '', completionCriterion: '', currentLevel: null, targetLevel: 3, rank: 1 } });
    assert.equal(actionShortLabel(d('build_skill'), 'Sketching'), 'Raise: Sketching'); assert.equal(actionShortLabel(d('assess_skill'), 'Sketching'), 'Rate: Sketching'); assert.equal(actionShortLabel(d('add_evidence'), 'Sketching'), 'Evidence: Sketching');
    assert.equal(actionShortLabel(act({ type: 'networking', title: 'Meet two designers' }), 'Sketching'), 'Meet two designers');
    assert.equal(actionShortLabel(act({}), undefined), act({}).title);
  });
});

describe('profile completeness is computed from visible facts (recording: "100%" with an empty Education field and 0 of 7 rated)', () => {
  const p = { targetCareerId: 'x', education: '', experienceSummary: 'Fashion Designer' };
  it('counts only what is really there and names what is missing', () => {
    const r = profileProgress(p, [{ assessed: false }], 0);
    assert.deepEqual([r.done, r.total, r.percent], [2, 5, 40]); assert.deepEqual(r.missing, ['your education', 'a skill rating for your target career', 'one piece of evidence']);
    assert.equal(profileProgress({ ...p, education: 'BA' }, [{ assessed: true }], 2).percent, 100);
  });
  it('does not guess while the analysis is still loading', () => {
    const r = profileProgress(p, null, null); assert.equal(r.total, 3); assert.ok(!r.missing.some((m) => /rating|evidence/.test(m)));
  });
  it('separates ratings for this career from ratings kept for other careers', () => {
    assert.deepEqual(ratingSummary([{ assessed: false }, { assessed: false }], 7), { forCareer: 0, total: 2, other: 7 });
    assert.deepEqual(ratingSummary([{ assessed: true }, { assessed: false }], 1), { forCareer: 1, total: 2, other: 0 });
  });
  it('the dashboard no longer shows a stored "last analysis" date or the stored completeness number', () => {
    const d = readFileSync(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
    assert.ok(!/Last analysis|profile\.completeness|lastAnalysis/.test(d));
    const pr = readFileSync(new URL('../src/pages/Profile.tsx', import.meta.url), 'utf8');
    assert.ok(!/profile\.completeness|skillAssessments\.length\}<\/dd>/.test(pr));
  });
});

describe('navigation: every sidebar destination has its own route and page', () => {
  const shell = readFileSync(new URL('../src/components/layout/AppShell.tsx', import.meta.url), 'utf8'), app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const nav = [...shell.matchAll(/\{ to: '([^']+)', label: '([^']+)'/g)].map((m) => m[1]);
  const routes = new Map([...app.matchAll(/<Route path="([^"]+)" element=\{<(\w+)/g)].map((m) => [m[1], m[2]]));
  it('has nine destinations (Compare and Bookings are reached from Explorer and Mentorship), each a defined route', () => { assert.equal(nav.length, 9); for (const extra of ['/compare', '/bookings']) assert.ok(routes.has(extra), `${extra} keeps its route`); for (const to of nav) assert.ok(routes.has(to), to); });
  it('no two sidebar items open the same page, and none opens the dashboard by accident', () => {
    const pages = nav.map((to) => routes.get(to)); assert.equal(new Set(pages).size, nav.length);
    for (const to of nav.filter((t) => t !== '/dashboard')) assert.notEqual(routes.get(to), 'Dashboard', to);
  });
});
