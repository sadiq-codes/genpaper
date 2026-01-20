-- Migration: Add citation_instances table for tracking individual citation quotes
-- Each citation instance links a specific quote to a specific citation marker in a document

-- Create citation_instances table
CREATE TABLE IF NOT EXISTS citation_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  quote text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Index for fetching instances by ID (used on document load)
CREATE INDEX IF NOT EXISTS idx_citation_instances_lookup ON citation_instances(id);

-- Index for fetching all instances for a project (for bulk operations)
CREATE INDEX IF NOT EXISTS idx_citation_instances_project ON citation_instances(project_id);

-- Index for fetching instances by project and paper (for analytics)
CREATE INDEX IF NOT EXISTS idx_citation_instances_project_paper ON citation_instances(project_id, paper_id);

-- Enable RLS
ALTER TABLE citation_instances ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can only access instances in their own projects
CREATE POLICY "Users can view their own citation instances"
  ON citation_instances FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM research_projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own citation instances"
  ON citation_instances FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT id FROM research_projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own citation instances"
  ON citation_instances FOR DELETE
  USING (
    project_id IN (
      SELECT id FROM research_projects WHERE user_id = auth.uid()
    )
  );

-- Comment on table
COMMENT ON TABLE citation_instances IS 'Tracks individual citation instances with their quotes for hover preview. Each [@paperId#instanceId] marker in a document links to a row here.';
COMMENT ON COLUMN citation_instances.quote IS 'The exact quote from the source paper that supports this citation instance (max ~100 words recommended)';
