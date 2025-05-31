-- Enhanced schema for SaaS-grade AI research workspace
-- Following the proposed architecture for chunk-based streaming and function-calling citations

-- Keep existing projects table, just clean it up
ALTER TABLE projects DROP COLUMN IF EXISTS content; -- Remove monolithic content
ALTER TABLE projects DROP COLUMN IF EXISTS citations_identified; -- Remove string array

-- Paper chunks for streaming deltas
CREATE TABLE paper_chunks (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, seq)
);

-- Materialized view for full paper content
CREATE VIEW paper_full AS
SELECT 
  project_id, 
  STRING_AGG(text, '' ORDER BY seq) AS content,
  COUNT(*) AS chunk_count,
  MAX(created_at) AS last_updated
FROM paper_chunks 
GROUP BY project_id;

-- Enhanced citations table with CSL JSON
DROP TABLE IF EXISTS citations CASCADE;
CREATE TABLE citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL, -- DOI or hashed title+year for deduplication
  data JSONB NOT NULL, -- CSL JSON format
  source_type TEXT DEFAULT 'article',
  enriched BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, key)
);

-- Citation links for positional references
DROP TABLE IF EXISTS citation_links CASCADE;
CREATE TABLE citation_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  citation_id UUID REFERENCES citations(id) ON DELETE CASCADE,
  section TEXT,
  start_pos INTEGER,
  end_pos INTEGER,
  reason TEXT, -- Why this citation was added
  context TEXT, -- Surrounding text context
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Materialized view for citations with links (for UI queries)
CREATE VIEW citations_with_links AS
SELECT 
  c.*,
  JSON_AGG(
    JSON_BUILD_OBJECT(
      'id', cl.id,
      'section', cl.section,
      'start_pos', cl.start_pos,
      'end_pos', cl.end_pos,
      'reason', cl.reason,
      'context', cl.context
    ) ORDER BY cl.created_at
  ) FILTER (WHERE cl.id IS NOT NULL) AS links
FROM citations c
LEFT JOIN citation_links cl ON c.id = cl.citation_id
GROUP BY c.id, c.project_id, c.key, c.data, c.source_type, c.enriched, c.created_at, c.updated_at;

-- Indexes for performance
CREATE INDEX idx_paper_chunks_project_seq ON paper_chunks(project_id, seq);
CREATE INDEX idx_citations_project ON citations(project_id);
CREATE INDEX idx_citations_key ON citations(key);
CREATE INDEX idx_citation_links_project ON citation_links(project_id);
CREATE INDEX idx_citation_links_citation ON citation_links(citation_id);

-- RLS Policies
ALTER TABLE paper_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE citation_links ENABLE ROW LEVEL SECURITY;

-- Helper function to get user_id from project_id
CREATE OR REPLACE FUNCTION get_project_user_id(project_uuid UUID)
RETURNS UUID AS $$
  SELECT user_id FROM projects WHERE id = project_uuid;
$$ LANGUAGE SQL SECURITY DEFINER;

-- RLS policies for paper_chunks
CREATE POLICY "Users can view own paper chunks" ON paper_chunks
  FOR SELECT USING (get_project_user_id(project_id) = auth.uid());

CREATE POLICY "Users can insert own paper chunks" ON paper_chunks
  FOR INSERT WITH CHECK (get_project_user_id(project_id) = auth.uid());

CREATE POLICY "Users can update own paper chunks" ON paper_chunks
  FOR UPDATE USING (get_project_user_id(project_id) = auth.uid());

CREATE POLICY "Users can delete own paper chunks" ON paper_chunks
  FOR DELETE USING (get_project_user_id(project_id) = auth.uid());

-- RLS policies for citations
CREATE POLICY "Users can view own citations" ON citations
  FOR SELECT USING (get_project_user_id(project_id) = auth.uid());

CREATE POLICY "Users can insert own citations" ON citations
  FOR INSERT WITH CHECK (get_project_user_id(project_id) = auth.uid());

CREATE POLICY "Users can update own citations" ON citations
  FOR UPDATE USING (get_project_user_id(project_id) = auth.uid());

CREATE POLICY "Users can delete own citations" ON citations
  FOR DELETE USING (get_project_user_id(project_id) = auth.uid());

-- RLS policies for citation_links
CREATE POLICY "Users can view own citation links" ON citation_links
  FOR SELECT USING (get_project_user_id(project_id) = auth.uid());

CREATE POLICY "Users can insert own citation links" ON citation_links
  FOR INSERT WITH CHECK (get_project_user_id(project_id) = auth.uid());

CREATE POLICY "Users can update own citation links" ON citation_links
  FOR UPDATE USING (get_project_user_id(project_id) = auth.uid());

CREATE POLICY "Users can delete own citation links" ON citation_links
  FOR DELETE USING (get_project_user_id(project_id) = auth.uid());

-- Utility functions for chunk management
CREATE OR REPLACE FUNCTION append_paper_chunk(
  p_project_id UUID,
  p_text TEXT
) RETURNS INTEGER AS $$
DECLARE
  next_seq INTEGER;
BEGIN
  -- Get next sequence number
  SELECT COALESCE(MAX(seq), 0) + 1 INTO next_seq
  FROM paper_chunks
  WHERE project_id = p_project_id;
  
  -- Insert new chunk
  INSERT INTO paper_chunks (project_id, seq, text)
  VALUES (p_project_id, next_seq, p_text);
  
  RETURN next_seq;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for upserting citations (used by function calling)
CREATE OR REPLACE FUNCTION upsert_citation(
  p_project_id UUID,
  p_key TEXT,
  p_data JSONB
) RETURNS citations AS $$
DECLARE
  citation_record citations;
BEGIN
  INSERT INTO citations (project_id, key, data)
  VALUES (p_project_id, p_key, p_data)
  ON CONFLICT (project_id, key) 
  DO UPDATE SET 
    data = EXCLUDED.data,
    updated_at = NOW()
  RETURNING * INTO citation_record;
  
  RETURN citation_record;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Triggers for real-time updates
CREATE OR REPLACE FUNCTION notify_paper_update() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('paper_updated', json_build_object(
    'project_id', COALESCE(NEW.project_id, OLD.project_id),
    'action', TG_OP
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_citation_update() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('citations_updated', json_build_object(
    'project_id', COALESCE(NEW.project_id, OLD.project_id),
    'action', TG_OP
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER paper_chunks_notify 
  AFTER INSERT OR UPDATE OR DELETE ON paper_chunks
  FOR EACH ROW EXECUTE FUNCTION notify_paper_update();

CREATE TRIGGER citations_notify 
  AFTER INSERT OR UPDATE OR DELETE ON citations
  FOR EACH ROW EXECUTE FUNCTION notify_citation_update();

CREATE TRIGGER citation_links_notify 
  AFTER INSERT OR UPDATE OR DELETE ON citation_links
  FOR EACH ROW EXECUTE FUNCTION notify_citation_update(); 