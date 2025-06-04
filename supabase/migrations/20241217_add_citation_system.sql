-- Migration: Add Citation System for addCitation Tool
-- Creates the tables and functions needed for the hybrid citation approach

-- Create citations table for rich citation metadata
CREATE TABLE IF NOT EXISTS citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES research_projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL, -- MD5 hash or DOI for deduplication
  csl_json JSONB NOT NULL, -- CSL-JSON format for citation-js
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, key)
);

-- Create citation_links table for positional tracking
CREATE TABLE IF NOT EXISTS citation_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES research_projects(id) ON DELETE CASCADE,
  citation_id UUID REFERENCES citations(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  start_pos INT NOT NULL,
  end_pos INT NOT NULL,
  reason TEXT NOT NULL,
  context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS citations_project_key_idx ON citations (project_id, key);
CREATE INDEX IF NOT EXISTS citation_links_project_idx ON citation_links (project_id);
CREATE INDEX IF NOT EXISTS citation_links_citation_idx ON citation_links (citation_id);
CREATE INDEX IF NOT EXISTS citations_csl_json_idx ON citations USING gin (csl_json);

-- Function to upsert citations (needed by addCitation tool)
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
  INSERT INTO citations (project_id, key, csl_json)
  VALUES (p_project_id, p_key, p_data)
  ON CONFLICT (project_id, key) 
  DO UPDATE SET 
    csl_json = EXCLUDED.csl_json,
    updated_at = now()
  RETURNING * INTO result;
  
  RETURN to_jsonb(result);
END;
$$;

-- RLS Policies for citations table
ALTER TABLE citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view citations for their projects" ON citations
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM research_projects 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert citations for their projects" ON citations
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT id FROM research_projects 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update citations for their projects" ON citations
  FOR UPDATE USING (
    project_id IN (
      SELECT id FROM research_projects 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete citations for their projects" ON citations
  FOR DELETE USING (
    project_id IN (
      SELECT id FROM research_projects 
      WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for citation_links table
ALTER TABLE citation_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view citation links for their projects" ON citation_links
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM research_projects 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert citation links for their projects" ON citation_links
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT id FROM research_projects 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update citation links for their projects" ON citation_links
  FOR UPDATE USING (
    project_id IN (
      SELECT id FROM research_projects 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete citation links for their projects" ON citation_links
  FOR DELETE USING (
    project_id IN (
      SELECT id FROM research_projects 
      WHERE user_id = auth.uid()
    )
  );

-- Function to get citations with links for a project (for future phases)
CREATE OR REPLACE FUNCTION get_project_citations(p_project_id UUID)
RETURNS TABLE (
  citation_id UUID,
  citation_key TEXT,
  csl_json JSONB,
  links JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.key,
    c.csl_json,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'section', cl.section,
          'start_pos', cl.start_pos,
          'end_pos', cl.end_pos,
          'reason', cl.reason,
          'context', cl.context
        )
      ) FILTER (WHERE cl.id IS NOT NULL),
      '[]'::jsonb
    ) as links
  FROM citations c
  LEFT JOIN citation_links cl ON c.id = cl.citation_id
  WHERE c.project_id = p_project_id
  GROUP BY c.id, c.key, c.csl_json
  ORDER BY c.created_at;
END;
$$; 