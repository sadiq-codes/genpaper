-- Migration: Add hybrid search capabilities to paper_chunks
-- This adds full-text search (BM25-style) alongside existing vector search
-- Enables hybrid retrieval combining semantic + lexical matching

-- ============================================================================
-- 1. Add tsvector column for full-text search
-- ============================================================================

-- Add tsvector column (populated automatically via trigger)
ALTER TABLE paper_chunks 
ADD COLUMN IF NOT EXISTS content_tsv tsvector;

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_paper_chunks_content_tsv 
ON paper_chunks USING GIN(content_tsv);

-- ============================================================================
-- 2. Populate tsvector for existing rows
-- ============================================================================

-- Backfill existing chunks with tsvector
-- Using 'english' config for stemming and stop word removal
UPDATE paper_chunks 
SET content_tsv = to_tsvector('english', content)
WHERE content_tsv IS NULL;

-- ============================================================================
-- 3. Create trigger to auto-update tsvector on insert/update
-- ============================================================================

CREATE OR REPLACE FUNCTION paper_chunks_update_tsv()
RETURNS TRIGGER AS $$
BEGIN
  NEW.content_tsv := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS paper_chunks_tsv_trigger ON paper_chunks;

CREATE TRIGGER paper_chunks_tsv_trigger
BEFORE INSERT OR UPDATE OF content ON paper_chunks
FOR EACH ROW
EXECUTE FUNCTION paper_chunks_update_tsv();

-- ============================================================================
-- 4. Create keyword search RPC function
-- ============================================================================

-- Drop existing if any
DROP FUNCTION IF EXISTS keyword_search_chunks(text, int, uuid[]);

CREATE OR REPLACE FUNCTION keyword_search_chunks(
  search_query text,
  match_count int DEFAULT 20,
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
    -- ts_rank returns a relevance score based on term frequency
    ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', search_query), 32)::float AS score
  FROM paper_chunks c
  WHERE c.content_tsv @@ websearch_to_tsquery('english', search_query)
    AND (paper_ids IS NULL OR c.paper_id = ANY(paper_ids))
  ORDER BY score DESC
  LIMIT GREATEST(1, match_count)
$$;

COMMENT ON FUNCTION keyword_search_chunks IS 
  'Full-text keyword search over paper chunks using PostgreSQL ts_vector. Use with websearch syntax (AND/OR/-).';

-- ============================================================================
-- 5. Create hybrid search RPC that combines vector + keyword
-- ============================================================================

DROP FUNCTION IF EXISTS hybrid_search_chunks(vector(384), text, int, float, uuid[], float);

CREATE OR REPLACE FUNCTION hybrid_search_chunks(
  query_embedding vector(384),
  search_query text,
  match_count int DEFAULT 20,
  min_vector_score float DEFAULT 0.3,
  paper_ids uuid[] DEFAULT NULL,
  vector_weight float DEFAULT 0.7  -- Weight for vector vs keyword (0.7 = 70% vector, 30% keyword)
)
RETURNS TABLE(
  id uuid,
  paper_id uuid,
  content text,
  chunk_index int,
  vector_score float,
  keyword_score float,
  combined_score float
)
LANGUAGE sql STABLE AS $$
  WITH vector_results AS (
    SELECT 
      c.id,
      c.paper_id,
      c.content,
      c.chunk_index,
      1 - (c.embedding <=> query_embedding) AS score,
      ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS rank
    FROM paper_chunks c
    WHERE c.embedding IS NOT NULL
      AND (paper_ids IS NULL OR c.paper_id = ANY(paper_ids))
      AND 1 - (c.embedding <=> query_embedding) >= min_vector_score
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  keyword_results AS (
    SELECT 
      c.id,
      c.paper_id,
      c.content,
      c.chunk_index,
      ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', search_query), 32)::float AS score,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', search_query), 32) DESC) AS rank
    FROM paper_chunks c
    WHERE c.content_tsv @@ websearch_to_tsquery('english', search_query)
      AND (paper_ids IS NULL OR c.paper_id = ANY(paper_ids))
    ORDER BY score DESC
    LIMIT match_count * 2
  ),
  -- Reciprocal Rank Fusion (RRF) with k=60
  combined AS (
    SELECT 
      COALESCE(v.id, k.id) AS id,
      COALESCE(v.paper_id, k.paper_id) AS paper_id,
      COALESCE(v.content, k.content) AS content,
      COALESCE(v.chunk_index, k.chunk_index) AS chunk_index,
      COALESCE(v.score, 0) AS vector_score,
      COALESCE(k.score, 0) AS keyword_score,
      -- RRF formula: 1/(k+rank) for each result set, then combine
      (
        COALESCE(1.0 / (60 + v.rank), 0) * vector_weight +
        COALESCE(1.0 / (60 + k.rank), 0) * (1 - vector_weight)
      ) AS rrf_score
    FROM vector_results v
    FULL OUTER JOIN keyword_results k ON v.id = k.id
  )
  SELECT 
    combined.id,
    combined.paper_id,
    combined.content,
    combined.chunk_index,
    combined.vector_score,
    combined.keyword_score,
    combined.rrf_score AS combined_score
  FROM combined
  ORDER BY combined.rrf_score DESC
  LIMIT match_count
$$;

COMMENT ON FUNCTION hybrid_search_chunks IS 
  'Hybrid search combining vector similarity and keyword matching using Reciprocal Rank Fusion (RRF). Vector weight controls balance (default 0.7 = 70% vector).';

-- ============================================================================
-- 6. Add metadata column for chunk enrichment (Phase 1 prep)
-- ============================================================================

-- Add metadata JSONB column if not exists (for section_type, has_citations, etc.)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'paper_chunks' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE paper_chunks ADD COLUMN metadata jsonb DEFAULT '{}';
  END IF;
END $$;

-- Create index for metadata queries
CREATE INDEX IF NOT EXISTS idx_paper_chunks_metadata 
ON paper_chunks USING GIN(metadata);

COMMENT ON COLUMN paper_chunks.metadata IS 
  'Chunk metadata: section_type, has_citations, has_figures, entity_types, etc.';
