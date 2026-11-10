import type { Handler } from '../http/types';
import { ORDER_ID } from '../payments/paypal';
import { Validator } from '../validation';

const uid = (req: { userId?: string }) => req.userId as string;
const pay = (p: { amount: string; currency: string; status: string; orderId: string; captureId: string | null }) => ({ orderId: p.orderId, status: p.status, amount: p.amount, currency: p.currency, captureId: p.captureId });

// Body: { bookingId }. Anything else in the body (an amount, a currency, a user id, a payment status) is never read.
export const createOrder: Handler = async (req, ctx) => {
  const v = new Validator(req.body);
  const bookingId = v.uuid('bookingId') as string;
  v.done();
  const r = await ctx.services.payments.createOrder(uid(req), bookingId);
  return { status: r.created ? 201 : 200, body: { orderId: r.orderId, approvalUrl: r.approvalUrl } };
};
// Body: { bookingId, orderId }. The result comes from PayPal's own capture response, verified server-side.
export const capture: Handler = async (req, ctx) => {
  const v = new Validator(req.body);
  const bookingId = v.uuid('bookingId') as string, orderId = v.string('orderId', { max: 64, pattern: ORDER_ID, patternMessage: 'Must be a valid PayPal order id.' }) as string;
  v.done();
  const r = await ctx.services.payments.capture(uid(req), bookingId, orderId);
  return { status: 200, body: { booking: r.booking, payment: pay(r.payment) } };
};
