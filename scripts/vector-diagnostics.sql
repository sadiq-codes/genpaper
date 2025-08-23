-- VECTOR DIAGNOSTICS - Run in Supabase SQL Editor
-- ================================================

-- 1. Check vector dimensions in chunks
SELECT 
  vector_dims(embedding) as dimensions,
  COUNT(*) as chunk_count
FROM paper_chunks 
WHERE embedding IS NOT NULL 
GROUP BY vector_dims(embedding)
ORDER BY dimensions;

-- 2. Check if we have ANY 384-dimension embeddings
SELECT 
  COUNT(*) as total_chunks_with_embeddings,
  COUNT(CASE WHEN vector_dims(embedding) = 384 THEN 1 END) as correct_384_dims,
  COUNT(CASE WHEN vector_dims(embedding) != 384 THEN 1 END) as wrong_dims,
  ROUND(
    COUNT(CASE WHEN vector_dims(embedding) = 384 THEN 1 END) * 100.0 / COUNT(*), 
    2
  ) as percent_correct
FROM paper_chunks 
WHERE embedding IS NOT NULL;

-- 3. Sample of papers with chunks (to verify paper IDs)
SELECT 
  paper_id,
  COUNT(*) as chunk_count,
  vector_dims(embedding) as embedding_dims
FROM paper_chunks 
WHERE embedding IS NOT NULL
GROUP BY paper_id, vector_dims(embedding)
ORDER BY chunk_count DESC
LIMIT 10;

-- 4. Check papers table embeddings too
SELECT 
  COUNT(*) as total_papers,
  COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as papers_with_embeddings,
  COUNT(CASE WHEN vector_dims(embedding) = 384 THEN 1 END) as papers_384_dims
FROM papers;

-- 5. Check if search_vector column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'papers' 
AND column_name = 'search_vector';
