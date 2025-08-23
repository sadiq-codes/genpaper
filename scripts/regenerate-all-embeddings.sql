-- REGENERATE ALL EMBEDDINGS (384 dimensions)
-- This fixes the corrupted embeddings from dimension truncation

-- 1. First, verify current state
SELECT 
  'papers' as table_name,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embeddings,
  COUNT(CASE WHEN vector_dims(embedding) = 384 THEN 1 END) as correct_384_dims
FROM papers

UNION ALL

SELECT 
  'paper_chunks' as table_name,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embeddings,
  COUNT(CASE WHEN vector_dims(embedding) = 384 THEN 1 END) as correct_384_dims
FROM paper_chunks

ORDER BY table_name;

-- 2. Clear ALL embeddings (they're corrupted from dimension truncation)
-- WARNING: This will remove all embeddings - they need to be regenerated

-- Uncomment to run:
-- UPDATE papers SET embedding = NULL;
-- UPDATE paper_chunks SET embedding = NULL;

-- 3. Verify clearing worked
-- SELECT 
--   'After clearing' as status,
--   COUNT(*) as total_papers,
--   COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as papers_with_embeddings
-- FROM papers;

-- SELECT 
--   'After clearing' as status,
--   COUNT(*) as total_chunks,
--   COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as chunks_with_embeddings
-- FROM paper_chunks;
