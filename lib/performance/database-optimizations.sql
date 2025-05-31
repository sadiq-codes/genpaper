-- Performance Optimizations for GenPaper SaaS

-- 1. Materialized View for Paper Content (refreshed every 30 seconds)
DROP MATERIALIZED VIEW IF EXISTS paper_content_materialized;
CREATE MATERIALIZED VIEW paper_content_materialized AS
SELECT 
  project_id,
  STRING_AGG(text, '' ORDER BY seq) AS content,
  COUNT(*) AS chunk_count,
  MAX(created_at) AS last_updated,
  SUM(LENGTH(text)) AS total_chars,
  ROUND(SUM(LENGTH(text)) / 5.0) AS estimated_words
FROM paper_chunks 
GROUP BY project_id;

-- Index for fast lookups
CREATE UNIQUE INDEX idx_paper_content_mat_project ON paper_content_materialized(project_id);

-- Auto-refresh function (called by cron or trigger)
CREATE OR REPLACE FUNCTION refresh_paper_content_materialized()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY paper_content_materialized;
END;
$$ LANGUAGE plpgsql;

-- 2. Optimized Citation View with Aggregated Links
DROP VIEW IF EXISTS citations_optimized;
CREATE VIEW citations_optimized AS
SELECT 
  c.*,
  COALESCE(cl.link_count, 0) as usage_count,
  cl.sections_used,
  cl.first_used,
  cl.last_used
FROM citations c
LEFT JOIN (
  SELECT 
    citation_id,
    COUNT(*) as link_count,
    ARRAY_AGG(DISTINCT section ORDER BY section) as sections_used,
    MIN(created_at) as first_used,
    MAX(created_at) as last_used
  FROM citation_links 
  GROUP BY citation_id
) cl ON c.id = cl.citation_id;

-- 3. Partial Indexes for Common Queries
CREATE INDEX IF NOT EXISTS idx_paper_chunks_recent 
ON paper_chunks(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_citations_enriched 
ON citations(project_id, created_at DESC) 
WHERE enriched = true;

-- 4. Connection Pool Optimization Function
CREATE OR REPLACE FUNCTION optimize_for_realtime()
RETURNS void AS $$
BEGIN
  -- Set optimal settings for real-time workloads
  SET statement_timeout = '30s';
  SET lock_timeout = '10s';
  SET idle_in_transaction_session_timeout = '60s';
  
  -- Optimize for concurrent reads
  SET default_transaction_isolation = 'read committed';
  SET synchronous_commit = 'off'; -- For non-critical real-time updates
END;
$$ LANGUAGE plpgsql;

-- 5. Chunk Batching for Bulk Inserts
CREATE OR REPLACE FUNCTION batch_append_chunks(
  p_project_id UUID,
  p_texts TEXT[]
) RETURNS INTEGER AS $$
DECLARE
  start_seq INTEGER;
  i INTEGER;
BEGIN
  -- Get starting sequence number
  SELECT COALESCE(MAX(seq), 0) + 1 INTO start_seq
  FROM paper_chunks
  WHERE project_id = p_project_id;
  
  -- Bulk insert with sequential numbering
  INSERT INTO paper_chunks (project_id, seq, text)
  SELECT 
    p_project_id,
    start_seq + generate_series(0, array_length(p_texts, 1) - 1),
    unnest(p_texts);
  
  RETURN array_length(p_texts, 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Citation Deduplication Function
CREATE OR REPLACE FUNCTION deduplicate_citations(p_project_id UUID)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH duplicates AS (
    SELECT id, 
           ROW_NUMBER() OVER (
             PARTITION BY project_id, key 
             ORDER BY created_at DESC
           ) as rn
    FROM citations 
    WHERE project_id = p_project_id
  )
  DELETE FROM citations 
  WHERE id IN (
    SELECT id FROM duplicates WHERE rn > 1
  );
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 