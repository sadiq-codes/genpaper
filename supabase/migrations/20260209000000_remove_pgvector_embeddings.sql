-- Migration: Remove pgvector embeddings (moved to Qdrant)
-- 
-- This migration cleans up the embedding columns from Supabase tables.
-- All embeddings are now stored exclusively in Qdrant for vector search.
-- 
-- Estimated space savings:
--   papers.embedding:       ~16,500 rows × 4KB = ~66 MB
--   paper_chunks.embedding: ~122,000 rows × 4KB = ~488 MB
--   paper_claims.embedding: 0 rows = 0 MB
--   TOTAL:                  ~554 MB
--
-- This migration:
-- 1. Nulls out all embedding values (to free storage)
-- 2. Drops the pgvector indexes (no longer needed)
-- 3. Drops the pgvector-dependent RPC functions
-- 4. Optionally drops the embedding columns entirely (commented out for safety)

-- ============================================================================
-- Step 1: NULL out embeddings to free storage
-- ============================================================================

-- This is faster than dropping columns and can be done safely
UPDATE papers SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE paper_chunks SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE paper_claims SET embedding = NULL WHERE embedding IS NOT NULL;

-- ============================================================================
-- Step 2: Drop pgvector indexes (they're useless without embeddings)
-- ============================================================================

DROP INDEX IF EXISTS papers_embedding_idx;
DROP INDEX IF EXISTS paper_chunks_embedding_idx;
DROP INDEX IF EXISTS paper_claims_embedding_idx;

-- Also drop any HNSW indexes if they exist
DROP INDEX IF EXISTS papers_embedding_hnsw_idx;
DROP INDEX IF EXISTS paper_chunks_embedding_hnsw_idx;

-- ============================================================================
-- Step 3: Drop pgvector-dependent RPC functions
-- ============================================================================

-- These functions used pgvector's <=> operator for similarity search
-- They are no longer needed since all vector search goes through Qdrant

-- match_paper_chunks - semantic search over chunks
DROP FUNCTION IF EXISTS match_paper_chunks(vector(1024), int, float, uuid[], uuid[], float);
DROP FUNCTION IF EXISTS match_paper_chunks(vector(384), int, float, uuid[], uuid[], float);
DROP FUNCTION IF EXISTS match_paper_chunks(vector, int, float, uuid[], uuid[], float);

-- match_paper_claims - semantic search over claims  
DROP FUNCTION IF EXISTS match_paper_claims(vector(1024), uuid[], int);
DROP FUNCTION IF EXISTS match_paper_claims(vector(384), uuid[], int);
DROP FUNCTION IF EXISTS match_paper_claims(vector, uuid[], int);

-- find_similar_papers - paper similarity search
DROP FUNCTION IF EXISTS find_similar_papers(vector(1024), int, int);
DROP FUNCTION IF EXISTS find_similar_papers(vector(384), int, int);
DROP FUNCTION IF EXISTS find_similar_papers(vector, int, int);

-- semantic_search_papers - semantic paper search
DROP FUNCTION IF EXISTS semantic_search_papers(text, vector(1024), int, int);
DROP FUNCTION IF EXISTS semantic_search_papers(text, vector(384), int, int);
DROP FUNCTION IF EXISTS semantic_search_papers(text, vector, int, int);

-- hybrid_search_papers - combined semantic + keyword paper search
DROP FUNCTION IF EXISTS hybrid_search_papers(text, vector(1024), int, int, float);
DROP FUNCTION IF EXISTS hybrid_search_papers(text, vector(384), int, int, float);
DROP FUNCTION IF EXISTS hybrid_search_papers(text, vector, int, int, float);

-- hybrid_search_chunks - combined semantic + keyword chunk search (pgvector version)
DROP FUNCTION IF EXISTS hybrid_search_chunks(vector(1024), text, int, float, uuid[], float);
DROP FUNCTION IF EXISTS hybrid_search_chunks(vector(384), text, int, float, uuid[], float);
DROP FUNCTION IF EXISTS hybrid_search_chunks(vector, text, int, float, uuid[], float);

-- hybrid_search_chunks_with_boost - with citation boosting
DROP FUNCTION IF EXISTS hybrid_search_chunks_with_boost(vector(1024), text, int, float, uuid[], float, float);
DROP FUNCTION IF EXISTS hybrid_search_chunks_with_boost(vector(384), text, int, float, uuid[], float, float);
DROP FUNCTION IF EXISTS hybrid_search_chunks_with_boost(vector, text, int, float, uuid[], float, float);

-- ============================================================================
-- Step 4: Keep keyword search function (still used)
-- ============================================================================

-- keyword_search_chunks is still used for hybrid search (Qdrant vectors + Supabase keywords)
-- DO NOT DROP: keyword_search_chunks

-- ============================================================================
-- Step 5: OPTIONAL - Drop embedding columns entirely
-- ============================================================================

-- Uncomment these lines if you want to completely remove the columns
-- This saves the most space but is irreversible

-- ALTER TABLE papers DROP COLUMN IF EXISTS embedding;
-- ALTER TABLE paper_chunks DROP COLUMN IF EXISTS embedding;
-- ALTER TABLE paper_claims DROP COLUMN IF EXISTS embedding;

-- ============================================================================
-- Step 6: OPTIONAL - Drop pgvector extension if no longer needed
-- ============================================================================

-- Only uncomment if you're sure nothing else uses pgvector
-- DROP EXTENSION IF EXISTS vector;

-- ============================================================================
-- Step 7: VACUUM to reclaim space
-- ============================================================================

-- Note: VACUUM FULL requires exclusive lock and can take a while
-- Run this manually during low-traffic period if needed:
-- VACUUM FULL papers;
-- VACUUM FULL paper_chunks;
-- VACUUM FULL paper_claims;

-- Regular VACUUM (non-blocking) to mark space as reusable
VACUUM papers;
VACUUM paper_chunks;
VACUUM paper_claims;
