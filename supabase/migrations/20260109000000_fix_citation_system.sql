-- Fix citation system: Update RPC signature and add missing columns
-- This migration aligns the database schema with the TypeScript application code

-- Step 1: Add missing columns to project_citations table
ALTER TABLE project_citations 
  ADD COLUMN IF NOT EXISTS cite_key text,
  ADD COLUMN IF NOT EXISTS first_seen_order integer;

-- Add unique constraint on project_id + paper_id for idempotency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'project_citations_project_paper_unique'
  ) THEN
    ALTER TABLE project_citations 
      ADD CONSTRAINT project_citations_project_paper_unique 
      UNIQUE (project_id, paper_id);
  END IF;
EXCEPTION WHEN others THEN
  -- Constraint might already exist under different name, ignore
  NULL;
END $$;

-- Step 2: Drop old functions (including any return type variations)
DROP FUNCTION IF EXISTS add_citation_unified(uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS add_citation_unified(uuid, uuid, jsonb, text, text);
DROP FUNCTION IF EXISTS get_project_citations_unified(uuid);

-- Create the new unified citation function matching TypeScript expectations
CREATE OR REPLACE FUNCTION add_citation_unified(
  p_project_id uuid,
  p_paper_id uuid,
  p_csl_json jsonb,
  p_reason text DEFAULT NULL,
  p_quote text DEFAULT NULL
)
RETURNS TABLE (
  is_new boolean,
  cite_key text,
  citation_number integer,
  csl_json jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_id uuid;
  v_cite_key text;
  v_is_new boolean := true;
  v_citation_number integer;
  v_csl_json jsonb;
BEGIN
  -- Generate a consistent cite_key from project and paper IDs
  v_cite_key := substring(p_project_id::text from 1 for 8) || '-' || substring(p_paper_id::text from 1 for 8);
  
  -- Check if citation already exists for this project+paper combination
  SELECT id, csl_json INTO v_existing_id, v_csl_json
  FROM project_citations
  WHERE project_id = p_project_id AND paper_id = p_paper_id
  LIMIT 1;
  
  IF v_existing_id IS NOT NULL THEN
    -- Citation exists, return existing data
    v_is_new := false;
    
    -- Get the citation number (order in project)
    SELECT COUNT(*) INTO v_citation_number
    FROM project_citations
    WHERE project_id = p_project_id
      AND created_at <= (SELECT created_at FROM project_citations WHERE id = v_existing_id);
    
    RETURN QUERY SELECT v_is_new, v_cite_key, v_citation_number, v_csl_json;
    RETURN;
  END IF;
  
  -- Calculate next citation number for this project
  SELECT COALESCE(MAX(citation_number), 0) + 1 INTO v_citation_number
  FROM project_citations
  WHERE project_id = p_project_id;
  
  -- Insert new citation
  INSERT INTO project_citations (
    project_id,
    paper_id,
    cite_key,
    citation_number,
    first_seen_order,
    csl_json,
    reason,
    quote,
    created_at
  ) VALUES (
    p_project_id,
    p_paper_id,
    v_cite_key,
    v_citation_number,
    v_citation_number,
    p_csl_json,
    p_reason,
    p_quote,
    NOW()
  )
  ON CONFLICT (project_id, paper_id) DO UPDATE SET
    -- Update if concurrent insert happened
    csl_json = COALESCE(EXCLUDED.csl_json, project_citations.csl_json),
    reason = COALESCE(EXCLUDED.reason, project_citations.reason),
    quote = COALESCE(EXCLUDED.quote, project_citations.quote)
  RETURNING project_citations.csl_json INTO v_csl_json;
  
  RETURN QUERY SELECT v_is_new, v_cite_key, v_citation_number, COALESCE(v_csl_json, p_csl_json);
END;
$$;

-- Step 3: Create or replace the get_project_citations_unified function
CREATE OR REPLACE FUNCTION get_project_citations_unified(p_project_id uuid)
RETURNS TABLE (
  id uuid,
  paper_id uuid,
  cite_key text,
  citation_number integer,
  csl_json jsonb,
  reason text,
  quote text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    pc.id,
    pc.paper_id,
    pc.cite_key,
    pc.citation_number,
    pc.csl_json,
    pc.reason,
    pc.quote,
    pc.created_at
  FROM project_citations pc
  WHERE pc.project_id = p_project_id
  ORDER BY pc.citation_number ASC, pc.created_at ASC;
$$;

-- Step 4: Add index for faster citation lookups
CREATE INDEX IF NOT EXISTS project_citations_project_paper_idx 
  ON project_citations(project_id, paper_id);

CREATE INDEX IF NOT EXISTS project_citations_cite_key_idx 
  ON project_citations(cite_key);

-- Step 5: Grant permissions (if using RLS)
-- These are typically set up in your Supabase dashboard, but adding here for completeness
-- GRANT EXECUTE ON FUNCTION add_citation_unified TO authenticated;
-- GRANT EXECUTE ON FUNCTION get_project_citations_unified TO authenticated;

COMMENT ON FUNCTION add_citation_unified IS 'Add or retrieve a citation for a project. Returns existing citation if paper already cited, or creates new one. Thread-safe with ON CONFLICT handling.';
COMMENT ON FUNCTION get_project_citations_unified IS 'Get all citations for a project, ordered by citation number.';
