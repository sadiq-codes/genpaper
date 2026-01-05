-- Add generation lock columns to research_projects table
-- These enable distributed locking for paper generation

ALTER TABLE research_projects 
ADD COLUMN IF NOT EXISTS generation_lock_id TEXT,
ADD COLUMN IF NOT EXISTS generation_lock_at TIMESTAMPTZ;

-- Index for efficient lock queries
CREATE INDEX IF NOT EXISTS idx_research_projects_lock 
ON research_projects (id, generation_lock_id, generation_lock_at);

-- Comment explaining the purpose
COMMENT ON COLUMN research_projects.generation_lock_id IS 'Unique lock identifier for distributed generation locking';
COMMENT ON COLUMN research_projects.generation_lock_at IS 'Timestamp when lock was acquired, used for expiration';
