-- Fix vector dimension consistency across all tables
-- This migration ensures all embedding columns are 384 dimensions

-- Check current state and fix paper_chunks if needed
DO $$
DECLARE
    chunk_dim_count INTEGER;
BEGIN
    -- Check current dimensions of paper_chunks.embedding column
    SELECT atttypmod 
    INTO chunk_dim_count
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    WHERE c.relname = 'paper_chunks' 
    AND a.attname = 'embedding'
    AND a.atttypid = (SELECT oid FROM pg_type WHERE typname = 'vector');
    
    -- If it exists and is not 384, alter it
    IF chunk_dim_count IS NOT NULL AND chunk_dim_count != 384 THEN
        RAISE NOTICE 'Fixing paper_chunks.embedding from % to 384 dimensions', chunk_dim_count;
        
        -- Drop existing index
        DROP INDEX IF EXISTS paper_chunks_embedding_idx;
        
        -- Alter column type (this will truncate or pad existing vectors)
        ALTER TABLE paper_chunks 
        ALTER COLUMN embedding TYPE vector(384);
        
        -- Recreate index
        CREATE INDEX paper_chunks_embedding_idx 
        ON paper_chunks 
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
        
    ELSIF chunk_dim_count IS NULL THEN
        RAISE NOTICE 'paper_chunks.embedding column does not exist yet - will be created correctly';
    ELSE
        RAISE NOTICE 'paper_chunks.embedding is already 384 dimensions';
    END IF;
END $$;

-- Ensure all RPC functions use the correct vector dimensions
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
  WHERE pc.embedding IS NOT NULL
  AND 1 - (pc.embedding <=> query_embedding) >= min_score
  ORDER BY pc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Update match_papers function to ensure consistent 384 dimensions
CREATE OR REPLACE FUNCTION match_papers(
  query_embedding vector(384),
  match_count int DEFAULT 8,
  min_year int DEFAULT 2018
)
RETURNS TABLE (
  paper_id uuid,
  score float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id as paper_id,
    1 - (p.embedding <=> query_embedding) as score
  FROM papers p
  WHERE p.embedding IS NOT NULL
  AND (min_year IS NULL OR EXTRACT(YEAR FROM p.publication_date) >= min_year)
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Update hybrid search function for 384 dimensions
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
  WITH semantic_search AS (
    SELECT 
      p.id as paper_id,
      1 - (p.embedding <=> query_embedding) as semantic_score
    FROM papers p
    WHERE p.embedding IS NOT NULL
    AND (min_year IS NULL OR EXTRACT(YEAR FROM p.publication_date) >= min_year)
  ),
  keyword_search AS (
    SELECT 
      p.id as paper_id,
      ts_rank_cd(p.search_vector, plainto_tsquery('english', query_text)) as keyword_score
    FROM papers p
    WHERE p.search_vector @@ plainto_tsquery('english', query_text)
    AND (min_year IS NULL OR EXTRACT(YEAR FROM p.publication_date) >= min_year)
  )
  SELECT 
    COALESCE(s.paper_id, k.paper_id) as paper_id,
    COALESCE(s.semantic_score, 0) as semantic_score,
    COALESCE(k.keyword_score, 0) as keyword_score,
    (semantic_weight * COALESCE(s.semantic_score, 0) + 
     (1 - semantic_weight) * COALESCE(k.keyword_score, 0)) as combined_score
  FROM semantic_search s
  FULL OUTER JOIN keyword_search k ON s.paper_id = k.paper_id
  ORDER BY combined_score DESC
  LIMIT match_count;
$$;

-- Update find_similar_papers function for 384 dimensions  
CREATE OR REPLACE FUNCTION find_similar_papers(
  source_paper_id uuid,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  paper_id uuid,
  score float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id as paper_id,
    1 - (p.embedding <=> source.embedding) as score
  FROM papers p
  CROSS JOIN (
    SELECT embedding 
    FROM papers 
    WHERE id = source_paper_id 
    AND embedding IS NOT NULL
  ) source
  WHERE p.id != source_paper_id
  AND p.embedding IS NOT NULL
  ORDER BY p.embedding <=> source.embedding
  LIMIT match_count;
$$;

-- Create helper function to analyze vector dimensions
CREATE OR REPLACE FUNCTION analyze_papers_table()
RETURNS void
LANGUAGE sql
AS $$
  ANALYZE papers;
  ANALYZE paper_chunks;
$$;

-- Run analysis to update statistics
SELECT analyze_papers_table(); 