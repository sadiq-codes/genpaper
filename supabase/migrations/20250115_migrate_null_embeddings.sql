-- Migration: Convert NULL embeddings to zero vectors before adding NOT NULL constraint
-- This ensures existing papers without embeddings don't break the system

-- Step 1: Create a function to generate zero vectors of the correct dimension
CREATE OR REPLACE FUNCTION vector_zero(dimensions integer)
RETURNS vector AS $$
BEGIN
  RETURN ('['||repeat('0,', dimensions-1)||'0]')::vector;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 2: Update NULL embeddings in papers table to zero vectors (384 dimensions for our model)
UPDATE papers 
SET embedding = vector_zero(384) 
WHERE embedding IS NULL;

-- Step 3: Update NULL embeddings in paper_chunks table to zero vectors
UPDATE paper_chunks 
SET embedding = vector_zero(384) 
WHERE embedding IS NULL;

-- Step 4: Add NOT NULL constraints to prevent future NULL embeddings
ALTER TABLE papers 
ALTER COLUMN embedding SET NOT NULL;

ALTER TABLE paper_chunks 
ALTER COLUMN embedding SET NOT NULL;

-- Step 5: Add check constraints to ensure embeddings have correct dimensions
ALTER TABLE papers 
ADD CONSTRAINT papers_embedding_dimension_check 
CHECK (vector_dims(embedding) = 384);

ALTER TABLE paper_chunks 
ADD CONSTRAINT paper_chunks_embedding_dimension_check 
CHECK (vector_dims(embedding) = 384);

-- Step 6: Create index comments for future reference
COMMENT ON COLUMN papers.embedding IS 'Vector embedding (384 dimensions) - NOT NULL, generated from title+abstract';
COMMENT ON COLUMN paper_chunks.embedding IS 'Vector embedding (384 dimensions) - NOT NULL, generated from chunk content';

-- Step 7: Update RLS policies to handle the new constraints
-- (Existing policies should continue to work, but let's be explicit)

-- Verification query (uncomment to test)
-- SELECT 
--   COUNT(*) as total_papers,
--   COUNT(CASE WHEN embedding IS NULL THEN 1 END) as null_embeddings,
--   COUNT(CASE WHEN vector_dims(embedding) = 384 THEN 1 END) as correct_dimensions
-- FROM papers; 