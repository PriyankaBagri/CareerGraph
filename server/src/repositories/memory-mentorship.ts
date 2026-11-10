import { randomUUID } from 'node:crypto';
import { conflict } from '../errors';
import { DEMO_MENTORS } from '../domain/demoMentors';
import type { BookingRecord, MentorRecord, MentorSessionRecord, MentorshipRepos } from './mentorship-types';

type StoredMentor = MentorRecord & { isActive: boolean };
type StoredSession = MentorSessionRecord & { isActive: boolean };
type StoredBooking = BookingRecord & { userId: string };

// In-memory MentorshipRepos for tests. Starts with the demo mentors and mirrors the PostgreSQL behaviour: price copied from the session,
// inactive mentors/sessions are unbookable, one pending booking per user and session, every read scoped by user.
export function createMemoryMentorshipRepos(now: () => Date = () => new Date()): MentorshipRepos & { mentors: Map<string, StoredMentor>; sessions: Map<string, StoredSession>; bookings: Map<string, StoredBooking> } {
  const mentors = new Map<string, StoredMentor>(), sessions = new Map<string, StoredSession>(), bookings = new Map<string, StoredBooking>();
  for (const m of DEMO_MENTORS) {
    mentors.set(m.id, { id: m.id, displayName: m.displayName, headline: m.headline, bio: m.bio, expertise: [...m.expertise], fields: [...m.fields], isDemo: true, isActive: true });
    for (const s of m.sessions) sessions.set(s.id, { ...s, mentorId: m.id, isActive: true });
  }
  const pub = ({ isActive: _a, ...m }: StoredMentor): MentorRecord => ({ ...m, expertise: [...m.expertise], fields: [...m.fields] });
  const pubSession = ({ isActive: _a, ...s }: StoredSession): MentorSessionRecord => ({ ...s });
  const out = ({ userId: _u, ...b }: StoredBooking): BookingRecord => structuredClone(b);
  return {
    mentors, sessions, bookings,
    async listMentors(field) { return [...mentors.values()].filter((m) => m.isActive && (!field || m.fields.includes(field))).sort((a, b) => a.displayName.localeCompare(b.displayName)).map(pub); },
    async getMentor(id) {
      const m = mentors.get(id); if (!m || !m.isActive) return null;
      return { mentor: pub(m), sessions: [...sessions.values()].filter((s) => s.mentorId === id && s.isActive).sort((a, b) => a.price.localeCompare(b.price, undefined, { numeric: true })).map(pubSession) };
    },
    async getSession(sessionId) { const s = sessions.get(sessionId), m = s && mentors.get(s.mentorId); return s && s.isActive && m && m.isActive ? { session: pubSession(s), mentor: pub(m) } : null; },
    async createBooking(userId, sessionId, context) {
      const s = sessions.get(sessionId), m = s && mentors.get(s.mentorId);
      if (!s || !s.isActive || !m || !m.isActive) return null;
      if (context && !m.fields.includes(context.field)) return null;
      if ([...bookings.values()].some((b) => b.userId === userId && b.sessionId === sessionId && b.status === 'pending_payment')) throw conflict('You already have an unpaid booking for this session.');
      const t = now().toISOString();
      const b: StoredBooking = { id: randomUUID(), userId, sessionId, status: 'pending_payment', amount: s.price, currency: s.currency, createdAt: t, updatedAt: t, session: { title: s.title, durationMinutes: s.durationMinutes }, mentor: { id: m.id, displayName: m.displayName, isDemo: m.isDemo }, career: context ? { id: context.careerId, name: context.careerName } : null };
      bookings.set(b.id, b);
      return out(b);
    },
    async getBooking(userId, bookingId) { const b = bookings.get(bookingId); return b && b.userId === userId ? out(b) : null; },
    async listBookings(userId) { return [...bookings.values()].filter((b) => b.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(out); },
  };
}
