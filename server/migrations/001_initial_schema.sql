-- CareerGraph initial schema.
-- Shared reference data (careers, capabilities, skills, requirements) is separate from per-user data
-- (profile, assessments, evidence, action progress, settings). Every per-user table is keyed by user_id.
-- Skill ids are career-namespaced (e.g. 'ux:data-interpretation') to match the frontend; canonical cross-career skills are future work.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE careers (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  category              text NOT NULL,
  description           text NOT NULL DEFAULT '',
  source                text NOT NULL CHECK (source IN ('seed', 'custom', 'ai')),
  evidence_expectations text[] NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX careers_source_idx ON careers (source);

CREATE TABLE career_capabilities (
  id          text PRIMARY KEY,
  career_id   text NOT NULL REFERENCES careers (id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  position    integer NOT NULL DEFAULT 0
);
CREATE INDEX career_capabilities_career_idx ON career_capabilities (career_id, position);

CREATE TABLE skills (
  id   text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE career_skills (
  career_id      text NOT NULL REFERENCES careers (id) ON DELETE CASCADE,
  skill_id       text NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  capability_id  text NOT NULL REFERENCES career_capabilities (id) ON DELETE CASCADE,
  required_level smallint NOT NULL CHECK (required_level BETWEEN 1 AND 5),
  position       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (career_id, skill_id)
);
CREATE INDEX career_skills_skill_idx ON career_skills (skill_id);
CREATE INDEX career_skills_capability_idx ON career_skills (capability_id);

-- Ownership/provenance of user-created careers. A career with no row here is shared (seeded).
CREATE TABLE custom_careers (
  career_id      text PRIMARY KEY REFERENCES careers (id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  generated_from text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_careers_user_idx ON custom_careers (user_id);

CREATE TABLE profiles (
  user_id             uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  stage               text NOT NULL DEFAULT '',
  education           text NOT NULL DEFAULT '',
  experience_summary  text NOT NULL DEFAULT '',
  experience_level    text NOT NULL DEFAULT 'beginner' CHECK (experience_level IN ('beginner', 'early', 'intermediate', 'experienced')),
  target_career_id    text REFERENCES careers (id) ON DELETE SET NULL,
  onboarding_complete boolean NOT NULL DEFAULT false,
  completeness        smallint NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 100),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_target_career_idx ON profiles (target_career_id);

-- A row means "the user rated this skill". No row means NOT ASSESSED (it is never stored as level 0).
CREATE TABLE skill_assessments (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  skill_id    text NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  level       smallint NOT NULL CHECK (level BETWEEN 0 AND 5),
  assessed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, skill_id)
);
CREATE INDEX skill_assessments_skill_idx ON skill_assessments (skill_id);

CREATE TABLE evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title         text NOT NULL,
  type          text NOT NULL,
  description   text NOT NULL,
  url           text,
  evidence_date date,
  organization  text,
  strength      text NOT NULL CHECK (strength IN ('weak', 'moderate', 'strong', 'very_strong')),
  source        text NOT NULL DEFAULT 'user' CHECK (source = 'user'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_user_idx ON evidence (user_id, created_at DESC);

CREATE TABLE evidence_skills (
  evidence_id uuid NOT NULL REFERENCES evidence (id) ON DELETE CASCADE,
  skill_id    text NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  PRIMARY KEY (evidence_id, skill_id)
);
CREATE INDEX evidence_skills_skill_idx ON evidence_skills (skill_id);

CREATE TABLE readiness_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  career_id      text NOT NULL REFERENCES careers (id) ON DELETE CASCADE,
  overall        smallint NOT NULL CHECK (overall BETWEEN 0 AND 100),
  state          text NOT NULL CHECK (state IN ('not_assessed', 'partial', 'assessed')),
  assessed_count integer NOT NULL CHECK (assessed_count >= 0),
  total_count    integer NOT NULL CHECK (total_count >= 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX readiness_snapshots_lookup_idx ON readiness_snapshots (user_id, career_id, created_at DESC);

CREATE TABLE gaps (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id    uuid NOT NULL REFERENCES readiness_snapshots (id) ON DELETE CASCADE,
  skill_id       text NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('skill', 'evidence', 'combined')),
  size           smallint NOT NULL DEFAULT 0 CHECK (size >= 0),
  evidence_count integer NOT NULL DEFAULT 0 CHECK (evidence_count >= 0)
);
CREATE INDEX gaps_snapshot_idx ON gaps (snapshot_id);

-- Definitions of generated actions the user has acted on (kept as history even after the gap closes).
CREATE TABLE actions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  career_id              text NOT NULL REFERENCES careers (id) ON DELETE CASCADE,
  action_key             text NOT NULL,
  title                  text NOT NULL,
  description            text NOT NULL,
  type                   text NOT NULL,
  phase                  text NOT NULL CHECK (phase IN ('foundation', 'skill_building', 'evidence_building', 'career_readiness')),
  priority               text NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  priority_score         smallint NOT NULL DEFAULT 0,
  impact                 text NOT NULL,
  effort                 text NOT NULL,
  estimated_time         text NOT NULL DEFAULT '',
  reason                 text NOT NULL DEFAULT '',
  prerequisites          text[] NOT NULL DEFAULT '{}',
  related_skill_ids      text[] NOT NULL DEFAULT '{}',
  related_capability_ids text[] NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, career_id, action_key)
);

-- Progress state, scoped by user AND career (denormalized for scoping queries).
CREATE TABLE roadmap_items (
  action_id    uuid PRIMARY KEY REFERENCES actions (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  career_id    text NOT NULL REFERENCES careers (id) ON DELETE CASCADE,
  phase        text NOT NULL CHECK (phase IN ('foundation', 'skill_building', 'evidence_building', 'career_readiness')),
  status       text NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed')),
  position     integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX roadmap_items_scope_idx ON roadmap_items (user_id, career_id);

CREATE TABLE user_settings (
  user_id               uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  reduce_motion         boolean NOT NULL DEFAULT false,
  assistant_suggestions boolean NOT NULL DEFAULT true,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
