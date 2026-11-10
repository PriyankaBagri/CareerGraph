import { randomUUID } from 'node:crypto';
import { conflict } from '../errors';
import type { BookingRecord } from './mentorship-types';
import type { PaymentRecord, PaymentRepos } from './payment-types';

type StoredPayment = PaymentRecord & { userId: string };

// In-memory PaymentRepos for tests. Shares the bookings map with the mentorship repos and mirrors the PostgreSQL rules: price copied from the booking,
// one live order per booking, unique order ids, and payment + booking change together.
export function createMemoryPaymentRepos(bookings: Map<string, BookingRecord & { userId: string }>, now: () => Date = () => new Date()): PaymentRepos & { payments: Map<string, StoredPayment> } {
  const payments = new Map<string, StoredPayment>();
  const out = ({ userId: _u, ...p }: StoredPayment): PaymentRecord => ({ ...p });
  const find = (userId: string, bookingId: string, orderId: string) => [...payments.values()].find((p) => p.userId === userId && p.bookingId === bookingId && p.orderId === orderId);
  return {
    payments,
    async listPayments(userId, bookingId) { return [...payments.values()].filter((p) => p.userId === userId && p.bookingId === bookingId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(out); },
    async createPayment(userId, bookingId, orderId) {
      const b = bookings.get(bookingId);
      if (!b || b.userId !== userId || b.status !== 'pending_payment') return null;
      const all = [...payments.values()];
      if (all.some((p) => p.orderId === orderId) || all.some((p) => p.bookingId === bookingId && (p.status === 'created' || p.status === 'completed'))) throw conflict('This booking already has a payment in progress.');
      const t = now().toISOString();
      const p: StoredPayment = { id: randomUUID(), userId, bookingId, orderId, captureId: null, amount: b.amount, currency: b.currency, status: 'created', createdAt: t, updatedAt: t };
      payments.set(p.id, p);
      return out(p);
    },
    async completePayment(userId, bookingId, orderId, captureId) {
      const p = find(userId, bookingId, orderId), b = bookings.get(bookingId);
      if (!p || p.status !== 'created') return null;
      if (!b || b.userId !== userId || b.status !== 'pending_payment') throw new Error('Booking is not payable.'); // the real transaction rolls back here
      const t = now().toISOString();
      p.status = 'completed'; p.captureId = captureId; p.updatedAt = t; b.status = 'confirmed'; b.updatedAt = t;
      return out(p);
    },
    async failPayment(userId, bookingId, orderId, captureId) {
      const p = find(userId, bookingId, orderId);
      if (p && p.status === 'created') { p.status = 'failed'; p.captureId = captureId; p.updatedAt = now().toISOString(); }
    },
  };
}
