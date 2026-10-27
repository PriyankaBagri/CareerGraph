import type { CareerDataset } from '../domain/shared';
import type { Db } from './types';

// The frontend data model has no per-skill importance yet, so every seeded requirement uses the neutral middle value.
export const DEFAULT_IMPORTANCE = 3;
export interface Statement { text: string; params: unknown[] }

// Idempotent upserts of the shared, seeded career catalogue. User-owned data (evidence, assessments, ...) is never touched,
// and seeded careers carry no example evidence. Safe to run repeatedly.
export function buildSeedStatements(datasets: CareerDataset[]): Statement[] {
  const careers: Statement[] = [], caps: Statement[] = [], skills: Statement[] = [], reqs: Statement[] = [];
  for (const { career } of datasets) {
    careers.push({ text: `INSERT INTO careers (id, name, category, description, source, evidence_expectations) VALUES ($1, $2, $3, $4, 'seed', $5)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, description = EXCLUDED.description, evidence_expectations = EXCLUDED.evidence_expectations, updated_at = now()`,
      params: [career.id, career.name, career.category, career.description, career.evidenceExpectations ?? []] });
    career.capabilities.forEach((cap, ci) => {
      caps.push({ text: `INSERT INTO career_capabilities (id, career_id, name, description, position) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET career_id = EXCLUDED.career_id, name = EXCLUDED.name, description = EXCLUDED.description, position = EXCLUDED.position, updated_at = now()`,
        params: [cap.id, career.id, cap.name, cap.description ?? '', ci] });
      cap.skills.forEach((s, si) => {
        skills.push({ text: 'INSERT INTO skills (id, name, category) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, updated_at = now()', params: [s.id, s.name, cap.name] });
        reqs.push({ text: `INSERT INTO career_skills (career_id, skill_id, capability_id, required_level, position, importance) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (career_id, skill_id) DO UPDATE SET capability_id = EXCLUDED.capability_id, required_level = EXCLUDED.required_level, position = EXCLUDED.position, importance = EXCLUDED.importance`,
          params: [career.id, s.id, cap.id, s.requiredLevel, ci * 100 + si, DEFAULT_IMPORTANCE] });
      });
    });
  }
  return [...careers, ...caps, ...skills, ...reqs]; // parents before children, so foreign keys always hold
}

export async function runSeed(db: Db, datasets: CareerDataset[]): Promise<{ careers: number; statements: number }> {
  const statements = buildSeedStatements(datasets);
  await db.transaction(async (tx) => { for (const s of statements) await tx.query(s.text, s.params); });
  return { careers: datasets.length, statements: statements.length };
}
