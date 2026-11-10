export const PAYMENT_STATUSES = ['created', 'completed', 'failed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// amount is a decimal string such as "25.00" (a snapshot of the booking price), never a float.
export interface PaymentRecord { id: string; bookingId: string; orderId: string; captureId: string | null; amount: string; currency: string; status: PaymentStatus; createdAt: string; updatedAt: string }

// Every method takes the authenticated userId and scopes by it, so one user can never read or change another user's payment.
export interface PaymentRepos {
  /** This user's payments for one booking, newest first. */
  listPayments(userId: string, bookingId: string): Promise<PaymentRecord[]>;
  /** Records a new PayPal order for a pending_payment booking. Amount and currency are copied from the booking row by the repository, never passed in.
   *  Returns null if the booking is missing, not this user's, or not pending_payment. Throws a 409 conflict if the booking already has a live order. */
  createPayment(userId: string, bookingId: string, orderId: string): Promise<PaymentRecord | null>;
  /** In ONE transaction: payment created -> completed (with the capture id) and booking pending_payment -> confirmed. Returns null if the payment is no longer 'created'. */
  completePayment(userId: string, bookingId: string, orderId: string, captureId: string): Promise<PaymentRecord | null>;
  /** created -> failed (kept for reconciliation; the capture id is stored when PayPal gave one). Never touches the booking. */
  failPayment(userId: string, bookingId: string, orderId: string, captureId: string | null): Promise<void>;
}
