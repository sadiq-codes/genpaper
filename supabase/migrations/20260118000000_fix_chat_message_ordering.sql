-- Migration: Fix chat message ordering
-- Changes ordering from sequence_number (race-prone) to created_at + id

-- Add composite index for efficient ordering by created_at + id
CREATE INDEX IF NOT EXISTS idx_chat_messages_ordering 
  ON chat_messages(project_id, created_at, id);

-- Note: We keep sequence_number and its trigger for backward compatibility,
-- but the application now orders by (created_at, id) which is race-safe.
-- The existing idx_chat_messages_project_sequence index is retained for any
-- legacy queries but can be dropped in a future migration if unused.

COMMENT ON INDEX idx_chat_messages_ordering IS 'Primary index for chat message ordering - uses created_at + id to avoid race conditions';
