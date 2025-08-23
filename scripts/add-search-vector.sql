-- Add search_vector column for hybrid search keyword scoring
-- This was missing and causing the "column does not exist" error

-- 1. Add the column if it doesn't exist
ALTER TABLE papers 
ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Populate search_vector for all papers
UPDATE papers 
SET search_vector = to_tsvector('english', 
  COALESCE(title, '') || ' ' || COALESCE(abstract, '') || ' ' || COALESCE(venue, '')
)
WHERE search_vector IS NULL;

-- 3. Create GIN index for fast text search
CREATE INDEX IF NOT EXISTS papers_search_vector_idx 
ON papers USING gin(search_vector);

-- 4. Create trigger to auto-update search_vector on changes
CREATE OR REPLACE FUNCTION update_papers_search_vector()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', 
    COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.abstract, '') || ' ' || COALESCE(NEW.venue, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS papers_search_vector_update ON papers;
CREATE TRIGGER papers_search_vector_update
  BEFORE INSERT OR UPDATE ON papers
  FOR EACH ROW EXECUTE FUNCTION update_papers_search_vector();

-- 5. Verify the column exists and has data
SELECT 
  COUNT(*) as total_papers,
  COUNT(CASE WHEN search_vector IS NOT NULL THEN 1 END) as with_search_vector,
  COUNT(CASE WHEN search_vector IS NOT NULL AND length(search_vector::text) > 10 THEN 1 END) as with_meaningful_search_vector
FROM papers;
