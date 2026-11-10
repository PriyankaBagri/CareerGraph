import { conflict } from '../errors';
import type { Db } from '../db/types';
import type { BookingRecord, BookingStatus, MentorRecord, MentorSessionRecord, MentorshipRepos } from './mentorship-types';

const iso = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString();
interface MentorRow { id: string; display_name: string; headline: string; bio: string; expertise: string[]; fields: string[]; is_demo: boolean }
interface SessionRow { id: string; mentor_id: string; title: string; description: string; duration_minutes: number; price: string; currency: string }
interface BookingRow { id: string; session_id: string; status: BookingStatus; amount: string; currency: string; created_at: Date | string; updated_at: Date | string; title: string; duration_minutes: number; mentor_id: string; display_name: string; is_demo: boolean; career_id: string | null; career_name: string | null }
const mapMentor = (r: MentorRow): MentorRecord => ({ id: r.id, displayName: r.display_name, headline: r.headline, bio: r.bio, expertise: r.expertise, fields: r.fields, isDemo: r.is_demo });
const mapSession = (r: SessionRow): MentorSessionRecord => ({ id: r.id, mentorId: r.mentor_id, title: r.title, description: r.description, durationMinutes: r.duration_minutes, price: r.price, currency: r.currency.trim() });
const mapBooking = (r: BookingRow): BookingRecord => ({ id: r.id, sessionId: r.session_id, status: r.status, amount: r.amount, currency: r.currency.trim(), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), session: { title: r.title, durationMinutes: r.duration_minutes }, mentor: { id: r.mentor_id, displayName: r.display_name, isDemo: r.is_demo } , career: r.career_id && r.career_name ? { id: r.career_id, name: r.career_name } : null });

// `fields` comes from the mentor_fields table (lower-case professional fields); it is never null.
const MENTOR_COLS = "m.id, m.display_name, m.headline, m.bio, m.expertise, m.is_demo, COALESCE((SELECT array_agg(f.field ORDER BY f.field) FROM mentor_fields f WHERE f.mentor_id = m.id), '{}') AS fields";
const SESSION_COLS = 's.id, s.mentor_id, s.title, s.description, s.duration_minutes, s.price::text AS price, s.currency'; // numeric -> text keeps "25.00" exact
const BOOKING_SELECT = `SELECT b.id, b.session_id, b.status, b.amount::text AS amount, b.currency, b.created_at, b.updated_at, s.title, s.duration_minutes, m.id AS mentor_id, m.display_name, m.is_demo, c.id AS career_id, c.name AS career_name
  FROM bookings b JOIN mentor_sessions s ON s.id = b.session_id JOIN mentors m ON m.id = s.mentor_id LEFT JOIN careers c ON c.id = b.career_id`;

// Every query is parameterized. A booking's amount and currency are copied from the session row INSIDE the INSERT, so no price ever comes from the caller.
export function createPgMentorshipRepos(db: Db): MentorshipRepos {
  return {
    async listMentors(field) {
      const where = field ? 'AND EXISTS (SELECT 1 FROM mentor_fields f WHERE f.mentor_id = m.id AND f.field = $1)' : '';
      return (await db.query<MentorRow>(`SELECT ${MENTOR_COLS} FROM mentors m WHERE m.is_active ${where} ORDER BY m.display_name`, field ? [field] : [])).rows.map(mapMentor);
    },
    async getSession(sessionId) {
      const s = await db.query<SessionRow & { mentor_id: string }>(`SELECT ${SESSION_COLS} FROM mentor_sessions s JOIN mentors m ON m.id = s.mentor_id WHERE s.id = $1 AND s.is_active AND m.is_active`, [sessionId]);
      if (!s.rows[0]) return null;
      const m = await db.query<MentorRow>(`SELECT ${MENTOR_COLS} FROM mentors m WHERE m.id = $1`, [s.rows[0].mentor_id]);
      return m.rows[0] ? { session: mapSession(s.rows[0]), mentor: mapMentor(m.rows[0]) } : null;
    },
    async getMentor(id) {
      const m = await db.query<MentorRow>(`SELECT ${MENTOR_COLS} FROM mentors m WHERE m.id = $1 AND m.is_active`, [id]);
      if (!m.rows[0]) return null;
      const s = await db.query<SessionRow>(`SELECT ${SESSION_COLS} FROM mentor_sessions s WHERE s.mentor_id = $1 AND s.is_active ORDER BY s.price, s.title`, [id]);
      return { mentor: mapMentor(m.rows[0]), sessions: s.rows.map(mapSession) };
    },
    async createBooking(userId, sessionId, context) {
      try {
        const ins = await db.query<{ id: string }>(
          // With a career context the mentor must also list that career's field: the database enforces it, not only the service.
          `INSERT INTO bookings (user_id, session_id, amount, currency, career_id)
           SELECT $1, s.id, s.price, s.currency, $3::text FROM mentor_sessions s JOIN mentors m ON m.id = s.mentor_id
           WHERE s.id = $2 AND s.is_active AND m.is_active
             AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM mentor_fields f WHERE f.mentor_id = m.id AND f.field = $4))
           RETURNING id`, [userId, sessionId, context?.careerId ?? null, context?.field ?? null]);
        if (!ins.rows[0]) return null;
        const r = await db.query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1 AND b.user_id = $2`, [ins.rows[0].id, userId]);
        return mapBooking(r.rows[0]);
      } catch (e) {
        if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505') throw conflict('You already have an unpaid booking for this session.');
        throw e;
      }
    },
    async getBooking(userId, bookingId) { const r = await db.query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1 AND b.user_id = $2`, [bookingId, userId]); return r.rows[0] ? mapBooking(r.rows[0]) : null; },
    async listBookings(userId) { return (await db.query<BookingRow>(`${BOOKING_SELECT} WHERE b.user_id = $1 ORDER BY b.created_at DESC, b.id`, [userId])).rows.map(mapBooking); },
  };
}
