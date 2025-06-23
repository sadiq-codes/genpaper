-- Migration: Fix citations table constraint for upsert_citation function
-- This adds the missing UNIQUE constraint that ON CONFLICT requires

-- Add the missing UNIQUE constraint that upsert_citation expects
ALTER TABLE citations
ADD CONSTRAINT citations_project_key_unique
UNIQUE (project_id, key);

-- Add comment for documentation
COMMENT ON CONSTRAINT citations_project_key_unique ON citations IS 'Ensures unique citation keys per project for upsert_citation ON CONFLICT clause'; 