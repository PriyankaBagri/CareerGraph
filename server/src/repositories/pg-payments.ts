import { conflict } from '../errors';
import type { Db } from '../db/types';
import type { PaymentRecord, PaymentRepos, PaymentStatus } from './payment-types';

const iso = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString();
interface Row { id: string; booking_id: string; paypal_order_id: string; paypal_capture_id: string | null; amount: string; currency: string; status: PaymentStatus; created_at: Date | string; updated_at: Date | string }
const COLS = 'id, booking_id, paypal_order_id, paypal_capture_id, amount::text AS amount, currency, status, created_at, updated_at'; // numeric -> text keeps "25.00" exact
const map = (r: Row): PaymentRecord => ({ id: r.id, bookingId: r.booking_id, orderId: r.paypal_order_id, captureId: r.paypal_capture_id, amount: r.amount, currency: r.currency.trim(), status: r.status, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) });

// Every query is parameterized and scoped by the authenticated user id. The amount/currency snapshot is copied from the booking row inside the INSERT.
export function createPgPaymentRepos(db: Db): PaymentRepos {
  return {
    async listPayments(userId, bookingId) { return (await db.query<Row>(`SELECT ${COLS} FROM payments WHERE user_id = $1 AND booking_id = $2 ORDER BY created_at DESC, id`, [userId, bookingId])).rows.map(map); },
    async createPayment(userId, bookingId, orderId) {
      try {
        const r = await db.query<Row>(
          `INSERT INTO payments (booking_id, user_id, paypal_order_id, amount, currency)
           SELECT b.id, b.user_id, $3, b.amount, b.currency FROM bookings b WHERE b.id = $2 AND b.user_id = $1 AND b.status = 'pending_payment'
           RETURNING ${COLS}`, [userId, bookingId, orderId]);
        return r.rows[0] ? map(r.rows[0]) : null;
      } catch (e) {
        if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505') throw conflict('This booking already has a payment in progress.');
        throw e;
      }
    },
    async completePayment(userId, bookingId, orderId, captureId) {
      return db.transaction(async (tx) => {
        const p = await tx.query<Row>(
          `UPDATE payments SET status = 'completed', paypal_capture_id = $4, updated_at = now()
           WHERE booking_id = $2 AND user_id = $1 AND paypal_order_id = $3 AND status = 'created' RETURNING ${COLS}`, [userId, bookingId, orderId, captureId]);
        if (!p.rows[0]) return null;
        const b = await tx.query(`UPDATE bookings SET status = 'confirmed', updated_at = now() WHERE id = $2 AND user_id = $1 AND status = 'pending_payment'`, [userId, bookingId]);
        if (b.rowCount === 0) throw new Error('Booking is not payable.'); // rolls the payment update back too
        return map(p.rows[0]);
      });
    },
    async failPayment(userId, bookingId, orderId, captureId) {
      await db.query(`UPDATE payments SET status = 'failed', paypal_capture_id = $4, updated_at = now() WHERE booking_id = $2 AND user_id = $1 AND paypal_order_id = $3 AND status = 'created'`, [userId, bookingId, orderId, captureId]);
    },
  };
}
