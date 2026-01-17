-- Conversation Memory table for tracking context across chat turns
-- Enables AI to remember identified gaps, suggestions, and key decisions

CREATE TABLE IF NOT EXISTS chat_conversation_memory (
  -- One memory record per project
  project_id UUID PRIMARY KEY REFERENCES research_projects(id) ON DELETE CASCADE,
  
  -- AI-generated summary of the conversation so far
  summary TEXT,
  
  -- Identified gaps/issues in the document
  -- Array of strings: ["Diverse religious perspectives", "Contemporary analysis", ...]
  identified_gaps JSONB DEFAULT '[]',
  
  -- Suggestions made by AI that user hasn't acted on yet
  -- Array of objects: [{id, suggestion, context, timestamp}]
  pending_suggestions JSONB DEFAULT '[]',
  
  -- Key decisions made during conversation
  -- Array of objects: [{decision, context, timestamp}]
  key_decisions JSONB DEFAULT '[]',
  
  -- Recent document edits made via AI
  -- Array of objects: [{toolName, description, timestamp, blockId?}]
  recent_edits JSONB DEFAULT '[]',
  
  -- Topics/sections the user has asked about
  -- Helps AI understand user's focus areas
  discussed_topics JSONB DEFAULT '[]',
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE chat_conversation_memory ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access memory for their own projects
CREATE POLICY "Users can view their own conversation memory"
  ON chat_conversation_memory
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM research_projects
      WHERE research_projects.id = chat_conversation_memory.project_id
      AND research_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert conversation memory for their own projects"
  ON chat_conversation_memory
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM research_projects
      WHERE research_projects.id = chat_conversation_memory.project_id
      AND research_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own conversation memory"
  ON chat_conversation_memory
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM research_projects
      WHERE research_projects.id = chat_conversation_memory.project_id
      AND research_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own conversation memory"
  ON chat_conversation_memory
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM research_projects
      WHERE research_projects.id = chat_conversation_memory.project_id
      AND research_projects.user_id = auth.uid()
    )
  );

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_conversation_memory_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversation_memory_updated_at_trigger
  BEFORE UPDATE ON chat_conversation_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_memory_timestamp();

-- Comment on table
COMMENT ON TABLE chat_conversation_memory IS 'Stores conversation context to enable AI to remember across chat turns';
COMMENT ON COLUMN chat_conversation_memory.identified_gaps IS 'Gaps/issues in document identified by AI: ["gap1", "gap2"]';
COMMENT ON COLUMN chat_conversation_memory.pending_suggestions IS 'Suggestions not yet acted on: [{id, suggestion, context, timestamp}]';
COMMENT ON COLUMN chat_conversation_memory.key_decisions IS 'Decisions made: [{decision, context, timestamp}]';
COMMENT ON COLUMN chat_conversation_memory.recent_edits IS 'Recent AI edits: [{toolName, description, timestamp}]';
