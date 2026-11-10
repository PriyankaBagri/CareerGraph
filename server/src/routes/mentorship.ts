import * as c from '../controllers/mentorship';
import type { Route } from '../http/types';

export const mentorshipRoutes: Route[] = [
  { method: 'GET', path: '/api/mentors', auth: true, handler: c.listMentors },
  { method: 'GET', path: '/api/mentors/:id', auth: true, handler: c.getMentor },
  { method: 'POST', path: '/api/bookings', auth: true, handler: c.createBooking },
  { method: 'GET', path: '/api/bookings', auth: true, handler: c.listBookings },
];
