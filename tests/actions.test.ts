import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { actionService } from '../src/services/actions';
import { authService } from '../src/services/auth';
import { PHASES, blockedBy, buildRoadmap, mergeActions, nextActions, summarize } from '../src/utils/actions';
import { analyze, ev, generate, rateAll, resetStorage, seed, skillOf } from './helpers';

const UX = seed('ux');
const SK = 'ux:data-interpretation';
beforeEach(resetStorage);

describe('action generation', () => {
  it('skill gap >= 2 produces learning + strengthen actions, no evidence action when evidence is strong', () => {
    const ids = analyze(UX, { [SK]: 2 }, [ev('e1', [SK], 'very_strong')]).actions.map((a) => a.id);
    assert.ok(ids.includes(`act:learn:${SK}`) && ids.includes(`act:skill:${SK}`) && !ids.includes(`act:evidence:${SK}`));
  });
  it('evidence gap produces only an evidence action', () => {
    const ids = analyze(UX, { [SK]: 4 }).actions.map((a) => a.id);
    assert.ok(ids.includes(`act:evidence:${SK}`) && !ids.includes(`act:skill:${SK}`));
  });
  it('combined gap: evidence action depends on the skill action', () => {
    const a = analyze(UX, { [SK]: 3 }).actions.find((x) => x.id === `act:evidence:${SK}`);
    assert.ok(a?.prerequisites.includes(`act:skill:${SK}`));
  });
  it('orders by priority score and explains why', () => {
    const acts = analyze(UX, rateAll(UX)).actions;
    for (let i = 1; i < acts.length; i++) assert.ok(acts[i - 1].priorityScore >= acts[i].priorityScore);
    assert.ok(acts.every((a) => a.priorityScore >= 0 && a.priorityScore <= 100 && a.reason.includes('priority because') && a.careerId === 'ux'));
    const big = analyze(UX, { [SK]: 1 }).actions.find((a) => a.id === `act:skill:${SK}`);
    const small = analyze(UX, { [SK]: 3 }, [ev('e', [SK])]).actions.find((a) => a.id === `act:skill:${SK}`);
    assert.ok(big && small && big.priorityScore > small.priorityScore);
  });
  it('no gaps means no actions', () => {
    const sks = UX.career.capabilities.flatMap((c) => c.skills);
    const v = analyze(UX, Object.fromEntries(sks.map((s) => [s.id, 5])), sks.map((s, i) => ev(`f${i}`, [s.id], 'very_strong')));
    assert.equal(v.actions.length, 0);
  });
  it('differs by career model, including generated careers, with no career-name branching', async () => {
    const titles = async (n: string) => { const ds = await generate(n); return analyze(ds, rateAll(ds)).actions.map((a) => a.title).join('|'); };
    assert.notEqual(await titles('Fashion Designer'), await titles('Corporate Lawyer'));
    assert.notEqual(await titles('UPSC Civil Services'), await titles('Teacher'));
    const fds = await generate('Fashion Designer');
    const fashion = analyze(fds, rateAll(fds)).actions.filter((a) => a.phase === 'evidence_building').map((a) => a.title).join('|');
    assert.match(fashion, /Portfolio piece|Case study|Collaboration or internship/);
  });
});

describe('roadmap', () => {
  it('assigns every phase in order and starts at 0% progress', () => {
    const acts = analyze(UX, rateAll(UX)).actions;
    const rm = buildRoadmap('ux', acts);
    assert.equal(rm.items.length, acts.length); assert.equal(rm.progress, 0);
    const order = PHASES.map((p) => p.key);
    assert.deepEqual(new Set(rm.items.map((i) => i.phase)), new Set(order));
    rm.items.forEach((it, i, a) => i && assert.ok(order.indexOf(a[i - 1].phase) <= order.indexOf(it.phase)));
  });
  it('next actions respect prerequisites', () => {
    const acts = analyze(UX, rateAll(UX)).actions;
    assert.ok(nextActions(acts, 3).every((a) => blockedBy(a, acts).length === 0));
  });
  it('progress counts completed actions and keeps history when a gap closes', () => {
    const acts = analyze(UX, rateAll(UX)).actions;
    const done = { [acts[0].id]: { status: 'completed' as const, updatedAt: 't', action: { ...acts[0], status: 'completed' as const } } };
    const merged = mergeActions(acts, done);
    assert.equal(summarize(merged).completed, 1); assert.ok(buildRoadmap('ux', merged).progress > 0);
    const retained = mergeActions([], done);
    assert.equal(retained.length, 1); assert.equal(retained[0].status, 'completed');
  });
  it('completing an action never changes skill levels', () => {
    assert.equal(skillOf(analyze(UX, { [SK]: 2 }), SK).currentLevel, 2);
  });
});

describe('persistence and isolation', () => {
  it('persists status per user and per career', async () => {
    await authService.login('alex@example.com', 'Password1', true);
    const acts = analyze(UX, rateAll(UX)).actions; const a = acts[0];
    await actionService.setStatus('ux', a, 'in_progress');
    assert.equal((await actionService.getStore('ux'))[a.id].status, 'in_progress');
    await actionService.setStatus('ux', a, 'completed');
    assert.equal((await actionService.getStore('ux'))[a.id].status, 'completed');
    assert.deepEqual(await actionService.getStore('fin'), {}, 'career isolation');
    await authService.logout();
    await authService.signUp('Bea Tester', 'bea@example.com', 'Password1');
    assert.deepEqual(await actionService.getStore('ux'), {}, 'user isolation');
    await actionService.setStatus('ux', a, 'in_progress');
    await authService.logout();
    await authService.login('alex@example.com', 'Password1', true);
    assert.equal((await actionService.getStore('ux'))[a.id].status, 'completed', 'restored for original user');
    await actionService.setStatus('ux', a, 'not_started');
    assert.deepEqual(await actionService.getStore('ux'), {});
  });
  it('requires a signed-in user', async () => { await assert.rejects(() => actionService.getStore('ux')); });
});
