import type { Db } from '../db/types';
import type { AssessmentRecord, CareerModelRecord, CareerSummaryRecord, CoreRepos, CustomCareerInput, EvidenceRecord } from './core-types';
import type { Queryable } from '../db/types';
import { AppError } from '../errors';

// Every column the SQL below touches is declared here, so tests can check the list against migrations 001-003 (no typos reach production).
export const COLUMNS = {
  careers: ['id', 'name', 'category', 'description', 'source', 'evidence_expectations'],
  career_capabilities: ['id', 'career_id', 'name', 'description', 'position'],
  career_skills: ['career_id', 'skill_id', 'capability_id', 'required_level', 'importance', 'position'],
  skills: ['id', 'name', 'description', 'category'],
  skill_assessments: ['user_id', 'skill_id', 'level', 'source', 'assessed_at', 'updated_at'],
  evidence: ['id', 'user_id', 'title', 'type', 'description', 'url', 'evidence_date', 'organization', 'strength', 'source', 'created_at', 'updated_at'],
  evidence_skills: ['evidence_id', 'skill_id'],
  custom_careers: ['career_id', 'user_id'],
} as const;
// Columns added by migration 004 (additive). Until it has been applied the API keeps working with the built-in defaults; saving custom rules then returns a clear 409.
export const COLUMNS_004 = { careers: ['evaluation_rules'], career_skills: ['min_evidence'] } as const;
const pick = (alias: string, table: keyof typeof COLUMNS, names: string[]) => names.map((n) => { if (!(COLUMNS[table] as readonly string[]).includes(n)) throw new Error(`${table}.${n} not declared`); return `${alias}.${n}`; }).join(', ');

// Shared (seeded) careers are visible to everyone; a custom/AI career only to its owner. A non-seed career with NO ownership row (for example
// left behind when its owner's account was deleted at the database level) is visible to nobody rather than becoming public. $1 is always the authenticated user id.
const VISIBLE = `(c.source = 'seed' OR EXISTS (SELECT 1 FROM custom_careers cc WHERE cc.career_id = c.id AND cc.user_id = $1))`;
const CAREER_COLS = pick('c', 'careers', ['id', 'name', 'category', 'description', 'source']);
const EVIDENCE_COLS = COLUMNS.evidence.filter((c) => c !== 'user_id').map((c) => (c === 'evidence_date' ? `to_char(e.evidence_date, 'YYYY-MM-DD') AS evidence_date` : `e.${c}`)).join(', ');
const EVIDENCE_SELECT = `SELECT ${EVIDENCE_COLS}, COALESCE(array_agg(es.skill_id ORDER BY es.skill_id) FILTER (WHERE es.skill_id IS NOT NULL), '{}') AS skill_ids FROM evidence e LEFT JOIN evidence_skills es ON es.evidence_id = e.id`;
const ASSESSMENT_COLS = 'skill_id, level, source, assessed_at, updated_at';
// Column names in updates come from this fixed map, never from request data. Values are bound parameters.
const EVIDENCE_PATCH: Record<string, string> = { title: 'title', description: 'description', type: 'type', url: 'url', date: 'evidence_date', organization: 'organization', strength: 'strength' };

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const mapEvidence = (r: Row): EvidenceRecord => ({ id: String(r.id), title: String(r.title), description: String(r.description), type: String(r.type), url: (r.url as string | null) ?? null, date: (r.evidence_date as string | null) ?? null, organization: (r.organization as string | null) ?? null, strength: String(r.strength), source: String(r.source), skillIds: (r.skill_ids as string[]) ?? [], createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) });
const mapAssessment = (r: Row): AssessmentRecord => ({ skillId: String(r.skill_id), level: Number(r.level), source: String(r.source), assessedAt: iso(r.assessed_at), updatedAt: iso(r.updated_at) });

// Writes a custom career's capabilities, skills and requirements. All values are bound parameters; ids were validated by the service.
async function writeCareerStructure(tx: Queryable, careerId: string, input: CustomCareerInput, has004: boolean): Promise<void> {
  if (!has004 && input.capabilities.some((c) => c.skills.some((k) => k.minEvidence))) throw migrationRequired();
  const keep: string[] = [];
  let pos = 0;
  for (const [ci, cap] of input.capabilities.entries()) {
    await tx.query('INSERT INTO career_capabilities (id, career_id, name, description, position) VALUES ($1, $2, $3, $4, $5)', [cap.id, careerId, cap.name, cap.description, ci]);
    for (const sk of cap.skills) {
      await tx.query('INSERT INTO skills (id, name, description, category) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category', [sk.id, sk.name, sk.description ?? '', cap.name]);
      if (has004) await tx.query('INSERT INTO career_skills (career_id, skill_id, capability_id, required_level, importance, position, min_evidence) VALUES ($1, $2, $3, $4, $5, $6, $7)', [careerId, sk.id, cap.id, sk.requiredLevel, sk.importance, pos++, sk.minEvidence ?? null]);
      else await tx.query('INSERT INTO career_skills (career_id, skill_id, capability_id, required_level, importance, position) VALUES ($1, $2, $3, $4, $5, $6)', [careerId, sk.id, cap.id, sk.requiredLevel, sk.importance, pos++]);
      keep.push(sk.id as string);
    }
  }
  // Skills of this career that the edit removed (their ratings/evidence links go with them; the evidence itself is kept).
  await tx.query('DELETE FROM skills WHERE starts_with(id, $1) AND NOT (id = ANY($2::text[]))', [`${careerId}:`, keep]);
}

const migrationRequired = () => new AppError(409, 'migration_required', 'Custom evaluation rules need database migration 004, which has not been applied yet. Ask the administrator to run the migrations.');

export function createPgCoreRepos(db: Db): CoreRepos {
  // Is migration 004 applied? Checked from the catalog (read-only). Only a positive answer is cached, so applying the migration takes effect without a restart.
  let has004Cached = false;
  const has004 = async (q: { query: Db['query'] } = db): Promise<boolean> => {
    if (has004Cached) return true;
    const r = await q.query<{ n: string }>("SELECT count(*)::text AS n FROM information_schema.columns WHERE table_schema = current_schema() AND ((table_name = 'careers' AND column_name = 'evaluation_rules') OR (table_name = 'career_skills' AND column_name = 'min_evidence'))");
    has004Cached = Number(r.rows[0]?.n ?? 0) === 2;
    return has004Cached;
  };
  const fetchEvidence = async (q: { query: Db['query'] }, userId: string, id: string) => {
    const r = await q.query<Row>(`${EVIDENCE_SELECT} WHERE e.user_id = $1 AND e.id = $2 GROUP BY e.id`, [userId, id]);
    return r.rows[0] ? mapEvidence(r.rows[0]) : null;
  };
  return {
    async listCareers(userId): Promise<CareerSummaryRecord[]> {
      const r = await db.query<CareerSummaryRecord>(`SELECT ${CAREER_COLS} FROM careers c WHERE ${VISIBLE} ORDER BY c.source, c.name`, [userId]);
      return r.rows.map((x) => ({ id: x.id, name: x.name, category: x.category, description: x.description, source: x.source }));
    },
    async getCareerModel(userId, careerId): Promise<CareerModelRecord | null> {
      const ext = await has004();
      const c = await db.query<Row>(`SELECT ${CAREER_COLS}, c.evidence_expectations${ext ? ', c.evaluation_rules' : ''} FROM careers c WHERE c.id = $2 AND ${VISIBLE}`, [userId, careerId]);
      if (!c.rows[0]) return null;
      const caps = await db.query<Row>(`SELECT ${pick('k', 'career_capabilities', ['id', 'career_id', 'name', 'description', 'position'])} FROM career_capabilities k WHERE k.career_id = $1 ORDER BY k.position, k.id`, [careerId]);
      const reqs = await db.query<Row>(`SELECT ${pick('cs', 'career_skills', ['career_id', 'skill_id', 'capability_id', 'required_level', 'importance', 'position'])}, s.name AS skill_name, s.description AS skill_description, s.category AS skill_category${ext ? ', cs.min_evidence' : ''} FROM career_skills cs JOIN skills s ON s.id = cs.skill_id WHERE cs.career_id = $1 ORDER BY cs.position, cs.skill_id`, [careerId]);
      const row = c.rows[0];
      return {
        career: { id: String(row.id), name: String(row.name), category: String(row.category), description: String(row.description), source: String(row.source), evidenceExpectations: (row.evidence_expectations as string[]) ?? [], evaluationRules: ext ? (row.evaluation_rules ?? null) : null },
        capabilities: caps.rows.map((k) => ({ id: String(k.id), careerId: String(k.career_id), name: String(k.name), description: String(k.description), position: Number(k.position) })),
        skills: reqs.rows.map((q) => ({ id: String(q.skill_id), name: String(q.skill_name), description: String(q.skill_description ?? ''), category: (q.skill_category as string | null) ?? null })),
        requirements: reqs.rows.map((q) => ({ careerId: String(q.career_id), skillId: String(q.skill_id), capabilityId: String(q.capability_id), requiredLevel: Number(q.required_level), importance: Number(q.importance), position: Number(q.position), minEvidence: ext && q.min_evidence !== null && q.min_evidence !== undefined ? Number(q.min_evidence) : null })),
      };
    },
    async createCustomCareer(userId, careerId, input) {
      await db.transaction(async (tx) => {
        const ext = await has004(tx);
        if (!ext && input.evaluationRules) throw migrationRequired();
        await tx.query("INSERT INTO careers (id, name, category, description, source, evidence_expectations) VALUES ($1, $2, $3, $4, 'custom', $5::text[])", [careerId, input.name, input.category, input.description, input.evidenceExpectations]);
        if (ext && input.evaluationRules) await tx.query('UPDATE careers SET evaluation_rules = $2::jsonb WHERE id = $1', [careerId, JSON.stringify(input.evaluationRules)]);
        await tx.query('INSERT INTO custom_careers (career_id, user_id) VALUES ($1, $2)', [careerId, userId]);
        await writeCareerStructure(tx, careerId, input, ext);
      });
    },
    async updateCustomCareer(userId, careerId, input) {
      return db.transaction(async (tx) => {
        const own = await tx.query('SELECT 1 FROM custom_careers WHERE career_id = $1 AND user_id = $2 FOR UPDATE', [careerId, userId]);
        if (own.rowCount === 0) return false;
        const ext = await has004(tx);
        if (!ext && input.evaluationRules) throw migrationRequired();
        await tx.query('UPDATE careers SET name = $2, category = $3, description = $4, evidence_expectations = $5::text[], updated_at = now() WHERE id = $1', [careerId, input.name, input.category, input.description, input.evidenceExpectations]);
        if (ext) await tx.query('UPDATE careers SET evaluation_rules = $2::jsonb WHERE id = $1', [careerId, input.evaluationRules ? JSON.stringify(input.evaluationRules) : null]);
        await tx.query('DELETE FROM career_capabilities WHERE career_id = $1', [careerId]); // cascades to this career's career_skills rows only
        await writeCareerStructure(tx, careerId, input, ext);
        return true;
      });
    },
    async deleteCustomCareer(userId, careerId) {
      return db.transaction(async (tx) => {
        const del = await tx.query('DELETE FROM careers c USING custom_careers cc WHERE c.id = $2 AND cc.career_id = c.id AND cc.user_id = $1', [userId, careerId]);
        if (del.rowCount === 0) return false;
        await tx.query('DELETE FROM skills WHERE starts_with(id, $1)', [`${careerId}:`]);
        return true;
      });
    },
    async visibleSkillIds(userId, skillIds) {
      if (!skillIds.length) return [];
      const r = await db.query<{ skill_id: string }>(`SELECT DISTINCT cs.skill_id FROM career_skills cs JOIN careers c ON c.id = cs.career_id WHERE cs.skill_id = ANY($2::text[]) AND ${VISIBLE}`, [userId, skillIds]);
      return r.rows.map((x) => x.skill_id);
    },
    async listAssessments(userId) { return (await db.query<Row>(`SELECT ${ASSESSMENT_COLS} FROM skill_assessments WHERE user_id = $1 ORDER BY skill_id`, [userId])).rows.map(mapAssessment); },
    async getAssessment(userId, skillId) { const r = await db.query<Row>(`SELECT ${ASSESSMENT_COLS} FROM skill_assessments WHERE user_id = $1 AND skill_id = $2`, [userId, skillId]); return r.rows[0] ? mapAssessment(r.rows[0]) : null; },
    async upsertAssessment(userId, skillId, level, source) {
      const r = await db.query<Row>(`INSERT INTO skill_assessments (user_id, skill_id, level, source) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, skill_id) DO UPDATE SET level = EXCLUDED.level, source = EXCLUDED.source, updated_at = now() RETURNING ${ASSESSMENT_COLS}`, [userId, skillId, level, source]);
      return mapAssessment(r.rows[0]);
    },
    async deleteAssessment(userId, skillId) { return (await db.query('DELETE FROM skill_assessments WHERE user_id = $1 AND skill_id = $2', [userId, skillId])).rowCount > 0; },
    async listEvidence(userId) { return (await db.query<Row>(`${EVIDENCE_SELECT} WHERE e.user_id = $1 GROUP BY e.id ORDER BY e.created_at DESC, e.id`, [userId])).rows.map(mapEvidence); },
    getEvidence: (userId, id) => fetchEvidence(db, userId, id),
    async createEvidence(userId, i) {
      return db.transaction(async (tx) => {
        const ins = await tx.query<{ id: string }>('INSERT INTO evidence (user_id, title, type, description, url, evidence_date, organization, strength) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id', [userId, i.title, i.type, i.description, i.url, i.date, i.organization, i.strength]);
        const id = ins.rows[0].id;
        if (i.skillIds.length) await tx.query('INSERT INTO evidence_skills (evidence_id, skill_id) SELECT $1::uuid, unnest($2::text[])', [id, i.skillIds]);
        return (await fetchEvidence(tx, userId, id)) as EvidenceRecord;
      });
    },
    async updateEvidence(userId, id, patch) {
      return db.transaction(async (tx) => {
        const params: unknown[] = [id, userId], sets: string[] = [];
        for (const [key, column] of Object.entries(EVIDENCE_PATCH)) {
          const v = (patch as Record<string, unknown>)[key];
          if (v !== undefined) { params.push(v); sets.push(`${column} = $${params.length}`); }
        }
        const upd = await tx.query(`UPDATE evidence SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND user_id = $2 RETURNING id`, params);
        if (upd.rowCount === 0) return null;
        if (patch.skillIds) {
          await tx.query('DELETE FROM evidence_skills WHERE evidence_id = $1', [id]);
          if (patch.skillIds.length) await tx.query('INSERT INTO evidence_skills (evidence_id, skill_id) SELECT $1::uuid, unnest($2::text[])', [id, patch.skillIds]);
        }
        return fetchEvidence(tx, userId, id);
      });
    },
    async deleteEvidence(userId, id) { return (await db.query('DELETE FROM evidence WHERE id = $1 AND user_id = $2', [id, userId])).rowCount > 0; },
    async linkEvidenceSkill(userId, evidenceId, skillId) {
      const r = await db.query('INSERT INTO evidence_skills (evidence_id, skill_id) SELECT e.id, $3 FROM evidence e WHERE e.id = $2 AND e.user_id = $1 ON CONFLICT (evidence_id, skill_id) DO NOTHING', [userId, evidenceId, skillId]);
      return r.rowCount > 0;
    },
    async unlinkEvidenceSkill(userId, evidenceId, skillId) {
      const r = await db.query('DELETE FROM evidence_skills es USING evidence e WHERE es.evidence_id = e.id AND e.id = $2 AND e.user_id = $1 AND es.skill_id = $3', [userId, evidenceId, skillId]);
      return r.rowCount > 0;
    },
  };
}
