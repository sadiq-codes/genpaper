-- Add library boost to match_paper_chunks
-- Papers in a user's library get a score boost in global search results,
-- making the library a relevance signal for autocomplete.

DROP FUNCTION IF EXISTS match_paper_chunks(vector(384), int, float, uuid[]);

CREATE OR REPLACE FUNCTION match_paper_chunks(
  query_embedding vector(384),
  match_count int,
  min_score float DEFAULT 0.3,
  paper_ids uuid[] DEFAULT NULL,
  boosted_paper_ids uuid[] DEFAULT NULL,
  boost_factor float DEFAULT 1.15
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
    CASE
      WHEN boosted_paper_ids IS NOT NULL AND c.paper_id = ANY(boosted_paper_ids)
      THEN LEAST(1.0, (1 - (c.embedding <=> query_embedding)) * boost_factor)
      ELSE 1 - (c.embedding <=> query_embedding)
    END AS score
  FROM paper_chunks c
  WHERE c.embedding IS NOT NULL
    AND (paper_ids IS NULL OR c.paper_id = ANY(paper_ids))
    AND 1 - (c.embedding <=> query_embedding) >= min_score
  ORDER BY
    CASE
      WHEN boosted_paper_ids IS NOT NULL AND c.paper_id = ANY(boosted_paper_ids)
      THEN (c.embedding <=> query_embedding) / boost_factor
      ELSE c.embedding <=> query_embedding
    END
  LIMIT GREATEST(1, match_count)
$$;

COMMENT ON FUNCTION match_paper_chunks IS 'Semantic search over paper chunks with optional paper_id filtering and library boost for RAG retrieval';
