-- Fix embeddings when NOT NULL constraints exist
-- This handles the constraint issue properly

-- 1. First, check if we can make embedding nullable temporarily
-- Check current constraints
SELECT 
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid) as definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname IN ('papers', 'paper_chunks')
AND con.contype = 'c' -- check constraints
AND pg_get_constraintdef(con.oid) LIKE '%embedding%';

-- 2. Temporarily drop NOT NULL constraints if they exist
-- For papers table
ALTER TABLE papers ALTER COLUMN embedding DROP NOT NULL;

-- For paper_chunks table  
ALTER TABLE paper_chunks ALTER COLUMN embedding DROP NOT NULL;

-- 3. Now clear embeddings
UPDATE papers SET embedding = NULL;
UPDATE paper_chunks SET embedding = NULL;

-- 4. Verify clearing worked
SELECT 
  'papers' as table_name,
  COUNT(*) as total,
  COUNT(CASE WHEN embedding IS NULL THEN 1 END) as null_embeddings
FROM papers

UNION ALL

SELECT 
  'paper_chunks' as table_name,
  COUNT(*) as total,
  COUNT(CASE WHEN embedding IS NULL THEN 1 END) as null_embeddings
FROM paper_chunks;
