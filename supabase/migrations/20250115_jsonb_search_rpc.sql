-- Migration: JSONB Configuration RPC Functions
-- Replace hardcoded search parameters with flexible JSONB configuration

-- Step 1: Create constraint for JSONB size limit (security)
CREATE OR REPLACE FUNCTION validate_search_config(config jsonb)
RETURNS boolean AS $$
BEGIN
  -- Check JSON size limit (2KB max)
  IF length(config::text) > 2048 THEN
    RAISE EXCEPTION 'Search configuration too large. Maximum 2KB allowed.';
  END IF;
  
  -- Validate structure and required fields
  IF NOT (config ? 'query') THEN
    RAISE EXCEPTION 'Search configuration must include "query" field.';
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 2: Enhanced hybrid search with JSONB configuration
CREATE OR REPLACE FUNCTION hybrid_search_papers(search_config jsonb)
RETURNS TABLE(
  paper_id uuid,
  semantic_score real,
  keyword_score real,
  combined_score real,
  title text,
  abstract text,
  venue text,
  publication_date date,
  doi text,
  citation_count integer
) AS $$
DECLARE
  query_text text;
  search_limit integer := 20;
  semantic_weight real := 0.7;
  min_year integer;
  max_year integer;
  source_filter text[];
  exclude_ids uuid[] := '{}';
BEGIN
  -- Validate configuration
  PERFORM validate_search_config(search_config);
  
  -- Extract parameters from JSONB config
  query_text := search_config->>'query';
  search_limit := COALESCE((search_config->>'limit')::integer, 20);
  semantic_weight := COALESCE((search_config->>'semanticWeight')::real, 0.7);
  min_year := (search_config->>'minYear')::integer;
  max_year := (search_config->>'maxYear')::integer;
  exclude_ids := COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(search_config->'excludePaperIds'))::uuid[], 
    '{}'
  );
  source_filter := CASE 
    WHEN search_config ? 'sources' THEN 
      ARRAY(SELECT jsonb_array_elements_text(search_config->'sources'))
    ELSE NULL
  END;
  
  -- Clamp limits for security
  search_limit     := LEAST(search_limit, 100);
  semantic_weight  := GREATEST(0.0, LEAST(1.0, semantic_weight));

  ------------------------------------------------------------------------
  -- final query ----------------------------------------------------------
  ------------------------------------------------------------------------
  RETURN QUERY
  WITH semantic_results AS (
        SELECT p.id
             , 0.5 AS sim_score             -- ← placeholder
        FROM   papers p
        WHERE  p.id <> ALL (exclude_ids)
          AND (min_year IS NULL OR EXTRACT(YEAR FROM p.publication_date) >= min_year)
          AND (max_year IS NULL OR EXTRACT(YEAR FROM p.publication_date) <= max_year)
          AND (source_filter IS NULL OR p.source = ANY (source_filter))
          AND to_tsvector('english', p.title || ' ' || COALESCE(p.abstract, ''))
              @@ plainto_tsquery('english', query_text)
        LIMIT  search_limit * 2
  ),
  keyword_results AS (
        SELECT p.id
             , ts_rank_cd(
                 to_tsvector('english', p.title || ' ' || COALESCE(p.abstract, '')),
                 plainto_tsquery('english', query_text)
               ) AS rank_score
        FROM   papers p
        WHERE  p.id <> ALL (exclude_ids)
          AND (min_year IS NULL OR EXTRACT(YEAR FROM p.publication_date) >= min_year)
          AND (max_year IS NULL OR EXTRACT(YEAR FROM p.publication_date) <= max_year)
          AND (source_filter IS NULL OR p.source = ANY (source_filter))
          AND to_tsvector('english', p.title || ' ' || COALESCE(p.abstract, ''))
              @@ plainto_tsquery('english', query_text)
        ORDER  BY rank_score DESC
        LIMIT  search_limit * 2
  )
  SELECT p.id::uuid,
         COALESCE(s.sim_score, 0)::real                AS semantic_score,
         COALESCE(k.rank_score, 0)::real               AS keyword_score,
         (COALESCE(s.sim_score, 0)*semantic_weight
          + COALESCE(k.rank_score, 0)*(1-semantic_weight))::real
                                                     AS combined_score,
         p.title,
         p.abstract,
         p.venue,
         p.publication_date,
         p.doi,
         p.citation_count
  FROM   papers p
  LEFT   JOIN semantic_results s ON p.id = s.id
  LEFT   JOIN keyword_results  k ON p.id = k.id
  WHERE  s.id IS NOT NULL OR k.id IS NOT NULL
  ORDER  BY combined_score DESC
  LIMIT  search_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;