-- Create papers API cache table for storing external API responses
CREATE TABLE IF NOT EXISTS papers_api_cache (
  id TEXT PRIMARY KEY,
  response JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  request_hash TEXT NOT NULL
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_papers_api_cache_expires_at ON papers_api_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_papers_api_cache_request_hash ON papers_api_cache(request_hash);
CREATE INDEX IF NOT EXISTS idx_papers_api_cache_fetched_at ON papers_api_cache(fetched_at);

-- Enable Row Level Security
ALTER TABLE papers_api_cache ENABLE ROW LEVEL SECURITY;

-- Create policies for cache table access
CREATE POLICY "Cache entries are readable by authenticated users" ON papers_api_cache
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Cache entries are insertable by authenticated users" ON papers_api_cache
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Cache entries are updatable by authenticated users" ON papers_api_cache
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Cache entries are deletable by authenticated users" ON papers_api_cache
  FOR DELETE USING (auth.role() = 'authenticated');

-- Create a function to clean up expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM papers_api_cache WHERE expires_at < NOW();
END;
$$;

-- Create a function to get cache statistics
CREATE OR REPLACE FUNCTION get_cache_stats()
RETURNS TABLE (
  total_entries BIGINT,
  expired_entries BIGINT,
  valid_entries BIGINT,
  oldest_entry TIMESTAMPTZ,
  newest_entry TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) AS total_entries,
    COUNT(*) FILTER (WHERE expires_at < NOW()) AS expired_entries,
    COUNT(*) FILTER (WHERE expires_at >= NOW()) AS valid_entries,
    MIN(fetched_at) AS oldest_entry,
    MAX(fetched_at) AS newest_entry
  FROM papers_api_cache;
END;
$$;

-- Add comment for documentation
COMMENT ON TABLE papers_api_cache IS 'Caches responses from external academic APIs to reduce API calls and improve performance';
COMMENT ON COLUMN papers_api_cache.id IS 'MD5 hash of the request parameters used as cache key';
COMMENT ON COLUMN papers_api_cache.response IS 'JSON response from the external API';
COMMENT ON COLUMN papers_api_cache.fetched_at IS 'Timestamp when the response was cached';
COMMENT ON COLUMN papers_api_cache.expires_at IS 'Timestamp when the cache entry expires';
COMMENT ON COLUMN papers_api_cache.request_hash IS 'Hash of the original request for debugging purposes'; 