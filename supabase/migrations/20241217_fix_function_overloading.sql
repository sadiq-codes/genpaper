-- Fix function overloading conflict for hybrid_search_papers
-- Drop the old function signature to resolve the conflict

-- Drop the old hybrid_search_papers function with different parameter order
DROP FUNCTION IF EXISTS hybrid_search_papers(
  query_embedding vector,
  query_text text,
  match_count int,
  min_year int,
  semantic_weight float
);

-- Ensure we only have the correct function signature
-- This should already exist from 004_fix_vector_dimensions.sql
CREATE OR REPLACE FUNCTION hybrid_search_papers(
  query_text text,
  query_embedding vector(384),
  match_count int DEFAULT 10,
  min_year int DEFAULT 2018,
  semantic_weight float DEFAULT 0.7
)
RETURNS TABLE (
  paper_id uuid,
  semantic_score float,
  keyword_score float,
  combined_score float
)
LANGUAGE sql STABLE
AS $$
  WITH tsquery AS (
    SELECT plainto_tsquery('english', query_text) AS q
  ),
  semantic_results AS (
    SELECT 
      id AS paper_id,
      1 - (embedding <=> query_embedding) AS semantic_score
    FROM papers
    WHERE publication_date >= make_date(min_year, 1, 1)
      AND embedding IS NOT NULL
    ORDER BY embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  keyword_results AS (
    SELECT 
      p.id AS paper_id,
      ts_rank_cd(p.search_vector, t.q) AS keyword_score
    FROM papers p, tsquery t
    WHERE p.search_vector @@ t.q
      AND publication_date >= make_date(min_year, 1, 1)
    ORDER BY ts_rank_cd(p.search_vector, t.q) DESC
    LIMIT match_count * 2
  )
  SELECT 
    COALESCE(s.paper_id, k.paper_id) AS paper_id,
    COALESCE(s.semantic_score, 0.0) AS semantic_score,
    COALESCE(k.keyword_score, 0.0) AS keyword_score,
    (COALESCE(s.semantic_score, 0.0) * semantic_weight + 
     COALESCE(k.keyword_score, 0.0) * (1 - semantic_weight)) AS combined_score
  FROM semantic_results s
  FULL OUTER JOIN keyword_results k ON s.paper_id = k.paper_id
  ORDER BY combined_score DESC
  LIMIT match_count;
$$;

-- Also ensure we have the find_similar_papers function with proper vector dimensions
CREATE OR REPLACE FUNCTION find_similar_papers(
  query_embedding vector(384),
  exclude_paper_id uuid,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  paper_id uuid,
  score float
)
LANGUAGE sql STABLE
AS $$
  SELECT 
    p.id,
    1 - (p.embedding <=> query_embedding) AS score
  FROM papers p
  WHERE p.id != exclude_paper_id
    AND p.embedding IS NOT NULL
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Comment documenting the fix
COMMENT ON FUNCTION hybrid_search_papers(text, vector, int, int, float) IS 
'Fixed function overloading conflict by standardizing parameter order: query_text, query_embedding, match_count, min_year, semantic_weight'; 