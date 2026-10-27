-- Stage 7 (additive, re-runnable): per-career evaluation settings and per-skill evidence requirements.
-- Nothing is dropped, renamed, truncated or rewritten. Existing rows get NULL, which means "use the built-in defaults", so every existing readiness result is unchanged.
ALTER TABLE careers ADD COLUMN IF NOT EXISTS evaluation_rules jsonb;
ALTER TABLE careers DROP CONSTRAINT IF EXISTS careers_evaluation_rules_object;
ALTER TABLE careers ADD CONSTRAINT careers_evaluation_rules_object CHECK (evaluation_rules IS NULL OR jsonb_typeof(evaluation_rules) = 'object');

ALTER TABLE career_skills ADD COLUMN IF NOT EXISTS min_evidence smallint;
ALTER TABLE career_skills DROP CONSTRAINT IF EXISTS career_skills_min_evidence_range;
ALTER TABLE career_skills ADD CONSTRAINT career_skills_min_evidence_range CHECK (min_evidence IS NULL OR min_evidence BETWEEN 1 AND 10);
