-- Add metadata JSONB column to papers table for bibliographic fields
-- This column stores additional citation data: volume, issue, pages, publisher, etc.
-- Required by lib/db/papers.ts for complete citation generation

ALTER TABLE papers ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add comment explaining the column's purpose
COMMENT ON COLUMN papers.metadata IS 'Stores additional bibliographic fields for citations: volume, issue, pages, publisher, api_source, relevance_score, etc.';

-- Create index for JSONB queries if needed in the future
CREATE INDEX IF NOT EXISTS papers_metadata_gin_idx ON papers USING gin (metadata);
