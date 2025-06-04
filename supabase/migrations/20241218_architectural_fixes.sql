-- Migration: Architectural Fixes for Citation System
-- Adds additional constraints and optimizations

-- Ensure foreign key constraint exists (should already be there from previous migration)
-- This is defensive in case the constraint was missed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'citation_links_citation_id_fkey'
    AND table_name = 'citation_links'
  ) THEN
    ALTER TABLE citation_links 
    ADD CONSTRAINT citation_links_citation_id_fkey 
    FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add additional performance indexes if they don't exist
CREATE INDEX IF NOT EXISTS citations_updated_at_idx ON citations (updated_at DESC);
CREATE INDEX IF NOT EXISTS citation_links_start_pos_idx ON citation_links (start_pos);
CREATE INDEX IF NOT EXISTS citation_links_section_idx ON citation_links (section);

-- Add constraint to ensure citation keys are not empty
ALTER TABLE citations ADD CONSTRAINT citations_key_not_empty CHECK (length(trim(key)) > 0);

-- Add constraint to ensure CSL JSON is not empty
ALTER TABLE citations ADD CONSTRAINT citations_csl_json_not_empty CHECK (csl_json != '{}'::jsonb);

-- Add constraint to ensure positional data is valid
ALTER TABLE citation_links ADD CONSTRAINT citation_links_valid_positions CHECK (start_pos <= end_pos);

-- Update the upsert function to handle the new constraints
CREATE OR REPLACE FUNCTION upsert_citation(
  p_project_id UUID,
  p_key TEXT,
  p_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  result citations;
BEGIN
  -- Validate inputs
  IF length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'Citation key cannot be empty';
  END IF;
  
  IF p_data = '{}'::jsonb THEN
    RAISE EXCEPTION 'CSL JSON cannot be empty';
  END IF;

  INSERT INTO citations (project_id, key, csl_json)
  VALUES (p_project_id, trim(p_key), p_data)
  ON CONFLICT (project_id, key) 
  DO UPDATE SET 
    csl_json = EXCLUDED.csl_json,
    updated_at = now()
  RETURNING * INTO result;
  
  RETURN to_jsonb(result);
END;
$$; 