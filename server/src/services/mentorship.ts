import { AppError, notFound } from '../errors';
import type { BookingRecord, MentorRecord, MentorSessionRecord, MentorshipRepos } from '../repositories/mentorship-types';

// A career's field is its existing category ("Technology", "Law", ...). Mentors list the fields they help with, stored lower-case.
export const normalizeField = (category: string): string => category.trim().toLowerCase();
export interface CareerContext { id: string; name: string; field: string }
type CareerLookup = { listCareers(userId: string): Promise<{ id: string; name: string; category: string }[]> };

// Prices come ONLY from the database (the repository copies them from the session row). The browser chooses a session, never an amount.
// The career comes from the database too: the browser sends a career id, the server looks up that career's field for THIS user.
export class MentorshipService {
  constructor(private readonly repos: MentorshipRepos & CareerLookup) {}

  private async career(userId: string, careerId: string): Promise<CareerContext> {
    const c = (await this.repos.listCareers(userId)).find((x) => x.id === careerId);
    if (!c) throw notFound('Career not found.', 'career_not_found');
    return { id: c.id, name: c.name, field: normalizeField(c.category) };
  }

  /** With a career: only mentors for that career's field (possibly none: the caller shows an honest empty state). Without: every mentor. */
  async listMentors(userId: string, careerId?: string): Promise<{ mentors: MentorRecord[]; career: CareerContext | null }> {
    const career = careerId ? await this.career(userId, careerId) : null;
    return { mentors: await this.repos.listMentors(career?.field), career };
  }
  async getMentor(id: string): Promise<{ mentor: MentorRecord; sessions: MentorSessionRecord[] }> {
    const m = await this.repos.getMentor(id);
    if (!m) throw notFound('Mentor not found.', 'mentor_not_found');
    return m;
  }
  async createBooking(userId: string, sessionId: string, careerId?: string): Promise<BookingRecord> {
    const career = careerId ? await this.career(userId, careerId) : null;
    const found = await this.repos.getSession(sessionId);
    if (!found) throw notFound('This session is not available.', 'session_unavailable');
    if (career && !found.mentor.fields.includes(career.field)) throw new AppError(409, 'session_not_for_career', `This session is not offered for ${career.name}.`, undefined, true);
    const b = await this.repos.createBooking(userId, sessionId, career && { careerId: career.id, careerName: career.name, field: career.field });
    if (!b) throw notFound('This session is not available.', 'session_unavailable');
    return b;
  }
  listBookings(userId: string): Promise<BookingRecord[]> { return this.repos.listBookings(userId); }
}
