import type { Handler } from '../http/types';
import { parseUuid, ValidationError, Validator } from '../validation';

const uid = (req: { userId?: string }) => req.userId as string;

const CAREER_ID = /^[\w:.-]{1,120}$/;
// Optional ?careerId=: when present the answer is limited to mentors for that career's field, and `career` echoes what the server resolved.
export const listMentors: Handler = async (req, ctx) => {
  const careerId = req.query.careerId;
  if (careerId !== undefined && !CAREER_ID.test(careerId)) throw new ValidationError({ careerId: 'Must be a valid career id.' });
  return { status: 200, body: await ctx.services.mentorship.listMentors(uid(req), careerId) };
};
export const getMentor: Handler = async (req, ctx) => {
  const id = parseUuid(req.params.id);
  if (!id) throw new ValidationError({ id: 'Must be a valid id.' });
  return { status: 200, body: await ctx.services.mentorship.getMentor(id) };
};
// Body: { sessionId, careerId? }. Anything else in the body (a price, a user id, a status) is never read.
export const createBooking: Handler = async (req, ctx) => {
  const v = new Validator(req.body);
  const sessionId = v.uuid('sessionId') as string;
  const careerId = v.string('careerId', { optional: true, max: 120, pattern: CAREER_ID, patternMessage: 'Must be a valid career id.' });
  v.done();
  return { status: 201, body: { booking: await ctx.services.mentorship.createBooking(uid(req), sessionId, careerId) } };
};
export const listBookings: Handler = async (req, ctx) => ({ status: 200, body: { bookings: await ctx.services.mentorship.listBookings(uid(req)) } });
