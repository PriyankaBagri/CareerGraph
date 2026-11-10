import { ApiError } from './api';
import { friendlyPaymentError, mentorshipApi, type Booking, type PaymentSummary } from './mentorship';
import { forgetCheckout, isPayPalApprovalUrl, rememberCheckout, resolveCheckout, type ReturnParams } from '../utils/checkout';

// Asks the server for a PayPal order and returns the approval link to send the buyer to. The amount is never sent: the server reads it from the booking.
export async function startCheckout(bookingId: string): Promise<string> {
  const { orderId, approvalUrl } = await mentorshipApi.createOrder(bookingId);
  if (!isPayPalApprovalUrl(approvalUrl)) throw new ApiError(502, 'payment_provider_error', 'Unexpected payment link.');
  rememberCheckout(bookingId, orderId);
  return approvalUrl;
}

// 'confirmed' is the ONLY success. It requires the server to report a completed payment AND a confirmed booking; the PayPal redirect alone proves nothing.
export type CheckoutOutcome =
  | { kind: 'confirmed'; booking: Booking; payment: PaymentSummary }
  | { kind: 'waiting'; message: string } // approval or PayPal's confirmation has not arrived yet: nothing is wrong, check again
  | { kind: 'sign_in' }
  | { kind: 'unmatched' } // cannot tell which booking this return belongs to
  | { kind: 'failed'; message: string; canRetry: boolean };

const RETRYABLE = new Set(['network_error', 'timeout', 'payment_provider_error', 'payment_provider_timeout', 'payment_provider_unreachable']);
const SIGN_IN = new Set(['token_expired', 'invalid_token', 'token_missing']);

// Called when the buyer comes back from PayPal (and again on refresh or a repeated visit: the server treats repeats idempotently).
export async function completeCheckout(params: ReturnParams): Promise<CheckoutOutcome> {
  const r = resolveCheckout(params);
  if (!r.ok) return { kind: 'unmatched' };
  try {
    const { booking, payment } = await mentorshipApi.capture(r.bookingId, r.orderId);
    if (booking.status !== 'confirmed' || payment.status !== 'completed') return { kind: 'failed', message: "We couldn't confirm this payment. Please check your bookings.", canRetry: false };
    forgetCheckout(r.orderId);
    return { kind: 'confirmed', booking, payment };
  } catch (e) {
    if (e instanceof ApiError) {
      if (SIGN_IN.has(e.code)) return { kind: 'sign_in' };
      if (e.code === 'payment_not_approved' || e.code === 'payment_not_completed') return { kind: 'waiting', message: friendlyPaymentError(e) };
      return { kind: 'failed', message: friendlyPaymentError(e), canRetry: RETRYABLE.has(e.code) };
    }
    return { kind: 'failed', message: friendlyPaymentError(e), canRetry: true };
  }
}

// The buyer cancelled at PayPal: nothing is sent to the server and nothing is marked paid. The booking stays waiting for payment.
export function cancelCheckout(params: ReturnParams): void { if (params.orderId) forgetCheckout(params.orderId); }
