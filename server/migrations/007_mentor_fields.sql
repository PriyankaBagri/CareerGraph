-- Stage E6 (additive): which professional fields a mentor helps with, and the career a booking was made for.
-- A career's field is its existing `careers.category`. A mentor is relevant to a career when the mentor lists that field.
-- Nothing existing is altered or dropped; every statement is safe to re-run.
CREATE TABLE IF NOT EXISTS mentor_fields (
  mentor_id uuid NOT NULL REFERENCES mentors (id) ON DELETE CASCADE,
  field     text NOT NULL CHECK (field <> '' AND field = lower(btrim(field))), -- stored lower-case so matching is exact, never fuzzy
  PRIMARY KEY (mentor_id, field)
);
CREATE INDEX IF NOT EXISTS mentor_fields_field_idx ON mentor_fields (field);

-- The career context of a booking (null = booked from "all mentors"). If a career is later deleted the booking is kept.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS career_id text REFERENCES careers (id) ON DELETE SET NULL;

-- Fields for the three sample mentors that already exist. (The new sample Law mentor is added by `npm run db:seed`.)
INSERT INTO mentor_fields (mentor_id, field)
SELECT m.id, v.field FROM mentors m JOIN (VALUES
  ('00000000-0000-4000-8000-00000000d001'::uuid, 'design'),
  ('00000000-0000-4000-8000-00000000d002'::uuid, 'technology'),
  ('00000000-0000-4000-8000-00000000d003'::uuid, 'finance')
) AS v (id, field) ON v.id = m.id
ON CONFLICT DO NOTHING;
