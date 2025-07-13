-- Migration: Unified Citation Service
-- Collapses CITE + HYDRA into single service with immediate formatting
-- Replaces three tables (citations, project_citations, citation_links) with one unified table

-- 🗑️ DROP OLD COMPLEX SCHEMA
DROP TABLE IF EXISTS citation_links CASCADE;
DROP TABLE IF EXISTS citations CASCADE;

-- 🔄 RECREATE project_citations as the SINGLE unified table
DROP TABLE IF EXISTS project_citations CASCADE;

CREATE TABLE project_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  
  -- Deterministic numbering (1, 2, 3...)
  number INTEGER NOT NULL,
  
  -- CSL-JSON stored immediately during tool call
  csl_json JSONB NOT NULL,
  
  -- Citation context
  reason TEXT NOT NULL,
  quote TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(project_id, paper_id), -- One citation per paper per project
  UNIQUE(project_id, number)    -- Sequential numbering per project
);

-- 📊 INDEXES for performance
CREATE INDEX project_citations_project_idx ON project_citations (project_id);
CREATE INDEX project_citations_number_idx ON project_citations (project_id, number);
CREATE INDEX project_citations_paper_idx ON project_citations (paper_id);
CREATE INDEX project_citations_csl_gin_idx ON project_citations USING gin (csl_json);

-- 🔄 SIMPLIFIED citation numbering with INSERT...ON CONFLICT pattern
CREATE OR REPLACE FUNCTION add_citation_unified(
  p_project_id UUID,
  p_paper_id UUID,
  p_csl_json JSONB,
  p_reason TEXT,
  p_quote TEXT DEFAULT NULL
)
RETURNS TABLE (
  citation_number INTEGER,
  is_new BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  existing_number INTEGER;
  new_number INTEGER;
BEGIN
  -- Check if citation already exists
  SELECT number INTO existing_number
  FROM project_citations
  WHERE project_id = p_project_id AND paper_id = p_paper_id;
  
  IF existing_number IS NOT NULL THEN
    -- Return existing citation
    RETURN QUERY SELECT existing_number, false;
  ELSE
    -- Get next number using INSERT...ON CONFLICT pattern
    WITH next_num AS (
      SELECT COALESCE(MAX(number), 0) + 1 as next_number
      FROM project_citations
      WHERE project_id = p_project_id
    )
    INSERT INTO project_citations (
      project_id,
      paper_id,
      number,
      csl_json,
      reason,
      quote
    )
    SELECT 
      p_project_id,
      p_paper_id,
      next_number,
      p_csl_json,
      p_reason,
      p_quote
    FROM next_num
    ON CONFLICT (project_id, paper_id) DO NOTHING
    RETURNING number INTO new_number;
    
    -- Handle race condition - if INSERT failed due to conflict, get existing number
    IF new_number IS NULL THEN
      SELECT number INTO new_number
      FROM project_citations
      WHERE project_id = p_project_id AND paper_id = p_paper_id;
      RETURN QUERY SELECT new_number, false;
    ELSE
      RETURN QUERY SELECT new_number, true;
    END IF;
  END IF;
END;
$$;

-- 📚 FUNCTION to get all citations for bibliography generation
CREATE OR REPLACE FUNCTION get_project_citations_unified(p_project_id UUID)
RETURNS TABLE (
  number INTEGER,
  paper_id UUID,
  csl_json JSONB,
  reason TEXT,
  quote TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pc.number,
    pc.paper_id,
    pc.csl_json,
    pc.reason,
    pc.quote,
    pc.created_at
  FROM project_citations pc
  WHERE pc.project_id = p_project_id
  ORDER BY pc.number;
END;
$$;

-- 🔐 RLS POLICIES
ALTER TABLE project_citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage citations for their projects" ON project_citations
  FOR ALL USING (
    project_id IN (
      SELECT id FROM research_projects 
      WHERE user_id = auth.uid()
    )
  );

-- 📝 DOCUMENTATION
COMMENT ON TABLE project_citations IS 'Unified citation service - single table for all citation data';
COMMENT ON COLUMN project_citations.number IS 'Sequential citation number (1, 2, 3...) assigned deterministically';
COMMENT ON COLUMN project_citations.csl_json IS 'CSL-JSON stored immediately during addCitation tool call';
COMMENT ON COLUMN project_citations.reason IS 'AI explanation of why this source supports the claim';
COMMENT ON COLUMN project_citations.quote IS 'Optional exact quote from source for verification';

-- 🧹 CLEANUP old functions that are no longer needed
DROP FUNCTION IF EXISTS add_or_get_citation CASCADE;
DROP FUNCTION IF EXISTS next_citation_number CASCADE;
DROP FUNCTION IF EXISTS get_project_citations_simple CASCADE;
DROP FUNCTION IF EXISTS upsert_citation CASCADE;
DROP FUNCTION IF EXISTS create_citation_with_link CASCADE;
DROP FUNCTION IF EXISTS add_citation_link CASCADE; 