-- Migration: Add relevance feedback infrastructure
-- Tracks which chunks were actually cited in generated content
-- Enables citation-based boosting for improved retrieval

-- ============================================================================
-- 1. Create chunk_citation_log table
-- ============================================================================

CREATE TABLE IF NOT EXISTS chunk_citation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- The chunk that was cited
  chunk_id uuid NOT NULL REFERENCES paper_chunks(id) ON DELETE CASCADE,
  
  -- The paper the chunk belongs to
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  
  -- The project where this citation occurred
  project_id uuid NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  
  -- Section type where the chunk was used (methodology, results, etc.)
  section_type text,
  
  -- The topic/query context when this chunk was retrieved
  query_context text,
  
  -- Whether the chunk was actually used in a citation
  was_cited boolean DEFAULT true,
  
  -- Timestamp
  created_at timestamp with time zone DEFAULT now(),
  
  -- Prevent duplicate logs for same chunk/project/section
  UNIQUE(chunk_id, project_id, section_type)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_chunk_citation_log_chunk_id 
ON chunk_citation_log(chunk_id);

CREATE INDEX IF NOT EXISTS idx_chunk_citation_log_paper_id 
ON chunk_citation_log(paper_id);

CREATE INDEX IF NOT EXISTS idx_chunk_citation_log_project_id 
ON chunk_citation_log(project_id);

-- ============================================================================
-- 2. Create chunk_citation_stats materialized view
-- ============================================================================

-- Aggregated stats for fast lookup during search
CREATE MATERIALIZED VIEW IF NOT EXISTS chunk_citation_stats AS
SELECT 
  chunk_id,
  paper_id,
  COUNT(*) as total_citations,
  COUNT(DISTINCT project_id) as unique_projects,
  COUNT(DISTINCT section_type) as section_diversity,
  -- Recency bonus: recent citations weighted more
  SUM(
    CASE 
      WHEN created_at > NOW() - INTERVAL '7 days' THEN 1.0
      WHEN created_at > NOW() - INTERVAL '30 days' THEN 0.5
      ELSE 0.2
    END
  ) as recency_weighted_citations
FROM chunk_citation_log
WHERE was_cited = true
GROUP BY chunk_id, paper_id;

-- Index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_chunk_citation_stats_chunk 
ON chunk_citation_stats(chunk_id);

-- ============================================================================
-- 3. Create function to log chunk citations
-- ============================================================================

CREATE OR REPLACE FUNCTION log_chunk_citation(
  p_chunk_id uuid,
  p_paper_id uuid,
  p_project_id uuid,
  p_section_type text DEFAULT NULL,
  p_query_context text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO chunk_citation_log (chunk_id, paper_id, project_id, section_type, query_context, was_cited)
  VALUES (p_chunk_id, p_paper_id, p_project_id, p_section_type, p_query_context, true)
  ON CONFLICT (chunk_id, project_id, section_type) 
  DO UPDATE SET 
    was_cited = true,
    created_at = NOW();
END;
$$;

-- ============================================================================
-- 4. Create function to refresh citation stats
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_chunk_citation_stats()
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY chunk_citation_stats;
END;
$$;

-- ============================================================================
-- 5. Create hybrid search with citation boosting
-- ============================================================================

DROP FUNCTION IF EXISTS hybrid_search_chunks_with_boost(vector(384), text, int, float, uuid[], float, float);

CREATE OR REPLACE FUNCTION hybrid_search_chunks_with_boost(
  query_embedding vector(384),
  search_query text,
  match_count int DEFAULT 20,
  min_vector_score float DEFAULT 0.3,
  paper_ids uuid[] DEFAULT NULL,
  vector_weight float DEFAULT 0.7,
  citation_boost float DEFAULT 0.1  -- Max boost from citations (10% at max)
)
RETURNS TABLE(
  id uuid,
  paper_id uuid,
  content text,
  chunk_index int,
  vector_score float,
  keyword_score float,
  citation_boost_applied float,
  combined_score float
)
LANGUAGE sql STABLE AS $$
  WITH base_search AS (
    SELECT 
      h.id,
      h.paper_id,
      h.content,
      h.chunk_index,
      h.vector_score,
      h.keyword_score,
      h.combined_score as base_score
    FROM hybrid_search_chunks(
      query_embedding,
      search_query,
      match_count * 2,  -- Fetch extra to re-rank
      min_vector_score,
      paper_ids,
      vector_weight
    ) h
  ),
  boosted AS (
    SELECT 
      b.id,
      b.paper_id,
      b.content,
      b.chunk_index,
      b.vector_score,
      b.keyword_score,
      -- Calculate citation boost (0 to citation_boost)
      COALESCE(
        -- Log scale: many citations = diminishing returns
        -- 5 citations = ~50% of max boost, 20+ = ~100%
        citation_boost * (1 - 1.0 / (1 + LN(1 + COALESCE(s.total_citations, 0)))),
        0
      )::float as citation_boost_applied,
      -- Apply boost to base score
      b.base_score * (
        1 + COALESCE(
          citation_boost * (1 - 1.0 / (1 + LN(1 + COALESCE(s.total_citations, 0)))),
          0
        )
      ) as combined_score
    FROM base_search b
    LEFT JOIN chunk_citation_stats s ON b.id = s.chunk_id
  )
  SELECT 
    boosted.id,
    boosted.paper_id,
    boosted.content,
    boosted.chunk_index,
    boosted.vector_score,
    boosted.keyword_score,
    boosted.citation_boost_applied,
    boosted.combined_score
  FROM boosted
  ORDER BY boosted.combined_score DESC
  LIMIT match_count
$$;

COMMENT ON FUNCTION hybrid_search_chunks_with_boost IS 
  'Hybrid search with citation-based relevance boosting. Chunks that have been cited before get a configurable boost (default 10% max).';

-- ============================================================================
-- 6. RLS Policies
-- ============================================================================

ALTER TABLE chunk_citation_log ENABLE ROW LEVEL SECURITY;

-- Users can only see citation logs for their own projects
CREATE POLICY "Users can view their project citation logs"
ON chunk_citation_log
FOR SELECT
USING (
  project_id IN (
    SELECT id FROM research_projects WHERE user_id = auth.uid()
  )
);

-- Users can only insert logs for their own projects
CREATE POLICY "Users can insert citation logs for their projects"
ON chunk_citation_log
FOR INSERT
WITH CHECK (
  project_id IN (
    SELECT id FROM research_projects WHERE user_id = auth.uid()
  )
);

COMMENT ON TABLE chunk_citation_log IS 
  'Tracks which chunks were cited in generated papers. Used for relevance feedback to improve future retrieval.';
