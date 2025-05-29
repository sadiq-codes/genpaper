-- Migration: Add references_list field to projects table
-- Task 43: Database schema update to support reference list storage

ALTER TABLE projects 
ADD COLUMN references_list JSONB DEFAULT '[]'::jsonb;

-- Add a comment to document the field
COMMENT ON COLUMN projects.references_list IS 'Array of formatted references for the research paper bibliography';

-- Optional: Create an index for better query performance on reference searches
CREATE INDEX IF NOT EXISTS idx_projects_references_list 
ON projects USING GIN (references_list); 