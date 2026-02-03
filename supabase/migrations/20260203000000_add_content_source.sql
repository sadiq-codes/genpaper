-- Migration: Add content_source column to papers table
-- This tracks how full-text content was obtained: 'pdf', 'html', or 'abstract-only'

-- Add the content_source column with a check constraint
ALTER TABLE papers 
ADD COLUMN IF NOT EXISTS content_source TEXT
CHECK (content_source IS NULL OR content_source IN ('pdf', 'html', 'abstract-only'));

-- Add a comment explaining the column
COMMENT ON COLUMN papers.content_source IS 
  'Source of full-text content: pdf (from PDF extraction), html (from publisher HTML page), or abstract-only (only abstract available)';

-- Create an index for filtering papers by content source (useful for analytics)
CREATE INDEX IF NOT EXISTS idx_papers_content_source ON papers(content_source) 
WHERE content_source IS NOT NULL;
