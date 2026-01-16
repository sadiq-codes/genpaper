-- Chat messages table for persisting editor chat history
-- Each message belongs to a project and can contain tool invocations

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  
  -- Message content
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  
  -- Tool invocations stored as JSONB array
  -- Each invocation: { toolName, args, state, result }
  tool_invocations JSONB DEFAULT '[]',
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- For ordering within a conversation
  sequence_number INTEGER NOT NULL DEFAULT 0
);

-- Index for fetching chat history by project
CREATE INDEX idx_chat_messages_project_id ON chat_messages(project_id);

-- Index for ordering messages
CREATE INDEX idx_chat_messages_project_sequence ON chat_messages(project_id, sequence_number);

-- Index for created_at (for cleanup/pagination)
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);

-- Enable RLS
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access chat messages for their own projects
CREATE POLICY "Users can view their own chat messages"
  ON chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM research_projects
      WHERE research_projects.id = chat_messages.project_id
      AND research_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert chat messages to their own projects"
  ON chat_messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM research_projects
      WHERE research_projects.id = chat_messages.project_id
      AND research_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own chat messages"
  ON chat_messages
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM research_projects
      WHERE research_projects.id = chat_messages.project_id
      AND research_projects.user_id = auth.uid()
    )
  );

-- Function to get next sequence number for a project
CREATE OR REPLACE FUNCTION get_next_chat_sequence(p_project_id UUID)
RETURNS INTEGER AS $$
DECLARE
  next_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(sequence_number), 0) + 1
  INTO next_seq
  FROM chat_messages
  WHERE project_id = p_project_id;
  
  RETURN next_seq;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-set sequence number
CREATE OR REPLACE FUNCTION set_chat_sequence_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sequence_number = 0 THEN
    NEW.sequence_number := get_next_chat_sequence(NEW.project_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_messages_sequence_trigger
  BEFORE INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION set_chat_sequence_number();

-- Comment on table
COMMENT ON TABLE chat_messages IS 'Stores chat messages for the editor AI assistant, including tool invocations';
COMMENT ON COLUMN chat_messages.tool_invocations IS 'Array of tool calls: [{toolName, args, state, result}]';
