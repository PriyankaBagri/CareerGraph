import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CAREER_DATASETS } from '../src/domain/shared';
import { readMigrations, runMigrations } from '../src/db/migrations';
import { runSeed } from '../src/db/seeding';
import type { Db } from '../src/db/types';
import { createHandler } from '../src/http/handler';
import { routes } from '../src/routes';
import { checkDatabase } from '../src/routes/health';
import { createPgCoreRepos } from '../src/repositories/pg-core';
import { createPgProgressRepos } from '../src/repositories/pg-progress';
import { createPgRepos } from '../src/repositories/pg';
import { createServices } from '../src/services';
import { silentLogger } from '../src/logger';
import { testConfig } from './helpers';

// Real-PostgreSQL integration suite. It is only ever pointed at a database whose name ends in "_test" (see pg.integration.test.ts).
// It applies the existing migrations and seed to THAT database (both idempotent), creates its own throw-away users, and removes only what it created.
const TAG = `pgtest-${Date.now().toString(36)}`;
const LAW = { name: `Corporate Lawyer ${TAG}`, category: 'Law', description: 'd', evidenceExpectations: ['Memo'], capabilities: [{ name: 'Foundations', skills: [{ name: 'Legal research', requiredLevel: 4, importance: 5 }, { name: 'Drafting', requiredLevel: 3 }] }] };

export function registerPgSuite(db: Db, label: string): void {
  const config = testConfig(); const now = () => new Date();
  const services = createServices({ repos: { ...createPgRepos(db), ...createPgCoreRepos(db), ...createPgProgressRepos(db) }, config, now });
  const handler = createHandler(routes, { config, db, logger: silentLogger, services, now, version: 'pg-test', healthTimeoutMs: 6000 });
  type Res = { status: number; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const call = async (method: string, path: string, o: { body?: unknown; token?: string } = {}): Promise<Res> => {
    const [p, qs = ''] = path.split('?');
    const r = await handler({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs)), headers: o.token ? { authorization: `Bearer ${o.token}` } : {}, body: o.body });
    return { status: r.status, body: r.body as Res['body'] };
  };
  const reg = async (n: string) => { const r = await call('POST', '/api/auth/register', { body: { name: 'Pg Test', email: `${TAG}-${n}@example.test`, password: 'Passw0rdOK1' } }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body as { token: string; user: { id: string } }; };
  const createdCareers: string[] = [];

  describe(`real PostgreSQL integration (${label})`, () => {
    before(async () => {
      const dir = fileURLToPath(new URL('../migrations', import.meta.url));
      await runMigrations(db, readMigrations(dir));
      await runSeed(db, CAREER_DATASETS);
    });
    after(async () => {
      await db.query('DELETE FROM users WHERE email LIKE $1', [`${TAG}-%`]);
      for (const id of createdCareers) { await db.query('DELETE FROM careers WHERE id = $1', [id]); await db.query('DELETE FROM skills WHERE starts_with(id, $1)', [`${id}:`]); } // only what THIS run created
    });

    it('the four recorded migrations are present and the health check sees the database', async () => {
      const names = (await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name);
      for (const m of ['001_initial_schema.sql', '002_auth_profile.sql', '003_career_core.sql', '004_evaluation_rules.sql']) assert.ok(names.includes(m), m);
      assert.deepEqual(await checkDatabase(db, 6000), { up: true });
    });
    it('duplicate sign-up is a 409 (driver SQLSTATE 23505), wrong password is a 401, and tokens only open their own data', async () => {
      const a = await reg('dup');
      assert.equal((await call('POST', '/api/auth/register', { body: { name: 'X Y', email: `${TAG}-dup@example.test`, password: 'Passw0rdOK1' } })).status, 409);
      assert.equal((await call('POST', '/api/auth/login', { body: { email: `${TAG}-dup@example.test`, password: 'wrong-Password1' } })).status, 401);
      assert.equal((await call('GET', '/api/auth/me', { token: a.token })).status, 200);
    });
    it('standard careers stay available; custom careers: create, list, edit, delete, ownership, validation', async () => {
      const a = await reg('a'), b = await reg('b');
      const names = (await call('GET', '/api/careers', { token: a.token })).body.careers.map((c: { name: string }) => c.name).join('|'); for (const n of ['Software Engineer', 'UX Designer', 'Financial Analyst']) assert.match(names, new RegExp(n));
      const made = await call('POST', '/api/careers', { token: a.token, body: LAW }); assert.equal(made.status, 201, JSON.stringify(made.body)); const id = made.body.career.id as string; createdCareers.push(id);
      assert.ok(!(await call('GET', '/api/careers', { token: b.token })).body.careers.some((c: { id: string }) => c.id === id));
      for (const [m, p] of [['GET', `/api/careers/${id}`], ['GET', `/api/careers/${id}/readiness`], ['PUT', `/api/careers/${id}`], ['DELETE', `/api/careers/${id}`]]) assert.equal((await call(m, p, { token: b.token, body: LAW })).status, 404, `${m} ${p}`);
      assert.equal((await call('POST', '/api/careers', { token: a.token, body: { ...LAW, capabilities: [] } })).status, 400);
      const seeded = (await call('GET', '/api/careers', { token: a.token })).body.careers.find((c: { source: string }) => c.source === 'seed').id;
      assert.equal((await call('DELETE', `/api/careers/${seeded}`, { token: a.token })).status, 404);
      const [s1, s2] = made.body.requirements.map((r: { skillId: string }) => r.skillId) as string[];
      await call('PUT', `/api/me/skills/${encodeURIComponent(s1)}`, { token: a.token, body: { level: 4 } }); await call('PUT', `/api/me/skills/${encodeURIComponent(s2)}`, { token: a.token, body: { level: 1 } });
      const upd = await call('PUT', `/api/careers/${id}`, { token: a.token, body: { ...LAW, capabilities: [{ id: made.body.capabilities[0].id, name: 'Foundations', skills: [{ id: s1, name: 'Legal research', requiredLevel: 5 }, { name: 'New skill', requiredLevel: 2 }] }] } });
      assert.equal(upd.status, 200, JSON.stringify(upd.body)); const ids = upd.body.requirements.map((r: { skillId: string }) => r.skillId); assert.ok(ids.includes(s1) && !ids.includes(s2));
      assert.deepEqual((await call('GET', '/api/me/skills', { token: a.token })).body.skills.map((x: { skillId: string }) => x.skillId), [s1]);
      assert.equal((await call('DELETE', `/api/careers/${id}`, { token: a.token })).status, 204); assert.equal((await call('GET', `/api/careers/${id}`, { token: a.token })).status, 404);
    });
    it('a custom career runs through skills -> evidence -> readiness -> gaps -> actions, with unassessed kept distinct', async () => {
      const a = await reg('flow'); const made = await call('POST', '/api/careers', { token: a.token, body: { ...LAW, name: `Teacher ${TAG}` } }); const id = made.body.career.id as string; createdCareers.push(id);
      const [s1] = made.body.requirements.map((r: { skillId: string }) => r.skillId) as string[];
      assert.equal((await call('GET', `/api/careers/${id}/readiness`, { token: a.token })).body.state, 'not_assessed');
      await call('PUT', `/api/me/skills/${encodeURIComponent(s1)}`, { token: a.token, body: { level: 2 } });
      const ev = await call('POST', '/api/evidence', { token: a.token, body: { title: 'Lesson plan', description: 'd', type: 'Project', strength: 'strong', skillIds: [s1] } }); assert.equal(ev.status, 201);
      const gaps = (await call('GET', `/api/careers/${id}/gaps`, { token: a.token })).body; assert.equal(gaps.below.length, 1); assert.equal(gaps.unassessed.length, 1);
      assert.equal((await call('GET', `/api/careers/${id}/readiness`, { token: a.token })).body.state, 'partial');
      assert.ok((await call('GET', `/api/careers/${id}/actions`, { token: a.token })).body.actions.length > 0);
    });
    it('persists profile details, target career (shared and own custom), action progress and settings per user, and deleting the career removes its progress', async () => {
      const a = await reg('pa'), b = await reg('pb');
      const id = (await call('POST', '/api/careers', { token: a.token, body: { ...LAW, name: `Persist ${TAG}` } })).body.career.id as string; createdCareers.push(id);
      assert.equal((await call('PUT', '/api/profile', { token: a.token, body: { targetCareerId: id, stage: 'Early Career', experienceLevel: 'early', onboardingComplete: true, completeness: 70 } })).status, 200);
      const prof = (await call('GET', '/api/profile', { token: a.token })).body; assert.equal(prof.targetCareerId, id); assert.equal(prof.onboardingComplete, true); assert.equal(prof.completeness, 70);
      assert.equal((await call('PUT', '/api/profile', { token: b.token, body: { targetCareerId: id } })).status, 400); // not B's career
      const action = { title: 'Raise skill', description: 'd', type: 'build_skill', phase: 'skill_building', priority: 'high', priorityScore: 60, impact: 'high', effort: 'medium', estimatedTime: '2-4 weeks', reason: 'r', prerequisites: [], relatedSkillIds: [], relatedCapabilityIds: [] };
      const put = (token: string, st: string) => call('PUT', `/api/careers/${id}/action-progress/${encodeURIComponent('build:1')}`, { token, body: { status: st, action } });
      assert.equal((await put(a.token, 'in_progress')).status, 200); assert.equal((await put(a.token, 'completed')).body.status, 'completed');
      assert.equal((await call('GET', `/api/careers/${id}/action-progress`, { token: a.token })).body.items.length, 1);
      assert.equal((await put(b.token, 'completed')).status, 404);
      assert.equal((await call('PUT', '/api/settings', { token: a.token, body: { reduceMotion: true } })).body.reduceMotion, true);
      assert.equal((await call('PUT', '/api/settings', { token: a.token, body: { assistantSuggestions: false } })).body.reduceMotion, true);
      assert.equal((await call('GET', '/api/settings', { token: b.token })).body.reduceMotion, false);
      assert.equal((await call('DELETE', `/api/careers/${id}`, { token: a.token })).status, 204);
      assert.equal((await call('GET', '/api/profile', { token: a.token })).body.targetCareerId, null); // FK ON DELETE SET NULL
      assert.equal((await db.query('SELECT 1 FROM actions WHERE career_id = $1', [id])).rowCount, 0); // progress cascades with the career
    });
    it('migration 004 SQL is idempotent, and evaluation rules / minimum evidence persist, apply to readiness and cascade away with the career', async () => {
      const dir = fileURLToPath(new URL('../migrations', import.meta.url));
      const m4 = readMigrations(dir).find((m) => m.name === '004_evaluation_rules.sql');
      assert.ok(m4); await db.query(m4.sql); await db.query(m4.sql); // running the file again changes nothing and does not fail
      const a = await reg('rules');
      const body = { ...LAW, name: `Rules ${TAG}`, evaluationRules: { levelWeight: 0.9 }, capabilities: [{ name: 'Foundations', skills: [{ name: 'Legal research', requiredLevel: 4, importance: 5, minEvidence: 2 }, { name: 'Drafting', requiredLevel: 3 }] }] };
      const made = await call('POST', '/api/careers', { token: a.token, body }); assert.equal(made.status, 201, JSON.stringify(made.body)); createdCareers.push(made.body.career.id);
      assert.deepEqual(made.body.career.evaluationRules, { levelWeight: 0.9 }); assert.equal(made.body.requirements[0].minEvidence, 2); assert.equal(made.body.requirements[1].minEvidence, null);
      const id = made.body.career.id as string, sk = made.body.requirements[0].skillId as string;
      await call('PUT', `/api/me/skills/${encodeURIComponent(sk)}`, { token: a.token, body: { level: 4 } });
      const r = (await call('GET', `/api/careers/${id}/readiness`, { token: a.token })).body; assert.equal(r.evaluation.source, 'custom'); assert.equal(r.skills.find((x: { skillId: string }) => x.skillId === sk).evidenceRequired, 2);
      assert.equal((await call('GET', '/api/careers/swe/readiness', { token: a.token })).body.evaluation.source, 'default');
      assert.equal((await call('PUT', `/api/careers/${id}`, { token: a.token, body: { ...body, evaluationRules: undefined } })).body.career.evaluationRules, null);
      const nd = await call('POST', '/api/careers', { token: a.token, body: { ...LAW, name: `NoDesc ${TAG}`, description: '' } }); assert.equal(nd.status, 201, JSON.stringify(nd.body)); createdCareers.push(nd.body.career.id); // empty description is valid
    });
    it('stores per-career evaluation rules and per-skill minimum evidence (migration 004), applies them to readiness, and re-running the migrations is a no-op', async () => {
      const dir = fileURLToPath(new URL('../migrations', import.meta.url));
      const before = (await db.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0] as { n: number };
      await runMigrations(db, readMigrations(dir)); // idempotent: already applied -> nothing happens
      assert.equal(((await db.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0] as { n: number }).n, before.n);
      const a = await reg('rl1'), b = await reg('rl2');
      const body = { ...LAW, name: `Rules ${TAG}`, evaluationRules: { levelWeight: 0.9 }, capabilities: [{ name: 'Foundations', skills: [{ name: 'Legal research', requiredLevel: 4, importance: 5, minEvidence: 2 }, { name: 'Drafting', requiredLevel: 3 }] }] };
      const made = await call('POST', '/api/careers', { token: a.token, body }); assert.equal(made.status, 201, JSON.stringify(made.body)); createdCareers.push(made.body.career.id);
      assert.deepEqual(made.body.career.evaluationRules, { levelWeight: 0.9 }); assert.equal(made.body.requirements[0].minEvidence, 2); assert.equal(made.body.requirements[1].minEvidence, null);
      const id = made.body.career.id as string, sk = made.body.requirements[0].skillId as string;
      assert.equal((await call('PUT', `/api/me/skills/${encodeURIComponent(sk)}`, { token: a.token, body: { level: 4 } })).status, 200);
      const r = (await call('GET', `/api/careers/${id}/readiness`, { token: a.token })).body; assert.equal(r.evaluation.source, 'custom'); assert.equal(r.skills.find((x: { skillId: string }) => x.skillId === sk).evidenceRequired, 2);
      assert.equal((await call('GET', '/api/careers/swe/readiness', { token: a.token })).body.evaluation.source, 'default'); // seeded careers keep the defaults
      assert.equal((await call('PUT', `/api/careers/${id}`, { token: b.token, body })).status, 404);
      assert.equal((await call('PUT', `/api/careers/${id}`, { token: a.token, body: { ...body, evaluationRules: undefined } })).body.career.evaluationRules, null);
      assert.equal((await call('POST', '/api/careers', { token: a.token, body: { ...body, evaluationRules: { levelWeight: 9 } } })).status, 400);
    });
    it('deleting an owner at the database level leaves no public career behind', async () => {
      const o = await reg('owner'), other = await reg('other'); const id = (await call('POST', '/api/careers', { token: o.token, body: { ...LAW, name: `Orphan ${TAG}` } })).body.career.id as string; createdCareers.push(id);
      await db.query('DELETE FROM users WHERE id = $1', [o.user.id]);
      assert.equal((await call('GET', `/api/careers/${id}`, { token: other.token })).status, 404);
    });
  });
}
