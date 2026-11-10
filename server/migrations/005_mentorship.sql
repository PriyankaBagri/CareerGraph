-- Stage E1 (additive): mentors, bookable sessions with a SERVER-CONTROLLED price, and student bookings.
-- Prices live only in mentor_sessions; a booking copies the price at booking time so later price changes never rewrite history.
-- Money is numeric (never floating point). Nothing existing is altered; every statement is safe to re-run.
CREATE TABLE IF NOT EXISTS mentors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  headline     text NOT NULL,
  bio          text NOT NULL DEFAULT '',
  expertise    text[] NOT NULL DEFAULT '{}',
  is_demo      boolean NOT NULL DEFAULT false, -- true = illustrative sample data, not a real or verified professional
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mentor_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id        uuid NOT NULL REFERENCES mentors (id) ON DELETE CASCADE,
  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  duration_minutes smallint NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
  price            numeric(10, 2) NOT NULL CHECK (price > 0),
  currency         char(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mentor_sessions_mentor_idx ON mentor_sessions (mentor_id);

CREATE TABLE IF NOT EXISTS bookings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES mentor_sessions (id) ON DELETE RESTRICT,
  amount     numeric(10, 2) NOT NULL CHECK (amount > 0), -- copied from mentor_sessions.price by the server when the booking is created
  currency   char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status     text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_session_idx ON bookings (session_id);
-- One open (unpaid) booking per student and session: repeated clicks or retries cannot pile up duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_pending_idx ON bookings (user_id, session_id) WHERE status = 'pending_payment';
