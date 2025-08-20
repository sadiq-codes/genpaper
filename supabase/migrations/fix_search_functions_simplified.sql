-- Fix search functions to work with simplified schema
-- Removes dependency on search_vector column which was removed in schema rewrite

-- Use CASCADE to force drop all function versions and dependencies
DO $$ 
DECLARE
    func_record RECORD;
BEGIN
    -- Drop all hybrid_search_papers functions regardless of signature
    FOR func_record IN 
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc 
        WHERE proname = 'hybrid_search_papers' 
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    LOOP
        EXECUTE 'DROP FUNCTION ' || func_record.func_signature || ' CASCADE';
    END LOOP;
    
    -- Drop all find_similar_papers functions
    FOR func_record IN 
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc 
        WHERE proname = 'find_similar_papers' 
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    LOOP
        EXECUTE 'DROP FUNCTION ' || func_record.func_signature || ' CASCADE';
    END LOOP;
    
    -- Drop all match_papers functions
    FOR func_record IN 
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc 
        WHERE proname = 'match_papers' 
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    LOOP
        EXECUTE 'DROP FUNCTION ' || func_record.func_signature || ' CASCADE';
    END LOOP;
    
    -- Drop search_papers_hybrid if it exists
    FOR func_record IN 
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc 
        WHERE proname = 'search_papers_hybrid' 
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    LOOP
        EXECUTE 'DROP FUNCTION ' || func_record.func_signature || ' CASCADE';
    END LOOP;
END $$;

-- Create simplified hybrid search function (semantic search only)
-- Since we removed search_vector, this will focus on semantic similarity
CREATE OR REPLACE FUNCTION public.hybrid_search_papers(
  query_text text,
  query_embedding vector(384),
  match_count integer default 25,
  min_year integer default 1900,
  semantic_weight real default 0.7
)
RETURNS TABLE (
  paper_id uuid,
  semantic_score float,
  keyword_score float,
  combined_score float
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
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
    -- Use simple text search since search_vector column was removed
    SELECT 
      p.id AS paper_id,
      CASE 
        WHEN (p.title ILIKE '%' || query_text || '%' OR p.abstract ILIKE '%' || query_text || '%') 
        THEN 0.5 
        ELSE 0.0 
      END AS keyword_score
    FROM papers p, tsquery t
    WHERE (p.title ILIKE '%' || query_text || '%' OR p.abstract ILIKE '%' || query_text || '%')
      AND publication_date >= make_date(min_year, 1, 1)
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
  ORDER BY combined_score DESC NULLS LAST
  LIMIT match_count;
$$;

-- Create simplified find_similar_papers function
CREATE OR REPLACE FUNCTION public.find_similar_papers(
  query_embedding vector(384),
  exclude_paper_id uuid,
  match_count integer default 5
)
RETURNS TABLE (
  paper_id uuid,
  score float
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT 
    id AS paper_id,
    1 - (embedding <=> query_embedding) AS score
  FROM papers
  WHERE id != exclude_paper_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Create simplified match_papers function
CREATE OR REPLACE FUNCTION public.match_papers(
  query_embedding vector(384),
  match_count integer default 8,
  min_year integer default 1900
)
RETURNS TABLE (
  paper_id uuid,
  score float
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT 
    id AS paper_id,
    1 - (embedding <=> query_embedding) AS score
  FROM papers
  WHERE publication_date >= make_date(min_year, 1, 1)
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT GREATEST(1, match_count);
$$;

-- Grant RPC access to authenticated users
GRANT EXECUTE ON FUNCTION public.hybrid_search_papers TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_similar_papers TO authenticated;  
GRANT EXECUTE ON FUNCTION public.match_papers TO authenticated;
