export const BOOKING_STATUSES = ['pending_payment', 'confirmed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// Money is a decimal STRING such as "25.00" (never a float), so it round-trips PostgreSQL numeric exactly.
export interface MentorRecord { id: string; displayName: string; headline: string; bio: string; expertise: string[]; /** Lower-case professional fields (a career's `category`) this mentor helps with. */ fields: string[]; isDemo: boolean }
export interface MentorSessionRecord { id: string; mentorId: string; title: string; description: string; durationMinutes: number; price: string; currency: string }
export interface BookingRecord {
  id: string; sessionId: string; status: BookingStatus; amount: string; currency: string; createdAt: string; updatedAt: string;
  session: { title: string; durationMinutes: number }; mentor: { id: string; displayName: string; isDemo: boolean };
  /** The career this booking was made for (null when booked from "all mentors"). */
  career: { id: string; name: string } | null;
}

export interface MentorshipRepos {
  /** Active mentors only. With `field`, only mentors who list that (lower-case) field. */
  listMentors(field?: string): Promise<MentorRecord[]>;
  /** An active session with its active mentor, or null. */
  getSession(sessionId: string): Promise<{ session: MentorSessionRecord; mentor: MentorRecord } | null>;
  /** An active mentor with their active sessions, or null. */
  getMentor(id: string): Promise<{ mentor: MentorRecord; sessions: MentorSessionRecord[] } | null>;
  /** Creates a pending_payment booking. The amount and currency are read from the session row by the repository, never passed in.
   *  Returns null if the session (or its mentor) does not exist or is inactive, or (with a career context) the mentor does not list the career's field. Throws a 409 conflict if the user already has a pending booking for it. */
  createBooking(userId: string, sessionId: string, context?: { careerId: string; careerName: string; field: string } | null): Promise<BookingRecord | null>;
  /** One booking, only if it belongs to this user (otherwise null, so another user's id is indistinguishable from a missing one). */
  getBooking(userId: string, bookingId: string): Promise<BookingRecord | null>;
  /** Only this user's bookings, newest first. */
  listBookings(userId: string): Promise<BookingRecord[]>;
}
