/* ───────────────────────────────
   TASK 2: Optimize Vector Index (one-off migration)
   ─────────────────────────────── */

-- ✅ Ensure vector extension is enabled (Supabase-compatible)
CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;

-- ✅ Set inline storage for vector column to reduce TOAST overhead
ALTER TABLE papers
  ALTER COLUMN embedding SET STORAGE PLAIN;

-- ✅ Create cosine similarity index using ivfflat
-- Note: Run ANALYZE after populating data for this to work efficiently
CREATE INDEX IF NOT EXISTS papers_embedding_idx
ON papers USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- ✅ Create GIN index for keyword search fallback
CREATE INDEX IF NOT EXISTS papers_search_idx
ON papers USING GIN (search_vector);

-- ✅ RPC function to optimize vector index performance
CREATE OR REPLACE FUNCTION analyze_papers_table()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  ANALYZE papers;
  ANALYZE paper_chunks;
$$;

/* ───────────────────────────────
   TASK 3: Similarity Search RPC (edge-friendly)
   ─────────────────────────────── */

-- Basic vector similarity search
CREATE OR REPLACE FUNCTION match_papers(
  query_embedding vector,
  match_count int DEFAULT 8,
  min_year int DEFAULT 2018
)
RETURNS TABLE (
  paper_id uuid,
  score float
) LANGUAGE sql STABLE AS $$
  SELECT id, 1 - (embedding <=> query_embedding) AS score
  FROM papers
  WHERE publication_date >= make_date(min_year, 1, 1)
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT GREATEST(1, match_count);
$$;

-- Combined semantic + keyword search
CREATE OR REPLACE FUNCTION hybrid_search_papers(
  query_embedding vector,
  query_text text,
  match_count int DEFAULT 8,
  min_year int DEFAULT 2018,
  semantic_weight float DEFAULT 0.7
)
RETURNS TABLE (
  paper_id uuid,
  semantic_score float,
  keyword_score float,
  combined_score float
) LANGUAGE sql STABLE AS $$
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

-- Find nearest neighbors to a given paper
CREATE OR REPLACE FUNCTION find_similar_papers(
  source_paper_id uuid,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  paper_id uuid,
  score float
) LANGUAGE sql STABLE AS $$
  SELECT 
    p.id,
    1 - (p.embedding <=> s.embedding) AS score
  FROM papers p,
  LATERAL (SELECT embedding FROM papers WHERE id = source_paper_id) s
  WHERE p.id != source_paper_id
    AND p.embedding IS NOT NULL
    AND s.embedding IS NOT NULL
  ORDER BY p.embedding <=> s.embedding
  LIMIT match_count;
$$;

/* ───────────────────────────────
   TASK 4: Permissions & Performance
   ─────────────────────────────── */

-- Allow RPC access to authenticated users
GRANT EXECUTE ON FUNCTION match_papers TO authenticated;
GRANT EXECUTE ON FUNCTION hybrid_search_papers TO authenticated;
GRANT EXECUTE ON FUNCTION find_similar_papers TO authenticated;

-- Refresh planner stats for ivfflat to work efficiently
ANALYZE papers;
