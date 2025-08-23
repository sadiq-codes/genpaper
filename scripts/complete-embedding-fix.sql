-- COMPLETE EMBEDDING FIX - Run this first, then regenerate
-- This handles the full sequence properly

-- Step 1: Drop NOT NULL constraints to allow clearing
ALTER TABLE papers ALTER COLUMN embedding DROP NOT NULL;
ALTER TABLE paper_chunks ALTER COLUMN embedding DROP NOT NULL;

-- Step 2: Clear all corrupted embeddings
UPDATE papers SET embedding = NULL;
UPDATE paper_chunks SET embedding = NULL;

-- Step 3: Add search_vector column if missing
ALTER TABLE papers 
ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Step 4: Populate search_vector for all papers
UPDATE papers 
SET search_vector = to_tsvector('english', 
  COALESCE(title, '') || ' ' || COALESCE(abstract, '') || ' ' || COALESCE(venue, '')
)
WHERE search_vector IS NULL;

-- Step 5: Create search_vector index
CREATE INDEX IF NOT EXISTS papers_search_vector_idx 
ON papers USING gin(search_vector);

-- Step 6: Verify everything is cleared
SELECT 
  'papers' as table_name,
  COUNT(*) as total,
  COUNT(CASE WHEN embedding IS NULL THEN 1 END) as null_embeddings,
  COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) as with_search_vector
FROM papers

UNION ALL

SELECT 
  'paper_chunks' as table_name,
  COUNT(*) as total,
  COUNT(CASE WHEN embedding IS NULL THEN 1 END) as null_embeddings,
  0 as with_search_vector
FROM paper_chunks

ORDER BY table_name;

-- NOTE: Do NOT restore NOT NULL constraints yet!
-- Run the regenerate-embeddings.ts script first,
-- then restore constraints with restore-constraints.sql
