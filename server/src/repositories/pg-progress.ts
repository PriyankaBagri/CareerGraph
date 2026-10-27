import type { Db } from '../db/types';
import type { ActionSnapshot, ProgressRecord, ProgressRepos, SettingsRecord, StoredStatus } from './progress-types';

const iso = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString();
interface Row {
  action_key: string; career_id: string; status: StoredStatus; updated_at: Date | string; completed_at: Date | string | null;
  title: string; description: string; type: string; phase: string; priority: string; priority_score: number; impact: string; effort: string;
  estimated_time: string; reason: string; prerequisites: string[]; related_skill_ids: string[]; related_capability_ids: string[]; created_at: Date | string;
}
const mapRow = (r: Row): ProgressRecord => ({
  actionKey: r.action_key, careerId: r.career_id, status: r.status, updatedAt: iso(r.updated_at), completedAt: r.completed_at ? iso(r.completed_at) : null,
  snapshot: { title: r.title, description: r.description, type: r.type, phase: r.phase, priority: r.priority, priorityScore: r.priority_score, impact: r.impact, effort: r.effort,
    estimatedTime: r.estimated_time, reason: r.reason, prerequisites: r.prerequisites, relatedSkillIds: r.related_skill_ids, relatedCapabilityIds: r.related_capability_ids, createdAt: iso(r.created_at) },
});
const SELECT = `SELECT a.action_key, a.career_id, r.status, r.updated_at, r.completed_at, a.title, a.description, a.type, a.phase, a.priority, a.priority_score, a.impact, a.effort,
  a.estimated_time, a.reason, a.prerequisites, a.related_skill_ids, a.related_capability_ids, a.created_at
  FROM actions a JOIN roadmap_items r ON r.action_id = a.id`;

// Uses ONLY the existing Stage 1 tables (actions, roadmap_items, user_settings); no schema change. Every query is scoped by the authenticated user id.
export function createPgProgressRepos(db: Db): ProgressRepos {
  const settingsRow = (r: { reduce_motion: boolean; assistant_suggestions: boolean; updated_at: Date | string } | undefined): SettingsRecord =>
    r ? { reduceMotion: r.reduce_motion, assistantSuggestions: r.assistant_suggestions, updatedAt: iso(r.updated_at) } : { reduceMotion: false, assistantSuggestions: true, updatedAt: null };
  return {
    async listProgress(userId, careerId) {
      const r = await db.query<Row>(`${SELECT} WHERE a.user_id = $1 AND a.career_id = $2 ORDER BY a.priority_score DESC, a.action_key`, [userId, careerId]);
      return r.rows.map(mapRow);
    },
    async setProgress(userId, careerId, actionKey, status, s: ActionSnapshot) {
      return db.transaction(async (tx) => {
        const a = await tx.query<{ id: string }>(
          `INSERT INTO actions (user_id, career_id, action_key, title, description, type, phase, priority, priority_score, impact, effort, estimated_time, reason, prerequisites, related_skill_ids, related_capability_ids)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (user_id, career_id, action_key) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, type = EXCLUDED.type, phase = EXCLUDED.phase,
             priority = EXCLUDED.priority, priority_score = EXCLUDED.priority_score, impact = EXCLUDED.impact, effort = EXCLUDED.effort, estimated_time = EXCLUDED.estimated_time,
             reason = EXCLUDED.reason, prerequisites = EXCLUDED.prerequisites, related_skill_ids = EXCLUDED.related_skill_ids, related_capability_ids = EXCLUDED.related_capability_ids
           RETURNING id`,
          [userId, careerId, actionKey, s.title, s.description, s.type, s.phase, s.priority, s.priorityScore, s.impact, s.effort, s.estimatedTime, s.reason, s.prerequisites, s.relatedSkillIds, s.relatedCapabilityIds]);
        await tx.query(
          `INSERT INTO roadmap_items (action_id, user_id, career_id, phase, status, completed_at) VALUES ($1,$2,$3,$4,$5, CASE WHEN $5 = 'completed' THEN now() ELSE NULL END)
           ON CONFLICT (action_id) DO UPDATE SET status = EXCLUDED.status, phase = EXCLUDED.phase, updated_at = now(),
             completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN COALESCE(roadmap_items.completed_at, now()) ELSE NULL END`,
          [a.rows[0].id, userId, careerId, s.phase, status]);
        const out = await tx.query<Row>(`${SELECT} WHERE a.id = $1 AND a.user_id = $2`, [a.rows[0].id, userId]);
        return mapRow(out.rows[0]);
      });
    },
    async clearProgress(userId, careerId, actionKey) {
      const r = await db.query(`DELETE FROM actions WHERE user_id = $1 AND career_id = $2 AND action_key = $3`, [userId, careerId, actionKey]);
      return r.rowCount > 0;
    },
    async getSettings(userId) {
      const r = await db.query<{ reduce_motion: boolean; assistant_suggestions: boolean; updated_at: Date | string }>(`SELECT reduce_motion, assistant_suggestions, updated_at FROM user_settings WHERE user_id = $1`, [userId]);
      return settingsRow(r.rows[0]);
    },
    async updateSettings(userId, patch) {
      const r = await db.query<{ reduce_motion: boolean; assistant_suggestions: boolean; updated_at: Date | string }>(
        `INSERT INTO user_settings (user_id, reduce_motion, assistant_suggestions) VALUES ($1, COALESCE($2::boolean, false), COALESCE($3::boolean, true))
         ON CONFLICT (user_id) DO UPDATE SET reduce_motion = COALESCE($2::boolean, user_settings.reduce_motion), assistant_suggestions = COALESCE($3::boolean, user_settings.assistant_suggestions), updated_at = now()
         RETURNING reduce_motion, assistant_suggestions, updated_at`,
        [userId, patch.reduceMotion ?? null, patch.assistantSuggestions ?? null]);
      return settingsRow(r.rows[0]);
    },
  };
}
