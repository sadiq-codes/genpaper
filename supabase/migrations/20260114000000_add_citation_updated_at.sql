-- Add updated_at column to project_citations for tracking citation edits
-- This allows tracking when citation metadata was last modified

ALTER TABLE project_citations 
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

-- Create a trigger to automatically update updated_at on any row change
CREATE OR REPLACE FUNCTION update_project_citations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS project_citations_updated_at_trigger ON project_citations;

CREATE TRIGGER project_citations_updated_at_trigger
  BEFORE UPDATE ON project_citations
  FOR EACH ROW
  EXECUTE FUNCTION update_project_citations_updated_at();

-- Add index for querying recently updated citations
CREATE INDEX IF NOT EXISTS project_citations_updated_at_idx 
  ON project_citations(updated_at DESC);

COMMENT ON COLUMN project_citations.updated_at IS 'Timestamp of last citation metadata update';
