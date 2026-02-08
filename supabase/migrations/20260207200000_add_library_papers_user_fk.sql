-- Add foreign key constraint on library_papers.user_id
-- This ensures referential integrity and cascades deletes when users are removed

-- First, clean up any orphaned records (user_id that doesn't exist in auth.users)
-- This shouldn't happen in practice but we want the migration to succeed
DELETE FROM library_papers 
WHERE user_id NOT IN (SELECT id FROM auth.users);

-- Add the foreign key constraint
ALTER TABLE library_papers 
ADD CONSTRAINT library_papers_user_id_fkey 
FOREIGN KEY (user_id) 
REFERENCES auth.users(id) 
ON DELETE CASCADE;

-- Add an index on user_id for better query performance (if not exists)
CREATE INDEX IF NOT EXISTS idx_library_papers_user_id ON library_papers(user_id);

COMMENT ON CONSTRAINT library_papers_user_id_fkey ON library_papers IS 
  'Ensures library papers are linked to valid users and cleaned up when users are deleted';
