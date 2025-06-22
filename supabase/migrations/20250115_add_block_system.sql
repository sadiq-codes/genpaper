-- Add block-based document system to existing schema
-- This integrates with existing research_projects table

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- Function to generate ULID (time-sortable unique identifier)
CREATE OR REPLACE FUNCTION generate_ulid() RETURNS CHAR(26) AS $$
DECLARE
  timestamp BIGINT;
  random_part TEXT;
  encoding TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  timestamp_chars TEXT := '';
  random_chars TEXT := '';
  i INTEGER;
BEGIN
  -- Get current timestamp in milliseconds since epoch (explicit cast)
  timestamp := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  
  -- Convert timestamp to base32
  FOR i IN 1..10 LOOP
    timestamp_chars := substring(encoding, (timestamp % 32) + 1, 1) || timestamp_chars;
    timestamp := timestamp / 32;
  END LOOP;
  
  -- Generate 16 random characters
  FOR i IN 1..16 LOOP
    random_chars := random_chars || substring(encoding, floor(random() * 32) + 1, 1);
  END LOOP;
  
  RETURN (timestamp_chars || random_chars)::CHAR(26);
END;
$$ LANGUAGE plpgsql;

-- Block types lookup table for better extensibility
CREATE TABLE IF NOT EXISTS block_types (
  type TEXT PRIMARY KEY,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Insert standard block types
INSERT INTO block_types (type, description) VALUES
  ('paragraph', 'Standard text paragraph'),
  ('heading', 'Section heading (h1-h6)'),
  ('citation', 'Academic citation reference'),
  ('image', 'Image or figure'),
  ('table', 'Data table'),
  ('code', 'Code block'),
  ('quote', 'Blockquote'),
  ('list', 'Ordered or unordered list'),
  ('list_item', 'List item'),
  ('section', 'Document section wrapper'),
  ('callout', 'Highlighted callout box'),
  ('bullet_list', 'Bullet point list')
ON CONFLICT (type) DO NOTHING;

-- Documents table (maps to existing research_projects)
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES research_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
  -- Removed UNIQUE(project_id) to allow multiple documents per project
);

-- Blocks table - the core of the block-based system
CREATE TABLE IF NOT EXISTS blocks (
  id CHAR(26) PRIMARY KEY DEFAULT generate_ulid(), -- ULID for natural ordering
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  parent_id CHAR(26) REFERENCES blocks(id) ON DELETE CASCADE, -- For nested blocks
  type TEXT NOT NULL REFERENCES block_types(type), -- FK to block_types table
  content JSONB NOT NULL DEFAULT '{}', -- Tiptap node content
  position NUMERIC(8,4) NOT NULL DEFAULT 0, -- Precise ordering within same parent
  metadata JSONB DEFAULT '{}', -- Additional block-specific data
  embedding VECTOR(1536), -- For semantic search
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Block citations - links blocks to citation system
CREATE TABLE IF NOT EXISTS block_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id CHAR(26) REFERENCES blocks(id) ON DELETE CASCADE,
  citation_id UUID, -- Will add FK constraint when citations table exists
  doi TEXT,
  title TEXT,
  authors JSONB,
  year INTEGER,
  journal TEXT,
  citation_key TEXT NOT NULL, -- [CITE:key] identifier
  position_start INTEGER, -- Character position in block content
  position_end INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(block_id, citation_key) -- Prevent duplicate citations in same block
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_blocks_document_id ON blocks(document_id);
CREATE INDEX IF NOT EXISTS idx_blocks_parent_id ON blocks(parent_id);
CREATE INDEX IF NOT EXISTS idx_blocks_type ON blocks(type);
CREATE INDEX IF NOT EXISTS idx_block_citations_block_id ON block_citations(block_id);
CREATE INDEX IF NOT EXISTS idx_block_citations_citation_key ON block_citations(citation_key);

-- Covering index for block lists (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_blocks_list 
ON blocks(document_id, parent_id, position);

-- Full-text search on block content
CREATE INDEX IF NOT EXISTS idx_blocks_content_text 
ON blocks USING gin (to_tsvector('english', content ->> 'text'));

-- Optimize embedding storage and create IVFFLAT index
ALTER TABLE blocks ALTER COLUMN embedding SET STORAGE PLAIN;
CREATE INDEX IF NOT EXISTS idx_blocks_embedding ON blocks 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- RLS policies
ALTER TABLE block_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE block_citations ENABLE ROW LEVEL SECURITY;

-- Block types are readable by all authenticated users
CREATE POLICY "Block types are readable by all users" ON block_types
  FOR SELECT USING (auth.role() = 'authenticated');

-- Documents policies (separate USING and WITH CHECK)
CREATE POLICY "Users can view their documents" ON documents
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert their documents" ON documents
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their documents" ON documents
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their documents" ON documents
  FOR DELETE USING (user_id = auth.uid());

-- Blocks policies (separate USING and WITH CHECK)
CREATE POLICY "Users can view blocks in their documents" ON blocks
  FOR SELECT USING (
    document_id IN (
      SELECT id FROM documents WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert blocks in their documents" ON blocks
  FOR INSERT WITH CHECK (
    document_id IN (
      SELECT id FROM documents WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update blocks in their documents" ON blocks
  FOR UPDATE USING (
    document_id IN (
      SELECT id FROM documents WHERE user_id = auth.uid()
    )
  ) WITH CHECK (
    document_id IN (
      SELECT id FROM documents WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete blocks in their documents" ON blocks
  FOR DELETE USING (
    document_id IN (
      SELECT id FROM documents WHERE user_id = auth.uid()
    )
  );

-- Block citations policies (separate USING and WITH CHECK)
CREATE POLICY "Users can view their block citations" ON block_citations
  FOR SELECT USING (
    block_id IN (
      SELECT b.id FROM blocks b
      JOIN documents d ON b.document_id = d.id
      WHERE d.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their block citations" ON block_citations
  FOR INSERT WITH CHECK (
    block_id IN (
      SELECT b.id FROM blocks b
      JOIN documents d ON b.document_id = d.id
      WHERE d.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their block citations" ON block_citations
  FOR UPDATE USING (
    block_id IN (
      SELECT b.id FROM blocks b
      JOIN documents d ON b.document_id = d.id
      WHERE d.user_id = auth.uid()
    )
  ) WITH CHECK (
    block_id IN (
      SELECT b.id FROM blocks b
      JOIN documents d ON b.document_id = d.id
      WHERE d.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their block citations" ON block_citations
  FOR DELETE USING (
    block_id IN (
      SELECT b.id FROM blocks b
      JOIN documents d ON b.document_id = d.id
      WHERE d.user_id = auth.uid()
    )
  );

-- Function to update document updated_at when blocks change
CREATE OR REPLACE FUNCTION update_document_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  -- Update blocks.updated_at for UPDATE operations
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  
  -- Update parent document timestamp
  UPDATE documents 
  SET updated_at = now() 
  WHERE id = (
    CASE 
      WHEN TG_OP = 'DELETE' THEN OLD.document_id
      ELSE NEW.document_id
    END
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to update document timestamp
DROP TRIGGER IF EXISTS update_document_on_block_change ON blocks;
CREATE TRIGGER update_document_on_block_change
  AFTER INSERT OR UPDATE OR DELETE ON blocks
  FOR EACH ROW EXECUTE FUNCTION update_document_timestamp();

-- Function to parse blocks from markdown content (for migration)
CREATE OR REPLACE FUNCTION parse_content_to_blocks(
  doc_id UUID,
  content TEXT
) RETURNS VOID AS $$
DECLARE
  lines TEXT[];
  line TEXT;
  current_position NUMERIC(8,4) := 0;
  block_content JSONB;
BEGIN
  -- Split content into lines
  lines := string_to_array(content, E'\n');
  
  FOREACH line IN ARRAY lines
  LOOP
    -- Skip empty lines
    IF trim(line) = '' THEN
      CONTINUE;
    END IF;
    
    -- Determine block type and create appropriate content
    IF line ~ '^#{1,6}\s+' THEN
      -- Heading
      block_content := jsonb_build_object(
        'type', 'heading',
        'attrs', jsonb_build_object(
          'level', length(regexp_replace(line, '^(#{1,6}).*', '\1'))
        ),
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'text',
            'text', trim(regexp_replace(line, '^#{1,6}\s+', ''))
          )
        )
      );
      
      INSERT INTO blocks (document_id, type, content, position)
      VALUES (doc_id, 'heading', block_content, current_position);
    ELSE
      -- Paragraph
      block_content := jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'text',
            'text', line
          )
        )
      );
      
      INSERT INTO blocks (document_id, type, content, position)
      VALUES (doc_id, 'paragraph', block_content, current_position);
    END IF;
    
    current_position := current_position + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Analyze tables for optimal query planning (especially important for vector index)
ANALYZE blocks;
ANALYZE documents;
ANALYZE block_citations; 