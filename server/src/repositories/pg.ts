import { conflict } from '../errors';
import type { Db } from '../db/types';
import type { ProfilePatch, ProfileRecord, Repos, UserRecord } from './types';

const USER_COLS = 'id, email, name, password_hash, created_at, updated_at';
const PROFILE_COLS = 'user_id, target_career_id, experience_summary, education_summary, about_note, stage, experience_level, onboarding_complete, completeness, created_at, updated_at';
// Column names come from this fixed whitelist, never from request data. Values are always bound parameters.
const PATCH_COLUMNS = { targetCareerId: 'target_career_id', experienceSummary: 'experience_summary', educationSummary: 'education_summary', aboutNote: 'about_note', stage: 'stage', experienceLevel: 'experience_level', onboardingComplete: 'onboarding_complete', completeness: 'completeness' } as const;

interface UserRow { id: string; email: string; name: string; password_hash: string; created_at: Date | string; updated_at: Date | string }
interface ProfileRow { user_id: string; target_career_id: string | null; experience_summary: string | null; education_summary: string | null; about_note: string | null; stage: string; experience_level: string; onboarding_complete: boolean; completeness: number; created_at: Date | string; updated_at: Date | string }
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const mapUser = (r: UserRow): UserRecord => ({ id: r.id, email: r.email, name: r.name, passwordHash: r.password_hash, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) });
const mapProfile = (r: ProfileRow): ProfileRecord => ({ userId: r.user_id, targetCareerId: r.target_career_id, experienceSummary: r.experience_summary, educationSummary: r.education_summary, aboutNote: r.about_note, stage: r.stage, experienceLevel: r.experience_level, onboardingComplete: r.onboarding_complete, completeness: r.completeness, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) });
const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';

export function createPgRepos(db: Db): Repos {
  const repos: Repos = {
    async createUserWithProfile({ email, name, passwordHash }) {
      try {
        return await db.transaction(async (tx) => {
          const u = await tx.query<UserRow>(`INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING ${USER_COLS}`, [email, name, passwordHash]);
          const p = await tx.query<ProfileRow>(`INSERT INTO profiles (user_id) VALUES ($1) RETURNING ${PROFILE_COLS}`, [u.rows[0].id]);
          return { user: mapUser(u.rows[0]), profile: mapProfile(p.rows[0]) };
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict('An account with this email already exists.');
        throw e;
      }
    },
    async findUserByEmail(email) { const r = await db.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE email = $1`, [email]); return r.rows[0] ? mapUser(r.rows[0]) : null; },
    async findUserById(id) { const r = await db.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]); return r.rows[0] ? mapUser(r.rows[0]) : null; },
    async getProfile(userId) { const r = await db.query<ProfileRow>(`SELECT ${PROFILE_COLS} FROM profiles WHERE user_id = $1`, [userId]); return r.rows[0] ? mapProfile(r.rows[0]) : null; },
    async updateProfile(userId, patch: ProfilePatch) {
      return db.transaction(async (tx) => {
        if (patch.name !== undefined) await tx.query('UPDATE users SET name = $2, updated_at = now() WHERE id = $1', [userId, patch.name]);
        const params: unknown[] = [userId], sets: string[] = [];
        for (const [key, column] of Object.entries(PATCH_COLUMNS) as [keyof typeof PATCH_COLUMNS, string][]) {
          if (patch[key] !== undefined) { params.push(patch[key]); sets.push(`${column} = $${params.length}`); }
        }
        const p = await tx.query<ProfileRow>(`UPDATE profiles SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE user_id = $1 RETURNING ${PROFILE_COLS}`, params);
        const u = await tx.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [userId]);
        return p.rows[0] && u.rows[0] ? { user: mapUser(u.rows[0]), profile: mapProfile(p.rows[0]) } : null;
      });
    },
    async seededCareerExists(careerId) { const r = await db.query(`SELECT 1 FROM careers WHERE id = $1 AND source = 'seed'`, [careerId]); return r.rowCount > 0; },
  };
  return repos;
}
