-- Migration: Vector Index Auto-Optimization
-- Sets up automatic HNSW index optimization for better search performance

-- Step 1: Note about HNSW optimization settings
-- In Supabase managed environment, these settings are handled automatically
-- For self-hosted: SET pgvector.hnsw_ef_search = 200; (session level)

-- Step 2: Create optimized indexes with better parameters
-- Drop existing indexes if they exist with suboptimal settings
DROP INDEX IF EXISTS papers_embedding_idx;
DROP INDEX IF EXISTS paper_chunks_embedding_idx;

-- Create optimized HNSW indexes with better parameters
CREATE INDEX papers_embedding_hnsw_idx 
ON papers 
USING hnsw (embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);

CREATE INDEX paper_chunks_embedding_hnsw_idx 
ON paper_chunks 
USING hnsw (embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);

-- Step 3: Create a function to manually optimize vector indexes when needed
CREATE OR REPLACE FUNCTION optimize_vector_indexes()
RETURNS text AS $$
DECLARE
  result text := '';
BEGIN
  -- Reindex vector indexes to optimize their structure
  REINDEX INDEX papers_embedding_hnsw_idx;
  REINDEX INDEX paper_chunks_embedding_hnsw_idx;
  
  result := 'Vector indexes optimized successfully at ' || now();
  
  -- Log the optimization
  RAISE NOTICE '%', result;
  
  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    result := 'Vector index optimization failed: ' || SQLERRM;
    RAISE WARNING '%', result;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create a function to get vector index statistics
CREATE OR REPLACE FUNCTION get_vector_index_stats()
RETURNS TABLE(
  table_name text,
  index_name text,
  index_size text,
  rows_count bigint,
  index_scans bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i.tablename::text,
    i.indexname::text,
    pg_size_pretty(pg_relation_size(i.indexname::regclass))::text as index_size,
    c.n_tup_ins + c.n_tup_upd as rows_count,
    s.idx_scan as index_scans
  FROM pg_indexes i
  JOIN pg_stat_user_tables c ON c.relname = i.tablename
  LEFT JOIN pg_stat_user_indexes s ON s.indexrelname = i.indexname
  WHERE i.indexname LIKE '%embedding%'
    AND i.schemaname = 'public'
  ORDER BY pg_relation_size(i.indexname::regclass) DESC;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Set up automated maintenance (optional - can be scheduled via pg_cron if available)
-- This would run weekly to keep indexes optimized
-- CREATE OR REPLACE FUNCTION schedule_vector_maintenance()
-- RETURNS void AS $$
-- BEGIN
--   -- Only schedule if pg_cron extension is available
--   IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--     -- Schedule weekly optimization on Sundays at 2 AM
--     PERFORM cron.schedule('optimize-vectors', '0 2 * * 0', 'SELECT optimize_vector_indexes();');
--   END IF;
-- END;
-- $$ LANGUAGE plpgsql;

-- Step 6 (revised): monitoring view for vector-search performance
CREATE OR REPLACE VIEW vector_search_performance AS
SELECT 
  schemaname,
  relname        AS table_name,
  indexrelname   AS index_name,
  idx_scan       AS searches_performed,
  idx_tup_read   AS rows_examined,
  idx_tup_fetch  AS rows_returned,
  CASE 
    WHEN idx_scan > 0
      THEN ROUND(idx_tup_fetch::numeric / idx_scan, 2)
      ELSE 0
  END            AS avg_rows_per_search
FROM pg_stat_user_indexes
WHERE indexrelname LIKE '%embedding%'
ORDER BY idx_scan DESC;

-- Add helpful comments
COMMENT ON FUNCTION optimize_vector_indexes() IS 'Manually optimize vector indexes for better search performance';
COMMENT ON FUNCTION get_vector_index_stats() IS 'Get detailed statistics about vector index usage and performance';




COMMENT ON VIEW vector_search_performance
  IS 'Live stats for pgvector indexes (scan counts, efficiency).';
