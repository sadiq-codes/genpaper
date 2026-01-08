-- Evidence Tracking Table
-- Tracks used evidence across sections to prevent repetition and enable resumable generation

CREATE TABLE IF NOT EXISTS project_evidence_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  section_title TEXT NOT NULL,
  content_preview TEXT, -- First 200 chars for debugging
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicate tracking
  UNIQUE(project_id, paper_id, content_hash)
);

-- Index for fast lookups by project
CREATE INDEX IF NOT EXISTS idx_evidence_usage_project 
  ON project_evidence_usage(project_id);

-- Index for paper-based queries
CREATE INDEX IF NOT EXISTS idx_evidence_usage_paper 
  ON project_evidence_usage(paper_id);

-- Composite index for the common query pattern
CREATE INDEX IF NOT EXISTS idx_evidence_usage_project_hash 
  ON project_evidence_usage(project_id, content_hash);

-- Function to check if evidence is already used
CREATE OR REPLACE FUNCTION is_evidence_used(
  p_project_id UUID,
  p_paper_id UUID,
  p_content_hash TEXT
) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_evidence_usage
    WHERE project_id = p_project_id
      AND paper_id = p_paper_id
      AND content_hash = p_content_hash
  );
$$;

-- Function to track evidence usage (upsert)
CREATE OR REPLACE FUNCTION track_evidence_usage(
  p_project_id UUID,
  p_paper_id UUID,
  p_content_hash TEXT,
  p_section_title TEXT,
  p_content_preview TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO project_evidence_usage (project_id, paper_id, content_hash, section_title, content_preview)
  VALUES (p_project_id, p_paper_id, p_content_hash, p_section_title, p_content_preview)
  ON CONFLICT (project_id, paper_id, content_hash) DO UPDATE
    SET section_title = EXCLUDED.section_title,
        content_preview = COALESCE(EXCLUDED.content_preview, project_evidence_usage.content_preview)
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

-- Function to clear evidence for a project (for retry/reset)
CREATE OR REPLACE FUNCTION clear_project_evidence(p_project_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM project_evidence_usage WHERE project_id = p_project_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Function to get evidence usage stats for a project
CREATE OR REPLACE FUNCTION get_evidence_stats(p_project_id UUID)
RETURNS TABLE (
  total_used INTEGER,
  papers_used INTEGER,
  sections_count INTEGER,
  section_usage JSONB
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_total INTEGER;
  v_papers INTEGER;
  v_sections INTEGER;
  v_section_usage JSONB;
BEGIN
  -- Get aggregate counts from the main table
  SELECT 
    COUNT(*)::INTEGER,
    COUNT(DISTINCT paper_id)::INTEGER,
    COUNT(DISTINCT section_title)::INTEGER
  INTO v_total, v_papers, v_sections
  FROM project_evidence_usage
  WHERE project_id = p_project_id;
  
  -- Build section usage JSON
  SELECT COALESCE(jsonb_object_agg(section_title, section_count), '{}'::jsonb)
  INTO v_section_usage
  FROM (
    SELECT section_title, COUNT(*)::INTEGER as section_count
    FROM project_evidence_usage
    WHERE project_id = p_project_id
    GROUP BY section_title
  ) section_counts;
  
  RETURN QUERY SELECT v_total, v_papers, v_sections, v_section_usage;
END;
$$;

COMMENT ON TABLE project_evidence_usage IS 'Tracks evidence chunks used across sections to prevent repetition during paper generation';
