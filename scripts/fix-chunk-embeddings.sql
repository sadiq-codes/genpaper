-- Fix chunk embedding dimensions
-- Current: ~4700 dims, Need: 384 dims to match text-embedding-3-small

-- 1. Check current embedding dimensions
SELECT 
  paper_id,
  array_length(embedding, 1) as embedding_dims,
  substring(content, 1, 50) as content_preview
FROM paper_chunks 
WHERE embedding IS NOT NULL 
LIMIT 5;

-- 2. Find chunks with wrong dimensions
SELECT 
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN array_length(embedding, 1) != 384 THEN 1 END) as wrong_dimension_chunks,
  COUNT(CASE WHEN array_length(embedding, 1) = 384 THEN 1 END) as correct_dimension_chunks
FROM paper_chunks 
WHERE embedding IS NOT NULL;

-- 3. Clear incorrect embeddings (to be regenerated)
-- UNCOMMENT TO RUN:
-- UPDATE paper_chunks 
-- SET embedding = NULL 
-- WHERE embedding IS NOT NULL 
-- AND array_length(embedding, 1) != 384;
