import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeApp } from '../server/tests/helpers';
import { loadRemoteAnalysis } from '../src/services/analysisApi';
import { ApiError, api } from '../src/services/api';
import { authService } from '../src/services/auth';
import { coreApi } from '../src/services/coreApi';
import { evidenceService } from '../src/services/evidence';
import type { Evidence } from '../src/types';
import { evidenceKey, linkError, linkableEvidence } from '../src/utils/evidenceLink';
import { resetStorage } from './helpers';

// REAL frontend services + REAL backend pipeline (auth, ownership, validation, readiness) over in-memory repositories with a fake fetch. Not PostgreSQL, not a browser.
let backend: ReturnType<typeof makeApp>, real: typeof fetch, sent: { method: string; url: string; auth?: string }[], offline = false;
beforeEach(() => {
  resetStorage(); backend = makeApp({ now: () => new Date() }); real = globalThis.fetch; sent = []; offline = false;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (offline) throw new TypeError('Failed to fetch');
    const h = (init?.headers ?? {}) as Record<string, string>;
    sent.push({ method: init?.method ?? 'GET', url: String(url), auth: h.Authorization });
    const r = await backend.call(init?.method ?? 'GET', String(url).replace('http://api.test', ''), { body: init?.body ? JSON.parse(String(init.body)) : undefined, token: h.Authorization?.replace('Bearer ', '') });
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  api.setBase('http://api.test/api');
});
afterEach(() => { globalThis.fetch = real; api.setToken(null); api.setBase(''); });
const signUp = (email = 'a@x.com') => authService.signUp('Ada', email, 'Passw0rdOK1');
const base = { description: 'did it', type: 'Project' as const, strength: 'strong' as const };
const skills = async () => (await coreApi.getReadiness('swe')).skills;
const failure = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as ApiError; } throw new Error('expected a rejection'); };

describe('linking evidence to a skill (backend mode)', () => {
  it('links an existing item to a second skill, sends the signed-in token, and readiness reflects it', async () => {
    await signUp(); const [a, b] = await skills();
    await coreApi.setSkillAssessment(b.skillId, 3);
    const e = await evidenceService.createEvidence({ ...base, title: 'Shipped a service', skillIds: [a.skillId] });
    const before = (await loadRemoteAnalysis('swe', await evidenceService.getEvidence())).skills.find((s) => s.skillId === b.skillId)!;
    assert.equal(before.evidenceCount, 0); assert.equal(before.breakdown?.evidenceStatus, 'none');
    sent = [];
    const out = await evidenceService.setSkillLink(e, b.skillId, true);
    assert.deepEqual([...out.skillIds].sort(), [a.skillId, b.skillId].sort());
    assert.ok(sent.length > 0 && sent.every((r) => /^Bearer .+/.test(r.auth ?? '')), 'every request is authenticated through the existing auth flow');
    assert.ok(sent.some((r) => r.method === 'POST' && r.url.endsWith(`/evidence/${e.id}/skills/${encodeURIComponent(b.skillId)}`)));
    const after = (await loadRemoteAnalysis('swe', await evidenceService.getEvidence())).skills.find((s) => s.skillId === b.skillId)!;
    assert.equal(after.evidenceCount, 1); assert.equal(after.breakdown?.evidencePoints, 3); assert.ok((after.breakdown?.skillScore ?? 0) > (before.breakdown?.skillScore ?? 0));
  });
  it('unlinks one skill without deleting the evidence or touching its other links', async () => {
    await signUp(); const [a, b] = await skills();
    await coreApi.setSkillAssessment(a.skillId, 3);
    const e = await evidenceService.createEvidence({ ...base, title: 'Two-skill project', skillIds: [a.skillId, b.skillId] });
    const out = await evidenceService.setSkillLink(e, a.skillId, false);
    assert.deepEqual(out.skillIds, [b.skillId]);
    const list = await evidenceService.getEvidence(); assert.equal(list.length, 1, 'the evidence item itself still exists');
    const v = await loadRemoteAnalysis('swe', list);
    assert.equal(v.skills.find((s) => s.skillId === a.skillId)!.evidenceCount, 0); assert.equal(v.skills.find((s) => s.skillId === b.skillId)!.evidenceCount, 1);
    assert.equal(v.skills.find((s) => s.skillId === a.skillId)!.breakdown?.evidenceStatus, 'none');
  });
  it('the analysis refetch key changes on link/unlink even when updatedAt does not', async () => {
    await signUp(); const [a, b] = await skills();
    const e = await evidenceService.createEvidence({ ...base, title: 'P', skillIds: [a.skillId] });
    const linked = await evidenceService.setSkillLink(e, b.skillId, true);
    const same: Evidence = { ...linked, updatedAt: e.updatedAt };
    assert.notEqual(evidenceKey([e]), evidenceKey([same]));
    assert.equal(evidenceKey([{ ...e, skillIds: [a.skillId, b.skillId] }]), evidenceKey([{ ...e, skillIds: [b.skillId, a.skillId] }]), 'order does not matter');
  });
});

describe('link/unlink error states', () => {
  it('linking twice is a conflict with a clear message and a reload hint', async () => {
    await signUp(); const [a] = await skills();
    const e = await evidenceService.createEvidence({ ...base, title: 'P', skillIds: [a.skillId] });
    const err = await failure(evidenceService.setSkillLink(e, a.skillId, true));
    assert.equal(err.status, 409); assert.equal(err.code, 'conflict'); assert.deepEqual(linkError(err, true), { message: 'That evidence is already linked to this skill.', gone: true });
  });
  it('unlinking something that is not linked is link_not_found', async () => {
    await signUp(); const [a, b] = await skills();
    const e = await evidenceService.createEvidence({ ...base, title: 'P', skillIds: [a.skillId] });
    const err = await failure(evidenceService.setSkillLink(e, b.skillId, false));
    assert.equal(err.status, 404); assert.equal(err.code, 'link_not_found'); assert.match(linkError(err, false).message, /was not linked/); assert.equal(linkError(err, false).gone, true);
  });
  it('evidence deleted elsewhere (second tab) gives evidence_not_found', async () => {
    await signUp(); const [a, b] = await skills();
    const e = await evidenceService.createEvidence({ ...base, title: 'P', skillIds: [a.skillId] });
    await evidenceService.deleteEvidence(e.id);
    const err = await failure(evidenceService.setSkillLink(e, b.skillId, true));
    assert.equal(err.code, 'evidence_not_found'); assert.match(linkError(err, true).message, /no longer exists/);
  });
  it('an unknown skill is skill_not_found and a malformed evidence id is a 400, and neither changes anything', async () => {
    await signUp(); const [a] = await skills();
    const e = await evidenceService.createEvidence({ ...base, title: 'P', skillIds: [a.skillId] });
    assert.equal((await failure(evidenceService.setSkillLink(e, 'swe:does-not-exist', true))).code, 'skill_not_found');
    assert.equal((await failure(evidenceService.setSkillLink({ ...e, id: 'not-a-uuid' }, a.skillId, true))).status, 400);
    assert.deepEqual((await evidenceService.getEvidence())[0].skillIds, [a.skillId]);
  });
  it('ISOLATION: another user cannot link or unlink my evidence, and cannot link to my custom career\'s skills', async () => {
    await signUp('a@x.com'); const [a, b] = await skills();
    const mine = await evidenceService.createEvidence({ ...base, title: 'Mine', skillIds: [a.skillId] });
    const career = await coreApi.createCareer({ name: 'Private Career', category: 'X', description: '', evidenceExpectations: [], capabilities: [{ name: 'C', description: '', skills: [{ name: 'Secret skill', requiredLevel: 3, importance: 3 }] }] } as never);
    const privateSkill = (career as unknown as { requirements: { skillId: string }[] }).requirements[0].skillId;
    await authService.logout(); await signUp('b@x.com');
    const theirs = await evidenceService.createEvidence({ ...base, title: 'Theirs', skillIds: [a.skillId] });
    assert.equal((await failure(evidenceService.setSkillLink(mine, b.skillId, true))).code, 'evidence_not_found');
    assert.equal((await failure(evidenceService.setSkillLink(mine, a.skillId, false))).code, 'evidence_not_found');
    assert.equal((await failure(evidenceService.setSkillLink(theirs, privateSkill, true))).code, 'skill_not_found');
    assert.deepEqual((await evidenceService.getEvidence()).map((e) => e.title), ['Theirs']);
    await authService.logout(); await authService.login('a@x.com', 'Passw0rdOK1', true);
    assert.deepEqual((await evidenceService.getEvidence())[0].skillIds, [a.skillId], 'my evidence is unchanged');
  });
  it('signed-out requests are rejected by the server (401) and an expired session is reported plainly', async () => {
    await signUp(); const [a, b] = await skills();
    const e = await evidenceService.createEvidence({ ...base, title: 'P', skillIds: [a.skillId] });
    api.setToken(null); sent = [];
    const guard = await failure(evidenceService.setSkillLink(e, b.skillId, true)); assert.match(guard.message, /Not signed in/); assert.equal(sent.length, 0, 'the client refuses before any request is sent');
    const err = await failure(coreApi.linkEvidenceSkill(e.id, b.skillId)); assert.equal(err.status, 401, 'and the server itself rejects an unauthenticated call');
    assert.match(linkError(new ApiError(401, 'token_expired', 'x'), true).message, /sign in again/);
  });
  it('a network failure changes nothing and says so', async () => {
    await signUp(); const [a, b] = await skills();
    const e = await evidenceService.createEvidence({ ...base, title: 'P', skillIds: [a.skillId] });
    offline = true;
    const err = await failure(evidenceService.setSkillLink(e, b.skillId, true)); assert.equal(err.code, 'network_error');
    assert.match(linkError(err, true).message, /nothing was changed/); assert.equal(linkError(err, true).gone, false);
    offline = false; assert.deepEqual((await evidenceService.getEvidence())[0].skillIds, [a.skillId]);
  });
  it('maps server problems and unknown errors to safe messages without raw details', () => {
    const m = linkError(new ApiError(500, 'internal_error', 'RAW sk-SECRET stack'), true).message;
    assert.match(m, /server had a problem/); assert.ok(!/RAW|SECRET/.test(m));
    assert.match(linkError(new Error('boom'), false).message, /Couldn't unlink/);
  });
});

describe('local mode and helpers', () => {
  it('without a backend, link and unlink rewrite the user\'s own stored evidence', async () => {
    api.setBase(''); await signUp('local@x.com');
    const e = await evidenceService.createEvidence({ ...base, title: 'Local', skillIds: ['s1'] });
    assert.deepEqual((await evidenceService.setSkillLink(e, 's2', true)).skillIds, ['s1', 's2']);
    assert.deepEqual((await evidenceService.getEvidence())[0].skillIds, ['s1', 's2']);
    assert.deepEqual((await evidenceService.setSkillLink({ ...e, skillIds: ['s1', 's2'] }, 's1', false)).skillIds, ['s2']);
  });
  it('linkableEvidence offers only the user\'s own items that are not already linked, never demo examples', () => {
    const mk = (id: string, source: 'user' | 'example', skillIds: string[]): Evidence => ({ id, title: id, description: '', type: 'Project', strength: 'weak', skillIds, source, createdAt: '', updatedAt: '' });
    const out = linkableEvidence([mk('b', 'user', []), mk('a', 'user', ['s']), mk('c', 'example', []), mk('d', 'user', ['x'])], 's');
    assert.deepEqual(out.map((e) => e.id), ['b', 'd']); assert.deepEqual(linkableEvidence(null, 's'), []);
  });
  it('the skill page and context call only the service (no direct network code) and guard against double submits', () => {
    for (const f of ['src/pages/SkillDetail.tsx', 'src/context/EvidenceContext.tsx']) assert.ok(!/fetch\(/.test(readFileSync(f, 'utf8')), f);
    const page = readFileSync('src/pages/SkillDetail.tsx', 'utf8');
    assert.match(page, /ev\.setSkillLink/); assert.match(page, /if \(linkBusy\) return/); assert.match(page, /role=\{linkMsg\.ok \? 'status' : 'alert'\}/);
  });
});
