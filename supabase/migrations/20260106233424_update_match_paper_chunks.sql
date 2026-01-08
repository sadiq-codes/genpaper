-- Update match_paper_chunks to support filtering by paper_ids
-- This enables scoped RAG retrieval for editor completions

DROP FUNCTION IF EXISTS match_paper_chunks(vector(384), int, float);
DROP FUNCTION IF EXISTS match_paper_chunks(vector(384), int, float, uuid[]);

CREATE OR REPLACE FUNCTION match_paper_chunks(
  query_embedding vector(384),
  match_count int,
  min_score float DEFAULT 0.3,
  paper_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  paper_id uuid,
  content text,
  chunk_index int,
  score float
)
LANGUAGE sql STABLE AS $$
  SELECT 
    c.id,
    c.paper_id,
    c.content,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding) AS score
  FROM paper_chunks c
  WHERE c.embedding IS NOT NULL
    AND (paper_ids IS NULL OR c.paper_id = ANY(paper_ids))
    AND 1 - (c.embedding <=> query_embedding) >= min_score
  ORDER BY c.embedding <=> query_embedding
  LIMIT GREATEST(1, match_count)
$$;

-- Add index for paper_id filtering if not exists
CREATE INDEX IF NOT EXISTS idx_paper_chunks_paper_id ON paper_chunks(paper_id);

COMMENT ON FUNCTION match_paper_chunks IS 'Semantic search over paper chunks with optional paper_id filtering for RAG retrieval';
