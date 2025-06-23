-- Fix match_paper_chunks function to properly filter by paper IDs
-- This resolves the bug where chunks from unrelated papers were being returned

-- Drop existing function variants to avoid signature conflicts
DROP FUNCTION IF EXISTS match_paper_chunks(vector, int, float);
DROP FUNCTION IF EXISTS match_paper_chunks(vector(384), int, float);

CREATE OR REPLACE FUNCTION match_paper_chunks(
  query_embedding vector(384),
  match_count int DEFAULT 10,
  min_score float DEFAULT 0.5,
  paper_ids uuid[] DEFAULT NULL  -- NEW: Optional filter for specific paper IDs
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
  WHERE pc.embedding IS NOT NULL
  AND 1 - (pc.embedding <=> query_embedding) >= min_score
  AND (paper_ids IS NULL OR pc.paper_id = ANY(paper_ids))  -- NEW: Filter by paper IDs when provided
  ORDER BY pc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION match_paper_chunks TO authenticated, anon, service_role;

COMMENT ON FUNCTION match_paper_chunks IS 'Find semantically similar paper chunks, optionally filtered by specific paper IDs'; 