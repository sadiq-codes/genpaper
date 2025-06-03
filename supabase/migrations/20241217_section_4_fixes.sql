-- Code Review Section 4 Fixes - Database writes
-- Migration to address database performance and constraint issues

-- Fix 1: Add check constraint for impact_score (must be >= 0)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE table_name = 'papers' AND constraint_name = 'papers_impact_score_check'
  ) THEN
    ALTER TABLE papers ADD CONSTRAINT papers_impact_score_check 
    CHECK (impact_score IS NULL OR impact_score >= 0);
  END IF;
END $$;

-- Fix 2: Ensure paper_authors table has proper primary key
-- (This should already exist from 001_simplified_schema.sql, but ensure it's there)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'paper_authors' 
    AND constraint_type = 'PRIMARY KEY'
    AND constraint_name = 'paper_authors_pkey'
  ) THEN
    ALTER TABLE paper_authors ADD CONSTRAINT paper_authors_pkey 
    PRIMARY KEY (paper_id, author_id);
  END IF;
END $$;

-- Fix 3: Add index for better performance on paper_authors ordinal queries
CREATE INDEX IF NOT EXISTS paper_authors_ordinal_idx 
ON paper_authors (paper_id, ordinal);

-- Fix 4: Add index for better performance on author name lookups
CREATE INDEX IF NOT EXISTS authors_name_idx 
ON authors (name);

-- Fix 5: Add index for citation_count for ranking queries
CREATE INDEX IF NOT EXISTS papers_citation_count_idx 
ON papers (citation_count DESC NULLS LAST);

-- Fix 6: Add index for impact_score for ranking queries  
CREATE INDEX IF NOT EXISTS papers_impact_score_idx 
ON papers (impact_score DESC NULLS LAST);

-- Fix 7: Add composite index for common search patterns
CREATE INDEX IF NOT EXISTS papers_source_citation_idx 
ON papers (source, citation_count DESC NULLS LAST);

-- Add comments documenting the fixes
COMMENT ON TABLE papers IS 'Papers table with Section 4 fixes: impact_score >= 0 constraint';
COMMENT ON TABLE paper_authors IS 'Paper-author relationships with proper primary key (paper_id, author_id)';
COMMENT ON INDEX paper_authors_ordinal_idx IS 'Optimizes author ordering queries';
COMMENT ON INDEX authors_name_idx IS 'Optimizes author name lookups for batch operations';
COMMENT ON INDEX papers_citation_count_idx IS 'Optimizes ranking by citation count';
COMMENT ON INDEX papers_impact_score_idx IS 'Optimizes ranking by impact score';
COMMENT ON INDEX papers_source_citation_idx IS 'Optimizes source-filtered ranking queries'; 