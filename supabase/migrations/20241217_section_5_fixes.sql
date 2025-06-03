-- Code Review Section 5 Fixes - Embeddings & Chunk insertion
-- Migration to address chunk insertion failures and token management

-- Fix 1: Create failed_chunks table for retry mechanism
CREATE TABLE IF NOT EXISTS failed_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  error_message TEXT,
  error_count INTEGER DEFAULT 1,
  last_attempt_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(paper_id, chunk_index)
);

-- Fix 2: Add index for efficient retry queries
CREATE INDEX IF NOT EXISTS failed_chunks_retry_idx 
ON failed_chunks (error_count ASC, last_attempt_at ASC);

-- Fix 3: Add index for paper-based cleanup
CREATE INDEX IF NOT EXISTS failed_chunks_paper_id_idx 
ON failed_chunks (paper_id);

-- Fix 4: Add chunk processing status to paper_chunks
ALTER TABLE paper_chunks ADD COLUMN IF NOT EXISTS processing_status TEXT DEFAULT 'completed';
ALTER TABLE paper_chunks ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0;
ALTER TABLE paper_chunks ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Fix 5: Add index for processing status queries
CREATE INDEX IF NOT EXISTS paper_chunks_status_idx 
ON paper_chunks (processing_status);

-- Fix 6: Create retry job function for failed chunks
CREATE OR REPLACE FUNCTION retry_failed_chunks()
RETURNS TABLE (
  paper_id UUID,
  chunk_index INTEGER,
  content TEXT,
  retry_count INTEGER
)
LANGUAGE sql STABLE
AS $$
  SELECT
    fc.paper_id,
    fc.chunk_index,
    fc.content,
    fc.error_count
  FROM failed_chunks fc
  WHERE fc.error_count < 3 -- Max 3 retry attempts
    AND fc.last_attempt_at < NOW() - INTERVAL '1 hour' -- Wait 1 hour between retries
  ORDER BY fc.error_count ASC, fc.last_attempt_at ASC
  LIMIT 100; -- Process in batches
$$;

-- Fix 7: Create function to clean up successful retries
CREATE OR REPLACE FUNCTION cleanup_successful_chunks()
RETURNS INTEGER
LANGUAGE sql
AS $$
  WITH successful_chunks AS (
    SELECT fc.paper_id, fc.chunk_index
    FROM failed_chunks fc
    INNER JOIN paper_chunks pc ON fc.paper_id = pc.paper_id 
      AND fc.chunk_index = pc.chunk_index
    WHERE pc.processing_status = 'completed'
  ),
  deleted AS (
    DELETE FROM failed_chunks
    WHERE (paper_id, chunk_index) IN (
      SELECT paper_id, chunk_index FROM successful_chunks
    )
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;

-- Fix 8: Add comments documenting the improvements
COMMENT ON TABLE failed_chunks IS 'Tracks chunks that failed during embedding generation for retry processing';
COMMENT ON COLUMN paper_chunks.processing_status IS 'Status of chunk processing: pending, processing, completed, failed';
COMMENT ON COLUMN paper_chunks.error_count IS 'Number of failed processing attempts';
COMMENT ON COLUMN paper_chunks.last_error IS 'Last error message if processing failed';
COMMENT ON FUNCTION retry_failed_chunks() IS 'Returns failed chunks ready for retry (< 3 attempts, > 1 hour old)';
COMMENT ON FUNCTION cleanup_successful_chunks() IS 'Removes successfully processed chunks from failed_chunks table';

-- Fix 9: Enable RLS on failed_chunks table
ALTER TABLE failed_chunks ENABLE ROW LEVEL SECURITY;

-- Fix 10: Create RLS policy for failed_chunks (admin access only)
CREATE POLICY "Allow authenticated users to read failed chunks" ON failed_chunks
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow service role to manage failed chunks" ON failed_chunks
  FOR ALL USING (auth.role() = 'service_role'); 