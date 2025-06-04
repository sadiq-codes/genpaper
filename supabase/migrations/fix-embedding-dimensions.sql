-- Fix embedding dimension issues
-- This addresses cache pollution from wrong-dimension embeddings

-- 1. Clear papers with wrong vector dimensions
UPDATE papers
SET embedding = NULL
WHERE embedding IS NOT NULL
  AND vector_dims(embedding) <> 384;

-- 2. Clear chunks with wrong vector dimensions
UPDATE paper_chunks
SET embedding = NULL
WHERE embedding IS NOT NULL
  AND vector_dims(embedding) <> 384;

-- 3. Enforce dimension constraint on papers
ALTER TABLE papers
DROP CONSTRAINT IF EXISTS embedding_dim;

ALTER TABLE papers
ADD CONSTRAINT embedding_dim CHECK (
  embedding IS NULL OR vector_dims(embedding) = 384
);

-- 4. Enforce dimension constraint on paper_chunks
ALTER TABLE paper_chunks
DROP CONSTRAINT IF EXISTS embedding_dim;

ALTER TABLE paper_chunks
ADD CONSTRAINT embedding_dim CHECK (
  embedding IS NULL OR vector_dims(embedding) = 384
);

-- 5. Report dimension status
SELECT 
  'papers' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(embedding) AS with_embeddings,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL AND vector_dims(embedding) = 384) AS correct_dimension_embeddings
FROM papers

UNION ALL

SELECT 
  'paper_chunks' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(embedding) AS with_embeddings,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL AND vector_dims(embedding) = 384) AS correct_dimension_embeddings
FROM paper_chunks;
