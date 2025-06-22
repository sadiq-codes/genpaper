-- Migration: Prevent duplicate chunks and clean up existing duplicates
-- Date: 2025-06-20

-- First, add a hash column to paper_chunks if it doesn't exist
ALTER TABLE paper_chunks 
ADD COLUMN IF NOT EXISTS chunk_hash TEXT;

-- Create a function to generate content hash
CREATE OR REPLACE FUNCTION generate_chunk_hash(content TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN encode(digest(content, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql;

-- Update existing chunks with hashes
UPDATE paper_chunks 
SET chunk_hash = generate_chunk_hash(content)
WHERE chunk_hash IS NULL;

-- Remove duplicate chunks (keep the one with the lowest ID)
DELETE FROM paper_chunks a
USING paper_chunks b
WHERE a.id > b.id
  AND a.paper_id = b.paper_id
  AND a.chunk_hash = b.chunk_hash;

-- Create unique constraint to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uniq_paper_chunk_hash
ON paper_chunks (paper_id, chunk_hash);

-- Make chunk_hash NOT NULL for future inserts
ALTER TABLE paper_chunks 
ALTER COLUMN chunk_hash SET NOT NULL;

-- Create trigger to auto-generate hash on insert/update
CREATE OR REPLACE FUNCTION set_chunk_hash()
RETURNS TRIGGER AS $$
BEGIN
  NEW.chunk_hash = generate_chunk_hash(NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_chunk_hash ON paper_chunks;
CREATE TRIGGER trigger_set_chunk_hash
  BEFORE INSERT OR UPDATE ON paper_chunks
  FOR EACH ROW
  EXECUTE FUNCTION set_chunk_hash();

-- Add comment for documentation
COMMENT ON COLUMN paper_chunks.chunk_hash IS 'SHA256 hash of chunk content to prevent duplicates';
COMMENT ON INDEX uniq_paper_chunk_hash IS 'Prevents duplicate chunks for the same paper'; 