-- Backend Stage 3: core CareerGraph data. 001 already created the normalized tables (careers, career_capabilities, skills,
-- career_skills [= career requirements], skill_assessments [= user skills], evidence, evidence_skills, custom_careers) and the
-- profiles.target_career_id foreign key. This migration only adds what was missing. It is written to be safely re-runnable
-- (IF NOT EXISTS / drop-then-add constraints), never drops a table or column, and never deletes data.

-- careers / capabilities / skills: audit timestamps, skill description + category
ALTER TABLE careers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS careers_name_idx ON careers (lower(name));

ALTER TABLE career_capabilities
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS skills_name_idx ON skills (lower(name));

-- requirements: importance (1 = minor ... 5 = critical). The frontend does not model importance yet, so seeded rows use the default 3.
ALTER TABLE career_skills ADD COLUMN IF NOT EXISTS importance smallint NOT NULL DEFAULT 3;
ALTER TABLE career_skills DROP CONSTRAINT IF EXISTS career_skills_importance_range;
ALTER TABLE career_skills ADD CONSTRAINT career_skills_importance_range CHECK (importance BETWEEN 1 AND 5);
CREATE INDEX IF NOT EXISTS career_skills_career_position_idx ON career_skills (career_id, position);

-- user skills: assessment provenance + audit timestamps. A row still means "rated"; no row means NOT ASSESSED (never stored as 0).
ALTER TABLE skill_assessments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE skill_assessments DROP CONSTRAINT IF EXISTS skill_assessments_source_length;
ALTER TABLE skill_assessments ADD CONSTRAINT skill_assessments_source_length CHECK (char_length(source) BETWEEN 1 AND 30);

-- evidence <-> skill link timestamp; evidence field limits enforced by the database as well as the API
ALTER TABLE evidence_skills ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_text_limits;
ALTER TABLE evidence ADD CONSTRAINT evidence_text_limits CHECK (
  char_length(btrim(title)) BETWEEN 1 AND 200 AND char_length(btrim(description)) BETWEEN 1 AND 2000
  AND (url IS NULL OR char_length(url) <= 2048) AND (organization IS NULL OR char_length(organization) <= 200));
ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_url_scheme;
ALTER TABLE evidence ADD CONSTRAINT evidence_url_scheme CHECK (url IS NULL OR url ~* '^https?://');
CREATE INDEX IF NOT EXISTS evidence_user_type_idx ON evidence (user_id, type);
