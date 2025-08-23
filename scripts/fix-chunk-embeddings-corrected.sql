-- Fix chunk embedding dimensions (CORRECTED for vector type)
-- Current: ~4700 dims, Need: 384 dims to match text-embedding-3-small

-- 1. Check current vector dimensions using vector_dims() function
SELECT 
  paper_id,
  vector_dims(embedding) as embedding_dims,
  substring(content, 1, 50) as content_preview
FROM paper_chunks 
WHERE embedding IS NOT NULL 
LIMIT 5;

-- 2. Count chunks by embedding dimensions
SELECT 
  vector_dims(embedding) as dims,
  COUNT(*) as chunk_count
FROM paper_chunks 
WHERE embedding IS NOT NULL 
GROUP BY vector_dims(embedding)
ORDER BY dims;

-- 3. Summary of wrong vs correct dimensions
SELECT 
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN vector_dims(embedding) != 384 THEN 1 END) as wrong_dimension_chunks,
  COUNT(CASE WHEN vector_dims(embedding) = 384 THEN 1 END) as correct_dimension_chunks,
  ROUND(
    COUNT(CASE WHEN vector_dims(embedding) = 384 THEN 1 END) * 100.0 / COUNT(*), 
    2
  ) as percent_correct
FROM paper_chunks 
WHERE embedding IS NOT NULL;

-- 4. Clear incorrect embeddings (UNCOMMENT TO RUN)
-- WARNING: This will delete embeddings that need regeneration
-- UPDATE paper_chunks 
-- SET embedding = NULL 
-- WHERE embedding IS NOT NULL 
-- AND vector_dims(embedding) != 384;

-- 5. Alternative: Check if we can convert/truncate (probably not advisable)
-- SELECT vector_dims(embedding) as original_dims
-- FROM paper_chunks 
-- WHERE embedding IS NOT NULL 
-- AND vector_dims(embedding) > 384
-- LIMIT 1;
