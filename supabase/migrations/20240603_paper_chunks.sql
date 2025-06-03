-- Create paper_chunks table for storing chunked content with embeddings
CREATE TABLE IF NOT EXISTS paper_chunks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  paper_id uuid REFERENCES papers(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding vector(384), -- OpenAI text-embedding-3-small with 384 dimensions
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(paper_id, chunk_index)
);

-- Create index for similarity search on chunks
CREATE INDEX IF NOT EXISTS paper_chunks_embedding_idx 
ON paper_chunks 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create index for paper_id lookups
CREATE INDEX IF NOT EXISTS paper_chunks_paper_id_idx 
ON paper_chunks(paper_id);

-- RPC function to search paper chunks by similarity
CREATE OR REPLACE FUNCTION match_paper_chunks(
  query_embedding vector(384),
  match_count int DEFAULT 10,
  min_score float DEFAULT 0.5
)
RETURNS TABLE (
  paper_id uuid,
  chunk_index int,
  content text,
  score float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    pc.paper_id,
    pc.chunk_index,
    pc.content,
    1 - (pc.embedding <=> query_embedding) as score
  FROM paper_chunks pc
  WHERE 1 - (pc.embedding <=> query_embedding) >= min_score
  ORDER BY pc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- RPC function to get chunks for specific papers
CREATE OR REPLACE FUNCTION get_paper_chunks(
  paper_ids uuid[],
  match_count int DEFAULT 10
)
RETURNS TABLE (
  paper_id uuid,
  chunk_index int,
  content text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    pc.paper_id,
    pc.chunk_index,
    pc.content
  FROM paper_chunks pc
  WHERE pc.paper_id = ANY(paper_ids)
  ORDER BY pc.paper_id, pc.chunk_index
  LIMIT match_count;
$$;

-- Enable RLS on paper_chunks
ALTER TABLE paper_chunks ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can read all chunks (for research generation)
CREATE POLICY "Allow read access to all paper chunks" 
ON paper_chunks FOR SELECT 
TO authenticated 
USING (true);

-- RLS policy: Users can manage chunks for papers they can manage
CREATE POLICY "Users can manage chunks for their papers" 
ON paper_chunks FOR ALL 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM papers p 
    WHERE p.id = paper_chunks.paper_id
  )
);

-- Grant necessary permissions
GRANT SELECT ON paper_chunks TO authenticated;
GRANT INSERT, UPDATE, DELETE ON paper_chunks TO authenticated; 