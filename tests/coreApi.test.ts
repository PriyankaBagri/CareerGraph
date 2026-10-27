import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CAREER_DATASETS } from '../src/data/careers';
import { api } from '../src/services/api';
import { coreApi, toCareer, type ApiCareerModel } from '../src/services/coreApi';
import { resetStorage } from './helpers';

// Frontend-only: the Stage 3 client against scripted responses. The server side of these routes is tested in server/tests/core.test.ts.
interface Call { method: string; url: string; headers: Record<string, string>; body?: unknown }
let calls: Call[], queue: (() => Response)[], realFetch: typeof fetch;
const json = (status: number, body?: unknown) => () => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  resetStorage(); calls = []; queue = []; realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = queue.shift(); if (!next) throw new Error('unexpected fetch'); return next();
  }) as typeof fetch;
  api.setBase('http://api.test/api'); api.setToken('tok');
});
afterEach(() => { globalThis.fetch = realFetch; api.setToken(null); });

describe('Stage 3 API client', () => {
  it('calls the documented routes with the bearer token', async () => {
    queue = [json(200, { careers: [] }), json(200, {}), json(200, { skills: [] }), json(200, {}), json(204), json(201, {}), json(204), json(201, {}), json(200, {})];
    await coreApi.listCareers(); await coreApi.getCareer('swe'); await coreApi.listSkillAssessments(); await coreApi.setSkillAssessment('swe:git', 3); await coreApi.clearSkillAssessment('swe:git');
    await coreApi.createEvidence({ title: 't', description: 'd', type: 'Project', strength: 'weak' }); await coreApi.deleteEvidence('e1');
    await coreApi.linkEvidenceSkill('e1', 'swe:git'); await coreApi.unlinkEvidenceSkill('e1', 'swe:git');
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace('http://api.test/api', '')}`), ['GET /careers', 'GET /careers/swe', 'GET /me/skills', 'PUT /me/skills/swe%3Agit', 'DELETE /me/skills/swe%3Agit', 'POST /evidence', 'DELETE /evidence/e1', 'POST /evidence/e1/skills/swe%3Agit', 'DELETE /evidence/e1/skills/swe%3Agit']);
    assert.ok(calls.every((c) => c.headers.Authorization === 'Bearer tok'));
    assert.deepEqual(calls[3].body, { level: 3 });
  });
  it('the careers feature is routed to the backend once a base URL is set', () => { assert.equal(api.useBackend('careers'), true); });
  it('maps an API career model onto the existing Career shape, keeping unassessed skills distinct from level 0', () => {
    const { career } = CAREER_DATASETS[0];
    const model: ApiCareerModel = {
      career: { id: career.id, name: career.name, category: career.category, description: career.description, source: 'seed', evidenceExpectations: career.evidenceExpectations ?? [] },
      capabilities: career.capabilities.map((c, i) => ({ id: c.id, careerId: career.id, name: c.name, description: '', position: i })),
      skills: career.capabilities.flatMap((c) => c.skills.map((s) => ({ id: s.id, name: s.name, description: '', category: c.name }))),
      requirements: career.capabilities.flatMap((c, ci) => c.skills.map((s, si) => ({ careerId: career.id, skillId: s.id, capabilityId: c.id, requiredLevel: s.requiredLevel, importance: 3, position: ci * 100 + si }))),
    };
    const out = toCareer(model, { [career.capabilities[0].skills[0].id]: 4 });
    assert.deepEqual(out.capabilities.map((c) => c.id), career.capabilities.map((c) => c.id));
    assert.deepEqual(out.capabilities.map((c) => c.skills.map((s) => [s.id, s.requiredLevel])), career.capabilities.map((c) => c.skills.map((s) => [s.id, s.requiredLevel])));
    assert.equal(out.capabilities[0].skills[0].currentLevel, 4);
    assert.equal(out.capabilities[0].skills[1].currentLevel, 0);
  });
});
