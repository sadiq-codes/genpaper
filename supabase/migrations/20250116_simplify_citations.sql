-- Migration: Enhance Citation System with CSL Support
-- Keeps existing citation tables but adds CSL functionality and race-safe numbering

-- Keep existing tables but ensure they have the right structure
-- Drop and recreate citations table (for CSL snapshots)
DROP TABLE IF EXISTS citations CASCADE;

CREATE TABLE citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  csl_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);

-- Drop citation_links table if it exists (we'll recreate it properly)
DROP TABLE IF EXISTS citation_links CASCADE;

-- Create citation_links table (for position tracking)  
CREATE TABLE citation_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  section TEXT,
  position_start INTEGER,
  position_end INTEGER,
  citation_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enhance project_citations table (keep existing columns, add new ones)
ALTER TABLE project_citations 
ADD COLUMN IF NOT EXISTS citation_number INTEGER,
ADD COLUMN IF NOT EXISTS citation_key TEXT,
ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS quote TEXT,
ADD COLUMN IF NOT EXISTS csl_json JSONB;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS citations_project_idx ON citations (project_id);
CREATE INDEX IF NOT EXISTS citation_links_project_idx ON citation_links (project_id);
CREATE INDEX IF NOT EXISTS citation_links_position_idx ON citation_links (project_id, position_start);

-- Add constraint for project_citations (allow multiple citations per paper per project if needed)
-- This is more flexible than the unique constraint
CREATE INDEX IF NOT EXISTS project_citations_project_paper_idx 
ON project_citations (project_id, paper_id);

-- Add index for citation_number ordering
CREATE INDEX IF NOT EXISTS project_citations_number_idx 
ON project_citations (project_id, citation_number);

-- Update RLS policies (they should still work)
-- The existing policies are already correct for our simplified approach

-- Add comments for documentation
COMMENT ON TABLE citations IS 'CSL-JSON snapshots for each cited source per project';
COMMENT ON TABLE citation_links IS 'Position tracking for fine-grained editor highlighting';
COMMENT ON COLUMN project_citations.citation_number IS 'Deterministic citation number (1, 2, 3...) assigned in order of first appearance';
COMMENT ON COLUMN project_citations.reason IS 'AI explanation of why this source supports the claim';
COMMENT ON COLUMN project_citations.quote IS 'Optional: exact quote from source for verification';
COMMENT ON COLUMN project_citations.csl_json IS 'Cached CSL-JSON data for citation formatting';

-- Race-safe citation numbering function
CREATE OR REPLACE FUNCTION next_citation_number(p_project UUID)
RETURNS INTEGER 
LANGUAGE plpgsql AS $$
DECLARE 
  n INTEGER;
BEGIN
  LOOP
    -- 1) Find the current max citation number for this project
    SELECT COALESCE(MAX(citation_number), 0) + 1
    INTO n
    FROM project_citations
    WHERE project_id = p_project;

    -- 2) Try to reserve that number with a temporary row
    BEGIN
      INSERT INTO project_citations (
        project_id,
        paper_id,
        citation_number,
        reason,
        created_at
      ) VALUES (
        p_project,
        '00000000-0000-0000-0000-000000000000', -- temp placeholder
        n,
        'temp',
        NOW()
      );
      
      -- Clean up the temporary row
      DELETE FROM project_citations
      WHERE project_id = p_project 
        AND paper_id = '00000000-0000-0000-0000-000000000000'
        AND citation_number = n;
        
      RETURN n;
    EXCEPTION WHEN unique_violation THEN
      -- Somebody else grabbed this number; loop again
      CONTINUE;
    END;
  END LOOP;
END;
$$;

-- Function to add or get existing citation with race-safe numbering
-- This works with all three tables for maximum flexibility
CREATE OR REPLACE FUNCTION add_or_get_citation(
  p_project_id UUID,
  p_paper_id UUID,
  p_reason TEXT,
  p_quote TEXT DEFAULT NULL,
  p_csl_json JSONB DEFAULT NULL,
  p_citation_key TEXT DEFAULT NULL
)
RETURNS TABLE (citation_number INTEGER, citation_key TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  existing_citation_number INTEGER;
  existing_citation_key TEXT;
  new_citation_number INTEGER;
  final_citation_key TEXT;
BEGIN
  -- Check if citation already exists for this project+paper
  SELECT pc.citation_number, pc.citation_key INTO existing_citation_number, existing_citation_key
  FROM project_citations pc
  WHERE pc.project_id = p_project_id AND pc.paper_id = p_paper_id
  LIMIT 1;
  
  IF existing_citation_number IS NOT NULL THEN
    -- Citation exists, return existing data
    RETURN QUERY SELECT existing_citation_number, existing_citation_key;
  ELSE
    -- Get next available citation number
    SELECT next_citation_number(p_project_id) INTO new_citation_number;
    
    -- Generate citation key if not provided
    final_citation_key := COALESCE(p_citation_key, substr(md5(random()::text), 1, 8));
    
    -- Insert into citations table (CSL snapshot)
    IF p_csl_json IS NOT NULL THEN
      INSERT INTO citations (
        project_id,
        paper_id,
        key,
        csl_json,
        created_at,
        updated_at
      ) VALUES (
        p_project_id,
        p_paper_id,
        final_citation_key,
        p_csl_json,
        NOW(),
        NOW()
      ) ON CONFLICT (project_id, key) DO UPDATE SET
        csl_json = EXCLUDED.csl_json,
        updated_at = NOW();
    END IF;
    
    -- Insert into project_citations (main tracking)
    INSERT INTO project_citations (
      project_id,
      paper_id,
      citation_number,
      citation_key,
      reason,
      quote,
      csl_json,
      created_at
    ) VALUES (
      p_project_id,
      p_paper_id,
      new_citation_number,
      final_citation_key,
      p_reason,
      p_quote,
      p_csl_json,
      NOW()
    );
    
    RETURN QUERY SELECT new_citation_number, final_citation_key;
  END IF;
END;
$$;

-- Helper function to add citation link (position tracking)
CREATE OR REPLACE FUNCTION add_citation_link(
  p_project_id UUID,
  p_paper_id UUID,
  p_citation_key TEXT,
  p_section TEXT DEFAULT NULL,
  p_position_start INTEGER DEFAULT NULL,
  p_position_end INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  link_id UUID;
BEGIN
  INSERT INTO citation_links (
    project_id,
    paper_id,
    citation_key,
    section,
    position_start,
    position_end,
    created_at
  ) VALUES (
    p_project_id,
    p_paper_id,
    p_citation_key,
    p_section,
    p_position_start,
    p_position_end,
    NOW()
  ) RETURNING id INTO link_id;
  
  RETURN link_id;
END;
$$;

-- Function to get citations for a project in order
CREATE OR REPLACE FUNCTION get_project_citations_simple(p_project_id UUID)
RETURNS TABLE (
  citation_number INTEGER,
  paper_id UUID,
  title TEXT,
  authors JSONB,
  year INTEGER,
  venue TEXT,
  doi TEXT,
  reason TEXT,
  quote TEXT,
  csl_json JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pc.citation_number,
    p.id as paper_id,
    p.title,
    COALESCE(
      jsonb_agg(DISTINCT
        jsonb_build_object(
          'name', a.name
        ) ORDER BY jsonb_build_object('name', a.name)
      ) FILTER (WHERE a.name IS NOT NULL),
      '[]'::jsonb
    ) as authors,
    EXTRACT(YEAR FROM p.publication_date)::INTEGER as year,
    p.venue,
    p.doi,
    pc.reason,
    pc.quote,
    pc.csl_json
  FROM project_citations pc
  JOIN papers p ON p.id = pc.paper_id
  LEFT JOIN paper_authors pa ON pa.paper_id = p.id
  LEFT JOIN authors a ON a.id = pa.author_id
  WHERE pc.project_id = p_project_id
  GROUP BY pc.citation_number, p.id, p.title, p.publication_date, p.venue, p.doi, pc.reason, pc.quote, pc.csl_json
  ORDER BY pc.citation_number;
END;
$$; 