import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CAREER_DATASETS } from '../src/domain/shared';
import { readMigrations, runMigrations } from '../src/db/migrations';
import { DEMO_MENTORS } from '../src/domain/demoMentors';
import { runMentorshipSeed } from '../src/db/seedMentorship';
import { runSeed } from '../src/db/seeding';
import type { Db } from '../src/db/types';
import { createHandler } from '../src/http/handler';
import { routes } from '../src/routes';
import { checkDatabase } from '../src/routes/health';
import { createPgCoreRepos } from '../src/repositories/pg-core';
import { createPgMentorshipRepos } from '../src/repositories/pg-mentorship';
import { createPgPaymentRepos } from '../src/repositories/pg-payments';
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
  const services = createServices({ repos: { ...createPgRepos(db), ...createPgCoreRepos(db), ...createPgProgressRepos(db), ...createPgMentorshipRepos(db), ...createPgPaymentRepos(db) }, config, now });
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
      await runMentorshipSeed(db);
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
    it('mentorship: migration 005 is recorded, the demo seed is repeatable, and bookings take their price from the database', async () => {
      assert.ok((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.some((r) => r.name === '005_mentorship.sql'));
      await runMentorshipSeed(db); // a second run changes nothing
      const a = await reg('book-a'), b = await reg('book-b'); const sessionId = DEMO_MENTORS[0].sessions[0].id;
      const list = await call('GET', '/api/mentors', { token: a.token }); assert.equal(list.status, 200); assert.ok(list.body.mentors.some((m: { id: string; isDemo: boolean }) => m.id === DEMO_MENTORS[0].id && m.isDemo));
      const made = await call('POST', '/api/bookings', { token: a.token, body: { sessionId, amount: '0.01', userId: b.user.id, status: 'confirmed' } });
      assert.equal(made.status, 201, JSON.stringify(made.body)); assert.equal(made.body.booking.amount, DEMO_MENTORS[0].sessions[0].price); assert.equal(made.body.booking.status, 'pending_payment');
      const row = (await db.query<{ user_id: string; amount: string; status: string }>('SELECT user_id, amount::text AS amount, status FROM bookings WHERE id = $1', [made.body.booking.id])).rows[0];
      assert.deepEqual(row, { user_id: a.user.id, amount: DEMO_MENTORS[0].sessions[0].price, status: 'pending_payment' });
      assert.equal((await call('POST', '/api/bookings', { token: a.token, body: { sessionId } })).status, 409);
      assert.equal((await call('POST', '/api/bookings', { token: a.token, body: { sessionId: '00000000-0000-4000-8000-0000000fffff' } })).status, 404);
      assert.equal((await call('GET', '/api/bookings', { token: a.token })).body.bookings.length, 1); assert.equal((await call('GET', '/api/bookings', { token: b.token })).body.bookings.length, 0);
    });
    it('mentors follow the career in PostgreSQL: Lawyer -> legal mentor, Software Engineer -> technology mentor, bad sessions refused, context kept', async () => {
      assert.ok((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.some((r) => r.name === '007_mentor_fields.sql'));
      const a = await reg('mc-a'), b = await reg('mc-b');
      const made = await call('POST', '/api/careers', { token: a.token, body: { ...LAW, name: `Corporate Lawyer ${TAG} mc` } }); assert.equal(made.status, 201); const lawyer = made.body.career.id as string; createdCareers.push(lawyer);
      const LAWM = DEMO_MENTORS.find((m) => m.fields.includes('law'))!, SWEM = DEMO_MENTORS.find((m) => m.fields.includes('technology'))!;
      const ids = async (c: string, t = a.token) => ((await call('GET', `/api/mentors?careerId=${c}`, { token: t })).body.mentors as { id: string }[]).map((m) => m.id);
      assert.deepEqual(await ids(lawyer), [LAWM.id]); assert.deepEqual(await ids('swe'), [SWEM.id]);
      assert.equal((await call('GET', `/api/mentors?careerId=${lawyer}`, { token: b.token })).body.error.code, 'career_not_found'); // another student's private career
      const bad = await call('POST', '/api/bookings', { token: a.token, body: { sessionId: SWEM.sessions[0].id, careerId: lawyer } });
      assert.equal(bad.status, 409); assert.equal(bad.body.error.code, 'session_not_for_career');
      const ok = await call('POST', '/api/bookings', { token: a.token, body: { sessionId: LAWM.sessions[0].id, careerId: lawyer } });
      assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.booking.career.id, lawyer); assert.equal(ok.body.booking.mentor.id, LAWM.id); assert.equal(ok.body.booking.amount, LAWM.sessions[0].price);
      // The database itself refuses a mismatched booking even if the service check were bypassed.
      assert.equal(await createPgMentorshipRepos(db).createBooking((await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [`${TAG}-mc-a@example.test`])).rows[0].id, SWEM.sessions[1].id, { careerId: lawyer, careerName: 'x', field: 'law' }), null);
      assert.equal(await createPgMentorshipRepos(db).createBooking((await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [`${TAG}-mc-b@example.test`])).rows[0].id, SWEM.sessions[1].id, null).then((x) => x?.career ?? null), null);
      // Deleting the career keeps the booking and clears only its career.
      assert.equal((await call('DELETE', `/api/careers/${lawyer}`, { token: a.token })).status, 204);
      const left = (await call('GET', '/api/bookings', { token: a.token })).body.bookings as { career: unknown }[]; assert.equal(left.length, 1); assert.equal(left[0].career, null);
    });
    it('payments: migration 006 is recorded and the payment rules hold in PostgreSQL (price snapshot, one live order, atomic confirm, user scoping)', async () => {
      assert.ok((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.some((r) => r.name === '006_payments.sql'));
      const a = await reg('pay-a'), b = await reg('pay-b'); const pay = createPgPaymentRepos(db), sessionId = DEMO_MENTORS[0].sessions[0].id;
      const booking = (await call('POST', '/api/bookings', { token: a.token, body: { sessionId } })).body.booking.id as string;
      assert.equal(await pay.createPayment(b.user.id, booking, `PGORD-${TAG}-x`), null); // not this user's booking
      const p = await pay.createPayment(a.user.id, booking, `PGORD-${TAG}-1`);
      assert.ok(p && p.status === 'created' && p.amount === DEMO_MENTORS[0].sessions[0].price && p.currency === 'USD' && p.captureId === null);
      await assert.rejects(pay.createPayment(a.user.id, booking, `PGORD-${TAG}-2`), (e: unknown) => (e as { status?: number }).status === 409); // one live order per booking
      assert.equal(await pay.completePayment(b.user.id, booking, `PGORD-${TAG}-1`, `PGCAP-${TAG}-1`), null); // another user cannot complete it
      assert.equal((await call('GET', '/api/bookings', { token: a.token })).body.bookings[0].status, 'pending_payment');
      const done = await pay.completePayment(a.user.id, booking, `PGORD-${TAG}-1`, `PGCAP-${TAG}-1`);
      assert.ok(done && done.status === 'completed' && done.captureId === `PGCAP-${TAG}-1`);
      assert.equal((await call('GET', '/api/bookings', { token: a.token })).body.bookings[0].status, 'confirmed');
      assert.equal(await pay.completePayment(a.user.id, booking, `PGORD-${TAG}-1`, `PGCAP-${TAG}-1`), null); // second completion changes nothing
      assert.equal(await pay.createPayment(a.user.id, booking, `PGORD-${TAG}-3`), null); // a confirmed booking cannot be paid again
      assert.deepEqual((await pay.listPayments(b.user.id, booking)), []); assert.equal((await pay.listPayments(a.user.id, booking)).length, 1);
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
