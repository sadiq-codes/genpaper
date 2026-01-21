-- Migration: Lazy PDF Processing
-- Adds processing_status to papers table and use_library_only to research_projects
-- Also creates storage bucket for PDFs

-- Add processing_status to papers table
ALTER TABLE papers ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'pending';

-- Add constraint for valid processing statuses
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'papers_processing_status_check'
  ) THEN
    ALTER TABLE papers ADD CONSTRAINT papers_processing_status_check 
      CHECK (processing_status IN ('pending', 'processing', 'processed', 'failed'));
  END IF;
END $$;

-- Add use_library_only to research_projects table
ALTER TABLE research_projects ADD COLUMN IF NOT EXISTS use_library_only boolean DEFAULT false;

-- Create index for faster queries on processing_status
CREATE INDEX IF NOT EXISTS idx_papers_processing_status ON papers(processing_status);

-- Create storage bucket for PDFs if it doesn't exist
-- Note: This needs to be done via Supabase dashboard or storage API, not SQL
-- But we can create a function to help with setup

-- Update existing papers to have 'processed' status if they have chunks
-- This handles backwards compatibility - papers that were already processed
UPDATE papers 
SET processing_status = 'processed' 
WHERE processing_status = 'pending' 
AND id IN (
  SELECT DISTINCT paper_id FROM paper_chunks
);

-- Add comment explaining the column
COMMENT ON COLUMN papers.processing_status IS 'Status of PDF text extraction and chunking: pending, processing, processed, failed';
COMMENT ON COLUMN research_projects.use_library_only IS 'If true, only use papers from user library (no online search)';
