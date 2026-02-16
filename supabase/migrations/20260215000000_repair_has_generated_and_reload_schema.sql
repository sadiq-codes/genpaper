-- Repair billing schema drift for project-level generation tracking.
-- This migration is intentionally idempotent and safe to run multiple times.

ALTER TABLE research_projects
ADD COLUMN IF NOT EXISTS has_generated BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill historical generated projects once.
UPDATE research_projects
SET has_generated = TRUE
WHERE has_generated = FALSE
  AND content IS NOT NULL
  AND btrim(content) <> '';

CREATE INDEX IF NOT EXISTS research_projects_has_generated_idx
ON research_projects(user_id, has_generated)
WHERE has_generated = FALSE;

CREATE OR REPLACE FUNCTION mark_project_generated_and_bill(
  p_project_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_rows INTEGER := 0;
BEGIN
  UPDATE research_projects
  SET has_generated = TRUE
  WHERE id = p_project_id
    AND user_id = p_user_id
    AND has_generated = FALSE;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE profiles
  SET papers_used_this_period = papers_used_this_period + 1
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Ensure PostgREST sees schema updates immediately in hosted environments.
NOTIFY pgrst, 'reload schema';
