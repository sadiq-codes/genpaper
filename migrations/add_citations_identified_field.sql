-- Migration: Add citations_identified field to projects table
-- Task 39: Database schema update to support citation identification

ALTER TABLE projects 
ADD COLUMN citations_identified JSONB DEFAULT '[]'::jsonb;

-- Add a comment to document the field
COMMENT ON COLUMN projects.citations_identified IS 'Array of citation concepts identified in the generated content that need academic references';

-- Optional: Create an index for better query performance on citation searches
CREATE INDEX IF NOT EXISTS idx_projects_citations_identified 
ON projects USING GIN (citations_identified); 