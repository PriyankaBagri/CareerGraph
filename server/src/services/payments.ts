import { AppError, notFound, paymentError, paymentsNotConfigured } from '../errors';
import type { Logger } from '../logger';
import { approvalUrl, PayPalError, sameMoney, type PayPalApi, type PayPalOrderResult } from '../payments/paypal';
import type { BookingRecord, MentorshipRepos } from '../repositories/mentorship-types';
import type { PaymentRecord, PaymentRepos } from '../repositories/payment-types';

export interface CaptureResult { booking: BookingRecord; payment: PaymentRecord }

// The browser only ever says WHICH booking (and which order). The amount, currency and owner come from the database, and a booking becomes
// 'confirmed' only after PayPal itself reports a COMPLETED capture for exactly that booking, amount and currency.
export class PaymentService {
  /** `returnBase` is the app's own browser origin (the first CLIENT_ORIGIN): the only place PayPal is told to send the buyer back to. */
  constructor(private readonly deps: { paypal: PayPalApi | null; repos: MentorshipRepos & PaymentRepos; logger: Logger; returnBase: string }) {}

  private paypal(): PayPalApi { if (!this.deps.paypal) throw paymentsNotConfigured(); return this.deps.paypal; }
  private async booking(userId: string, bookingId: string): Promise<BookingRecord> {
    const b = await this.deps.repos.getBooking(userId, bookingId); // scoped by user: someone else's booking looks exactly like a missing one
    if (!b) throw notFound('Booking not found.', 'booking_not_found');
    return b;
  }
  // Only a category, HTTP status and PayPal's short issue code are logged; never the response body, token or credentials.
  private providerError(e: unknown, op: string): unknown {
    if (!(e instanceof PayPalError)) return e;
    this.deps.logger.warn('paypal_error', { op, stage: e.stage, category: e.category, upstreamStatus: e.upstreamStatus, issue: e.issue });
    if (e.category === 'timeout') return paymentError(504, 'payment_provider_timeout', 'PayPal took too long to respond. Please try again.');
    // The Sandbox keys were refused, PayPal cannot be reached, or the order was rejected: each has its own fixed message so the cause is visible.
    if (e.stage === 'token' && e.category === 'rejected') return paymentError(502, 'payment_provider_auth', "PayPal did not accept this server's Sandbox keys. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET, then restart the server.");
    if (e.category === 'network') return paymentError(502, 'payment_provider_unreachable', 'This server could not reach PayPal. Check its internet connection and try again.');
    if (e.stage === 'api' && e.category === 'rejected' && (e.upstreamStatus ?? 0) < 500 && e.issue && e.issue !== 'INSTRUMENT_DECLINED') return paymentError(502, 'payment_provider_rejected', `PayPal did not accept this payment request (${e.issue}).`);
    if (e.issue === 'INSTRUMENT_DECLINED') return paymentError(402, 'payment_declined', 'PayPal declined this payment. Choose another payment method and try again.');
    return paymentError(502, 'payment_provider_error', 'PayPal could not process the payment right now. Please try again.');
  }
  private result(booking: BookingRecord, payment: PaymentRecord): CaptureResult { return { booking, payment }; }

  async createOrder(userId: string, bookingId: string): Promise<{ orderId: string; approvalUrl: string; created: boolean }> {
    const api = this.paypal(), repos = this.deps.repos;
    const booking = await this.booking(userId, bookingId);
    if (booking.status !== 'pending_payment') throw paymentError(409, 'booking_not_payable', booking.status === 'confirmed' ? 'This booking is already paid.' : 'This booking can no longer be paid.');
    const payments = await repos.listPayments(userId, bookingId);
    const live = payments.find((p) => p.status === 'created');
    if (live) return { orderId: live.orderId, approvalUrl: approvalUrl(live.orderId), created: false }; // one live PayPal order per booking: reuse it
    let orderId: string;
    const back = `${this.deps.returnBase.replace(/\/+$/, '')}/bookings/payment`, q = `?bookingId=${bookingId}`;
    // Amount and currency are the booking's stored snapshot. The request id is stable per booking and attempt, so a retry or a double click gets the same PayPal order.
    try { orderId = (await api.createOrder({ bookingId, amount: booking.amount, currency: booking.currency, requestId: `cg-booking-${bookingId}-${payments.length}`, returnUrl: `${back}/return${q}`, cancelUrl: `${back}/cancel${q}` })).orderId; }
    catch (e) { throw this.providerError(e, 'create_order'); }
    let payment: PaymentRecord | null;
    try { payment = await repos.createPayment(userId, bookingId, orderId); }
    catch (e) { // a concurrent request stored the order first: return that one
      const won = e instanceof AppError && e.status === 409 ? (await repos.listPayments(userId, bookingId)).find((p) => p.status === 'created') : undefined;
      if (!won) throw e;
      return { orderId: won.orderId, approvalUrl: approvalUrl(won.orderId), created: false };
    }
    if (!payment) throw paymentError(409, 'booking_not_payable', 'This booking can no longer be paid.');
    this.deps.logger.info('payment_order_created', { bookingId, orderId });
    return { orderId, approvalUrl: approvalUrl(orderId), created: true };
  }

  async capture(userId: string, bookingId: string, orderId: string): Promise<CaptureResult> {
    const api = this.paypal(), repos = this.deps.repos;
    const booking = await this.booking(userId, bookingId);
    const payment = (await repos.listPayments(userId, bookingId)).find((p) => p.orderId === orderId); // the order must be the one stored for THIS booking
    if (!payment) throw notFound('Order not found for this booking.', 'order_not_found');
    if (payment.status === 'completed') return this.result(booking, payment); // repeated request: already confirmed, PayPal is not called again
    if (payment.status === 'failed') throw paymentError(409, 'payment_failed', 'This payment did not go through. Start a new payment.');
    if (booking.status !== 'pending_payment') throw paymentError(409, 'booking_not_payable', 'This booking can no longer be paid.');

    let order: PayPalOrderResult;
    try { order = await api.captureOrder(orderId, `cg-capture-${orderId}`); }
    catch (e) {
      if (e instanceof PayPalError && e.category === 'rejected' && e.issue === 'ORDER_NOT_APPROVED') throw paymentError(409, 'payment_not_approved', 'The payment has not been approved in PayPal yet.');
      if (!(e instanceof PayPalError && e.category === 'rejected' && e.issue === 'ORDER_ALREADY_CAPTURED')) throw this.providerError(e, 'capture');
      try { order = await api.getOrder(orderId); } catch (e2) { throw this.providerError(e2, 'get_order'); } // captured earlier (e.g. we crashed before saving): read PayPal's record
    }

    const cap = order.capture;
    if (cap && (cap.status === 'DECLINED' || cap.status === 'FAILED')) {
      await repos.failPayment(userId, bookingId, orderId, cap.id);
      throw paymentError(402, 'payment_declined', 'PayPal declined this payment. Start a new payment and choose another method.');
    }
    if (!cap || order.status !== 'COMPLETED' || cap.status !== 'COMPLETED') throw paymentError(409, 'payment_not_completed', 'PayPal has not confirmed this payment yet. Please check again shortly.');
    // PayPal says "completed": still verify it is for THIS order, booking, amount and currency before trusting it.
    if (order.orderId !== orderId || order.referenceId !== bookingId || cap.currency !== booking.currency || !sameMoney(cap.value, booking.amount) || !sameMoney(cap.value, payment.amount)) {
      this.deps.logger.error('payment_mismatch', { bookingId, orderId, captureId: cap.id }); // needs manual review; the booking is NOT confirmed
      throw paymentError(409, 'payment_mismatch', 'The payment did not match this booking, so it was not confirmed. Please contact support.');
    }
    const done = await repos.completePayment(userId, bookingId, orderId, cap.id);
    if (!done) { // a concurrent request confirmed it first
      const again = (await repos.listPayments(userId, bookingId)).find((p) => p.orderId === orderId);
      if (again?.status === 'completed') return this.result(await this.booking(userId, bookingId), again);
      throw paymentError(409, 'booking_not_payable', 'This booking can no longer be paid.');
    }
    this.deps.logger.info('payment_completed', { bookingId, orderId, captureId: cap.id });
    return this.result(await this.booking(userId, bookingId), done);
  }
}
