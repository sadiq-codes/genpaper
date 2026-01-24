-- Migration: Fix pending papers that have chunks
-- This fixes papers that were processed but left in 'pending' status
-- due to a bug in paper-aggregation.ts that didn't update processing_status

-- Update papers to 'processed' if they have at least 1 chunk
-- This is a more thorough fix than the previous migration which only
-- checked for existence in paper_chunks table
UPDATE papers p
SET processing_status = 'processed'
WHERE p.processing_status = 'pending'
AND EXISTS (
  SELECT 1 
  FROM paper_chunks pc 
  WHERE pc.paper_id = p.id
  LIMIT 1
);

-- Log how many papers were updated (for debugging)
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM papers
  WHERE processing_status = 'processed';
  
  RAISE NOTICE 'Papers with processed status: %', updated_count;
END $$;

-- Also mark papers as 'failed' if they have no chunks and no pdf_url
-- These papers cannot be processed and should not stay pending forever
UPDATE papers p
SET processing_status = 'failed'
WHERE p.processing_status = 'pending'
AND p.pdf_url IS NULL
AND NOT EXISTS (
  SELECT 1 
  FROM paper_chunks pc 
  WHERE pc.paper_id = p.id
  LIMIT 1
);

-- Add comment for documentation
COMMENT ON COLUMN papers.processing_status IS 'Status of PDF text extraction and chunking: pending (waiting), processing (in progress), processed (complete with chunks), failed (error or no content)';
