import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAREER_DATASETS } from '../src/domain/shared';
import { buildSeedStatements, runSeed } from '../src/db/seeding';
import { FakeDb } from './helpers';

const stmts = buildSeedStatements(CAREER_DATASETS);
const into = (t: string) => stmts.filter((s) => s.text.includes(`INSERT INTO ${t} `));
describe('seed statements', () => {
  it('cover every seeded career, capability, skill and requirement', () => {
    const caps = CAREER_DATASETS.flatMap((d) => d.career.capabilities), skills = caps.flatMap((c) => c.skills);
    assert.equal(into('careers').length, CAREER_DATASETS.length); assert.equal(into('career_capabilities').length, caps.length);
    assert.equal(into('skills').length, skills.length); assert.equal(into('career_skills').length, skills.length);
    assert.ok(CAREER_DATASETS.length >= 3);
  });
  it('are idempotent upserts and fully parameterized', () => {
    for (const s of stmts) { assert.match(s.text, /ON CONFLICT/); assert.match(s.text, /\$1/); }
    assert.ok(!stmts.some((s) => /VALUES \(\s*'(ux|fin|swe)/.test(s.text)), 'ids are bound parameters, not inlined');
  });
  it('insert parents before children so foreign keys hold', () => {
    const order = stmts.map((s) => /INSERT INTO (\w+)/.exec(s.text)?.[1]);
    const first = (t: string) => order.indexOf(t), last = (t: string) => order.lastIndexOf(t);
    assert.ok(last('careers') < first('career_capabilities')); assert.ok(last('career_capabilities') < first('career_skills')); assert.ok(last('skills') < first('career_skills'));
  });
  it('carry valid required levels and unique ids; seed no user evidence', () => {
    const reqs = into('career_skills'); assert.ok(reqs.every((s) => (s.params[3] as number) >= 1 && (s.params[3] as number) <= 5));
    const ids = into('skills').map((s) => s.params[0]); assert.equal(new Set(ids).size, ids.length);
    assert.equal(stmts.filter((s) => /INTO (evidence|skill_assessments|profiles|users)\b/.test(s.text)).length, 0);
  });
  it('runs inside one transaction and can be repeated', async () => {
    const db = new FakeDb(); const a = await runSeed(db, CAREER_DATASETS); await runSeed(db, CAREER_DATASETS);
    assert.equal(a.statements, stmts.length); assert.equal(db.committed, 2); assert.equal(db.queries.length, stmts.length * 2);
  });
  it('rolls back the whole seed on failure', async () => {
    const db = new FakeDb(); db.failOn = /career_skills/;
    await assert.rejects(() => runSeed(db, CAREER_DATASETS), /simulated/); assert.equal(db.rolledBack, 1);
  });
});
