-- RESTORE NOT NULL CONSTRAINTS - Run ONLY after embeddings are regenerated

-- First verify all embeddings exist
SELECT 
  'papers' as table_name,
  COUNT(*) as total,
  COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embeddings,
  COUNT(CASE WHEN embedding IS NULL THEN 1 END) as null_embeddings
FROM papers

UNION ALL

SELECT 
  'paper_chunks' as table_name,
  COUNT(*) as total,
  COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embeddings,
  COUNT(CASE WHEN embedding IS NULL THEN 1 END) as null_embeddings
FROM paper_chunks

ORDER BY table_name;

-- Only restore constraints if no null embeddings exist
-- Check this output first - if any null_embeddings > 0, don't run the ALTER commands below

-- Restore NOT NULL constraints (uncomment after verifying no nulls above)
-- ALTER TABLE papers ALTER COLUMN embedding SET NOT NULL;
-- ALTER TABLE paper_chunks ALTER COLUMN embedding SET NOT NULL;

-- Final verification
-- SELECT 
--   'Constraints restored' as status,
--   COUNT(*) as total_papers,
--   COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as papers_with_embeddings
-- FROM papers;
