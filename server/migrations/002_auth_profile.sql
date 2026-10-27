-- Backend Stage 2: authentication + profiles. Only what Stage 1 did not already provide.
-- (users: id, email, name, password_hash, created_at and the unique lower(email) index already exist.
--  profiles: user_id PRIMARY KEY REFERENCES users ON DELETE CASCADE already enforces one profile per user.
--  The display name stays on users.name; it is not duplicated onto profiles.)

ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
-- Defence in depth: the application normalizes emails; the database refuses anything that is not.
ALTER TABLE users ADD CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1);

-- Profile text fields become genuinely optional (NULL = not provided) and education is renamed to match the API.
ALTER TABLE profiles RENAME COLUMN education TO education_summary;
ALTER TABLE profiles
  ALTER COLUMN education_summary DROP NOT NULL,
  ALTER COLUMN education_summary DROP DEFAULT,
  ALTER COLUMN experience_summary DROP NOT NULL,
  ALTER COLUMN experience_summary DROP DEFAULT;

ALTER TABLE profiles ADD COLUMN about_note text;
ALTER TABLE profiles ADD CONSTRAINT profiles_about_note_length CHECK (about_note IS NULL OR char_length(about_note) <= 500);
ALTER TABLE profiles ADD CONSTRAINT profiles_summaries_length CHECK (char_length(coalesce(experience_summary, '')) <= 1000 AND char_length(coalesce(education_summary, '')) <= 500);
