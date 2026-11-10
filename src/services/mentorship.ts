import { ApiError, api } from './api';

// Thin typed client for the mentorship and payment endpoints. The server owns every price, currency, owner and payment status:
// nothing here sends or calculates an amount, and money stays a decimal STRING exactly as the server returned it.
export interface Mentor { id: string; displayName: string; headline: string; bio: string; expertise: string[]; /** professional fields (lower-case career categories) this mentor helps with */ fields: string[]; isDemo: boolean }
/** The career the server used to filter mentors or that a booking was made for. */
export interface CareerRef { id: string; name: string }
export interface MentorSession { id: string; mentorId: string; title: string; description: string; durationMinutes: number; price: string; currency: string }
export type BookingStatus = 'pending_payment' | 'confirmed' | 'cancelled';
export interface Booking { id: string; sessionId: string; status: BookingStatus; amount: string; currency: string; createdAt: string; updatedAt: string; session: { title: string; durationMinutes: number }; mentor: { id: string; displayName: string; isDemo: boolean }; career: CareerRef | null }
export interface PaymentSummary { orderId: string; status: 'created' | 'completed' | 'failed'; amount: string; currency: string; captureId: string | null }

export const mentorshipApi = {
  enabled: (): boolean => api.useBackend('mentorship'),
  // With a career id the SERVER filters (and refuses careers this user cannot see). Without one it returns every mentor: only used for an explicit "browse all".
  listMentors: (careerId?: string) => api.get<{ mentors: Mentor[]; career: { id: string; name: string; field: string } | null }>(careerId ? `/mentors?careerId=${encodeURIComponent(careerId)}` : '/mentors'),
  getMentor: (id: string) => api.get<{ mentor: Mentor; sessions: MentorSession[] }>(`/mentors/${encodeURIComponent(id)}`),
  // Only ids are sent. The server checks the session belongs to a mentor for this career and takes the price itself.
  createBooking: (sessionId: string, careerId?: string) => api.post<{ booking: Booking }>('/bookings', careerId ? { sessionId, careerId } : { sessionId }).then((r) => r.booking),
  listBookings: () => api.get<{ bookings: Booking[] }>('/bookings').then((r) => r.bookings),
  createOrder: (bookingId: string) => api.post<{ orderId: string; approvalUrl: string }>('/payments/create-order', { bookingId }),
  capture: (bookingId: string, orderId: string) => api.post<{ booking: Booking; payment: PaymentSummary }>('/payments/capture', { bookingId, orderId }),
};

// Display only. Sample mentors are stored as "Demo Mentor: UX Design"; students see the category ("UX Design"). Real mentors keep their name.
export const mentorTitle = (m: { displayName: string; isDemo: boolean }): string => (m.isDemo ? m.displayName.replace(/^Demo Mentor:\s*/i, '') : m.displayName);

// Display only: the server's amount string with its currency. No arithmetic.
export const formatPrice = (amount: string, currency: string): string => (currency === 'USD' ? `$${amount}` : `${amount} ${currency}`);

// Plain-language messages keyed by the server's error code. The server's own message text is never shown, so nothing unexpected can leak.
export function friendlyPaymentError(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (e.code) {
    case 'network_error': return "Couldn't reach the server. Check your connection, then try again.";
    case 'timeout': return 'The server took too long to answer. Please try again.';
    case 'token_expired': case 'invalid_token': case 'token_missing': return 'Your session has ended. Please sign in again.';
    case 'rate_limited': return "You're doing that too quickly. Wait a moment and try again.";
    case 'payments_not_configured': return 'Payments are not set up on this server yet. Add the PayPal Sandbox keys to server/.env and restart the server.';
    case 'payment_provider_auth': return "PayPal didn't accept the server's Sandbox keys. Check the PayPal Sandbox keys in server/.env, then restart the server.";
    case 'payment_provider_unreachable': return "The server couldn't reach PayPal. Check its internet connection and try again.";
    case 'payment_provider_rejected': return "PayPal didn't accept this payment request. See the server log for the PayPal code.";
    case 'database_not_migrated': return 'The server database needs updating. In the server folder run "npm run db:migrate", then restart the server.';
    case 'not_found': return "The server doesn't have this feature yet. Restart the server so it runs the latest code.";
    case 'career_not_found': return "That career isn't available. Pick your career again in Career Explorer.";
    case 'session_not_for_career': return "This session isn't offered for your selected career. Go back to Mentors and choose one from the list.";
    case 'mentor_not_found': return "That mentor isn't available.";
    case 'session_unavailable': return 'That session is no longer available.';
    case 'conflict': return 'You already have an unpaid booking for this session. You can pay for it under Bookings.';
    case 'booking_not_found': return "That booking isn't available to your account.";
    case 'booking_not_payable': return 'This booking cannot be paid. It may already be paid or cancelled.';
    case 'order_not_found': return "That PayPal order doesn't belong to this booking.";
    case 'payment_not_approved': return "PayPal hasn't received your approval yet.";
    case 'payment_not_completed': return "PayPal hasn't confirmed the payment yet. Please check again shortly.";
    case 'payment_mismatch': return 'The payment did not match this booking, so it was not confirmed. Please contact support.';
    case 'payment_declined': return 'PayPal declined this payment. Try again with another payment method.';
    case 'payment_failed': return 'This payment did not go through. Start a new payment from your bookings.';
    case 'payment_provider_timeout': return 'PayPal took too long to respond. Please try again.';
    case 'payment_provider_error': return 'PayPal could not process the payment right now. Please try again.';
    // Never a bare "Something went wrong": the server's short error code (a fixed identifier, not its message) says which kind of failure it was.
    default: return e.status === 400 ? 'That request could not be sent. Please go back and try again.' : `Something went wrong (error ${e.status} ${e.code}). Please try again.`;
  }
}
