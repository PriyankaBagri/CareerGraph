import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DEMO_MENTORS } from '../src/domain/demoMentors';
import { makeApp } from './helpers';

// Regression: mentors had no link to careers, so every student saw every mentor (a Lawyer saw Software Engineering sessions).
const LAW = DEMO_MENTORS.find((m) => m.fields.includes('law'))!, SWE = DEMO_MENTORS.find((m) => m.fields.includes('technology'))!;
type Body = Record<string, any>;

const SKILL = { name: 'Core skill', requiredLevel: 3, importance: 3 };
async function setup() {
  const app = makeApp();
  const reg = async (email: string) => (await app.call('POST', '/api/auth/register', { body: { name: 'Test User', email, password: 'Passw0rdOK1' } })).body.token as string;
  const token = await reg('a@x.com');
  // A student's own career, created through the real API exactly as the Career Explorer does.
  const make = async (t: string, name: string, category: string) => (await app.call('POST', '/api/careers', { token: t, body: { name, category, description: 'x', evidenceExpectations: [], capabilities: [{ name: 'Basics', description: 'x', skills: [SKILL] }] } })).body.career.id as string;
  return { app, token, reg, make };
}
const mentorsFor = async (app: ReturnType<typeof makeApp>, token: string, careerId: string) => (await app.call('GET', `/api/mentors?careerId=${careerId}`, { token })).body.mentors as { id: string; fields: string[] }[];

describe('mentors follow the selected career', () => {
  it('the data model links every demo mentor to at least one field, and sessions to their mentor', () => {
    for (const m of DEMO_MENTORS) { assert.ok(m.fields.length > 0, m.displayName); assert.ok(m.fields.every((f) => f === f.trim().toLowerCase())); assert.ok(m.sessions.length > 0); }
    assert.equal(new Set(DEMO_MENTORS.flatMap((m) => m.sessions.map((s) => s.id))).size, DEMO_MENTORS.flatMap((m) => m.sessions).length);
  });
  it('Software Engineer shows only technology mentors; Finance only finance; UX only design', async () => {
    const { app, token } = await setup();
    for (const [careerId, field] of [['swe', 'technology'], ['fin', 'finance'], ['ux', 'design']] as const) {
      const r = await app.call('GET', `/api/mentors?careerId=${careerId}`, { token }); assert.equal(r.status, 200);
      const mentors = r.body.mentors as { fields: string[] }[]; assert.ok(mentors.length > 0, careerId); assert.ok(mentors.every((m) => m.fields.includes(field)), careerId);
      assert.equal(r.body.career.id, careerId);
    }
    assert.ok(!JSON.stringify((await app.call('GET', '/api/mentors?careerId=swe', { token })).body).includes('Demo Mentor: Law'));
  });
  it('Lawyer (a student-created career in the "Law" field) shows only the legal mentor and legal sessions', async () => {
    const { app, token, make } = await setup(); const lawyer = await make(token, 'Corporate Lawyer', 'Law');
    const r = await app.call('GET', `/api/mentors?careerId=${lawyer}`, { token }); assert.equal(r.body.career.field, 'law');
    assert.deepEqual((r.body.mentors as { id: string }[]).map((m) => m.id), [LAW.id]);
    const detail = (await app.call('GET', `/api/mentors/${LAW.id}`, { token })).body as { sessions: { title: string }[] };
    assert.deepEqual(detail.sessions.map((x) => x.title).sort(), LAW.sessions.map((x) => x.title).sort());
  });
  it('switching careers changes the mentors: Lawyer -> Software Engineer -> Lawyer', async () => {
    const { app, token, make } = await setup(); const lawyer = await make(token, 'Lawyer', 'Legal');
    const ids = async (c: string) => (await mentorsFor(app, token, c)).map((m) => m.id);
    assert.deepEqual(await ids(lawyer), [LAW.id]); assert.deepEqual(await ids('swe'), [SWE.id]); assert.deepEqual(await ids(lawyer), [LAW.id]);
  });
  it('a career with no mentors gets an empty list (never someone else\'s), and "all mentors" is still available', async () => {
    const { app, token, make } = await setup(); const chef = await make(token, 'Chef', 'Culinary');
    const r = await app.call('GET', `/api/mentors?careerId=${chef}`, { token }); assert.equal(r.status, 200); assert.deepEqual(r.body.mentors, []);
    const all = await app.call('GET', '/api/mentors', { token }); assert.equal(all.body.career, null); assert.equal(all.body.mentors.length, DEMO_MENTORS.length);
  });
  it('rejects an unknown career, another student\'s private career, and a malformed career id', async () => {
    const { app, token, reg, make } = await setup(); const mine = await make(token, 'Lawyer', 'Law'); const other = await reg('b@x.com');
    assert.equal((await app.call('GET', '/api/mentors?careerId=nope', { token })).body.error.code, 'career_not_found');
    assert.equal((await app.call('GET', `/api/mentors?careerId=${mine}`, { token: other })).body.error.code, 'career_not_found');
    assert.equal((await app.call('GET', '/api/mentors?careerId=%3Cscript%3E', { token })).status, 400);
  });
});

describe('a booking must match the career it was made for', () => {
  it('rejects a session whose mentor does not cover the career (and creates nothing)', async () => {
    const { app, token } = await setup();
    const r = await app.call('POST', '/api/bookings', { token, body: { sessionId: LAW.sessions[0].id, careerId: 'swe' } });
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'session_not_for_career'); assert.equal(app.repos.bookings.size, 0);
  });
  it('accepts a matching session and keeps the career and mentor on the booking', async () => {
    const { app, token } = await setup();
    const r = await app.call('POST', '/api/bookings', { token, body: { sessionId: SWE.sessions[0].id, careerId: 'swe' } });
    assert.equal(r.status, 201); const b = r.body.booking as Body;
    assert.equal(b.career.id, 'swe'); assert.equal(b.mentor.id, SWE.id); assert.equal(b.session.title, SWE.sessions[0].title); assert.equal(b.status, 'pending_payment');
    const list = (await app.call('GET', '/api/bookings', { token })).body.bookings as Body[]; assert.equal(list[0].career.id, 'swe');
  });
  it('still allows a booking with no career (from "all mentors") and records no career', async () => {
    const { app, token } = await setup();
    const r = await app.call('POST', '/api/bookings', { token, body: { sessionId: LAW.sessions[0].id } });
    assert.equal(r.status, 201); assert.equal(r.body.booking.career, null);
  });
  it('a Lawyer can book a legal session but not a software session, and the booking keeps the Law career', async () => {
    const { app, token, make } = await setup(); const lawyer = await make(token, 'Corporate Lawyer', 'Law');
    const bad = await app.call('POST', '/api/bookings', { token, body: { sessionId: SWE.sessions[0].id, careerId: lawyer } });
    assert.equal(bad.body.error.code, 'session_not_for_career'); assert.equal(app.repos.bookings.size, 0);
    const ok = await app.call('POST', '/api/bookings', { token, body: { sessionId: LAW.sessions[0].id, careerId: lawyer } });
    assert.equal(ok.status, 201); assert.equal(ok.body.booking.career.name, 'Corporate Lawyer'); assert.equal(ok.body.booking.mentor.id, LAW.id);
  });
  it('rejects an unknown career id; a price or user id sent with the booking is ignored', async () => {
    const { app, token } = await setup();
    assert.equal((await app.call('POST', '/api/bookings', { token, body: { sessionId: SWE.sessions[0].id, careerId: 'nope' } })).body.error.code, 'career_not_found');
    const r = await app.call('POST', '/api/bookings', { token, body: { sessionId: SWE.sessions[0].id, careerId: 'swe', amount: '0.01', userId: 'x' } });
    assert.equal(r.status, 201); assert.equal(r.body.booking.amount, SWE.sessions[0].price);
  });
});

describe('database relationships (static checks of migration 007 and the PostgreSQL repository)', () => {
  const sql = readFileSync(new URL('../migrations/007_mentor_fields.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  const pg = readFileSync(new URL('../src/repositories/pg-mentorship.ts', import.meta.url), 'utf8');
  it('mentor_fields references mentors with a foreign key and bookings.career_id references careers; nothing is dropped', () => {
    assert.match(sql, /mentor_id uuid NOT NULL REFERENCES mentors \(id\) ON DELETE CASCADE/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS career_id text REFERENCES careers \(id\) ON DELETE SET NULL/);
    assert.ok(!/\b(DROP|TRUNCATE|DELETE FROM|UPDATE)\b/i.test(sql)); assert.ok(!/CREATE TABLE(?! IF NOT EXISTS)/.test(sql));
  });
  it('the PostgreSQL booking INSERT itself checks the mentor field, not only the service', () => {
    assert.match(pg, /EXISTS \(SELECT 1 FROM mentor_fields f WHERE f\.mentor_id = m\.id AND f\.field = \$4\)/);
    assert.match(pg, /EXISTS \(SELECT 1 FROM mentor_fields f WHERE f\.mentor_id = m\.id AND f\.field = \$1\)/);
  });
});
