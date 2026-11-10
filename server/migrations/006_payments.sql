-- Stage E2 (additive): one row per PayPal order raised for a booking. Nothing existing is altered.
-- amount/currency are a snapshot of the booking's trusted price at the time the order is raised (copied by the server, never supplied by the browser).
-- status: created = PayPal order exists, awaiting payer approval and capture; completed = PayPal confirmed the capture; failed = PayPal reported the capture as declined or failed.
CREATE TABLE IF NOT EXISTS payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  paypal_order_id   text NOT NULL,
  paypal_capture_id text,
  amount            numeric(10, 2) NOT NULL CHECK (amount > 0),
  currency          char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status            text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'completed', 'failed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_completed_has_capture CHECK (status <> 'completed' OR paypal_capture_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_order_idx ON payments (paypal_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_capture_idx ON payments (paypal_capture_id) WHERE paypal_capture_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_booking_idx ON payments (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments (user_id);
-- At most one live order per booking, and at most one completed payment per booking.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_idx ON payments (booking_id) WHERE status = 'created';
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_completed_idx ON payments (booking_id) WHERE status = 'completed';
