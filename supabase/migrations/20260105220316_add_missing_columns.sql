-- Add missing columns to existing tables

-- 1. Add updated_at to research_projects
ALTER TABLE research_projects 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Add url column to papers (separate from pdf_url for landing page URLs)
ALTER TABLE papers 
ADD COLUMN IF NOT EXISTS url TEXT;

-- 3. Create citations table if it doesn't exist
-- This is the normalized citation tracking table referenced in app/api/citations/route.ts
CREATE TABLE IF NOT EXISTS citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES papers(id) ON DELETE SET NULL,
  key TEXT NOT NULL, -- Citation key like "smith2023"
  csl_json JSONB, -- CSL-JSON citation data
  citation_text TEXT, -- Formatted citation text
  context TEXT, -- Where/why the citation was used
  citation_number INTEGER,
  first_seen_order INTEGER, -- Order in which citation was first used in document
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, key)
);

-- Indexes for citations table
CREATE INDEX IF NOT EXISTS idx_citations_project_id ON citations(project_id);
CREATE INDEX IF NOT EXISTS idx_citations_paper_id ON citations(paper_id);
CREATE INDEX IF NOT EXISTS idx_citations_key ON citations(key);

-- 4. Add trigger to auto-update updated_at on research_projects
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to research_projects
DROP TRIGGER IF EXISTS update_research_projects_updated_at ON research_projects;
CREATE TRIGGER update_research_projects_updated_at
  BEFORE UPDATE ON research_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to citations
DROP TRIGGER IF EXISTS update_citations_updated_at ON citations;
CREATE TRIGGER update_citations_updated_at
  BEFORE UPDATE ON citations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comment on new columns
COMMENT ON COLUMN research_projects.updated_at IS 'Last modification timestamp';
COMMENT ON COLUMN papers.url IS 'Landing page URL (distinct from pdf_url)';
COMMENT ON TABLE citations IS 'Normalized citation tracking for projects';
