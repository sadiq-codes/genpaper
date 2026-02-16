-- Migration: Add document_versions table for editor history feature
-- Purpose: Store version snapshots of documents for recovery and history browsing

-- 1. Create the document_versions table
CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Trigger type distinguishes manual saves from auto-saves
  trigger_type TEXT NOT NULL DEFAULT 'auto' CHECK (trigger_type IN ('auto', 'manual', 'restore')),
  -- Optional label for manual save points
  label TEXT
);

-- 2. Create index for efficient queries (list versions by project, most recent first)
CREATE INDEX IF NOT EXISTS idx_document_versions_project_created 
  ON document_versions(project_id, created_at DESC);

-- 3. Enable Row Level Security
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policy: Users can only access their own versions
CREATE POLICY "Users can view own versions" ON document_versions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own versions" ON document_versions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own versions" ON document_versions
  FOR DELETE USING (auth.uid() = user_id);

-- 5. Create cleanup function to maintain version limit (keeps last 20 per project)
CREATE OR REPLACE FUNCTION cleanup_document_versions()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete old versions beyond the 20 most recent for this project
  DELETE FROM document_versions
  WHERE project_id = NEW.project_id
    AND id NOT IN (
      SELECT id FROM document_versions
      WHERE project_id = NEW.project_id
      ORDER BY created_at DESC
      LIMIT 20
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create trigger to auto-cleanup after each insert
DROP TRIGGER IF EXISTS trigger_cleanup_document_versions ON document_versions;
CREATE TRIGGER trigger_cleanup_document_versions
  AFTER INSERT ON document_versions
  FOR EACH ROW EXECUTE FUNCTION cleanup_document_versions();

-- 7. Add comment for documentation
COMMENT ON TABLE document_versions IS 'Stores document version snapshots for editor history/recovery feature. Auto-cleans to keep last 20 versions per project.';
