-- Optimize lookup by most recent fetch
CREATE INDEX IF NOT EXISTS idx_papers_api_cache_fetched_at_desc 
  ON papers_api_cache(fetched_at DESC);

-- Optimize id + timestamp lookups
CREATE INDEX IF NOT EXISTS idx_papers_api_cache_id_fetched_at 
  ON papers_api_cache(id, fetched_at DESC);

-- Drop old index if it exists
DROP INDEX IF EXISTS idx_papers_api_cache_expires_at;

-- Add basic index for cleanup (non-partial to avoid NOW() error)
CREATE INDEX IF NOT EXISTS idx_papers_api_cache_expires_at 
  ON papers_api_cache(expires_at);

-- Add comments for docs
COMMENT ON INDEX idx_papers_api_cache_fetched_at_desc 
  IS 'Optimizes cache lookups by fetched_at timestamp (most recent first)';
COMMENT ON INDEX idx_papers_api_cache_id_fetched_at 
  IS 'Optimizes the common pattern of id + recent fetched_at queries';
COMMENT ON INDEX idx_papers_api_cache_expires_at 
  IS 'Supports cache cleanup queries for expired items';
