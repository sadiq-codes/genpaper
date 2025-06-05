-- Migration: Comprehensive Database Constraints and Indexes
-- Ensures all citation system constraints are properly enforced
-- Addresses Section 1 issues from tasks.md

-- =======================
-- 1. VERIFY AND STRENGTHEN FOREIGN KEY CONSTRAINTS
-- =======================

-- Ensure citation_links.citation_id FK constraint exists (defensive check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'citation_links_citation_id_fkey'
    AND table_name = 'citation_links'
    AND constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE citation_links 
    ADD CONSTRAINT citation_links_citation_id_fkey 
    FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE;
    RAISE NOTICE 'Added missing FK constraint: citation_links.citation_id -> citations.id';
  ELSE
    RAISE NOTICE 'FK constraint citation_links.citation_id -> citations.id already exists';
  END IF;
END $$;

-- =======================
-- 2. VERIFY AND STRENGTHEN UNIQUE CONSTRAINTS
-- =======================

-- Ensure UNIQUE constraint on (project_id, key) exists (defensive check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'citations_project_id_key_key'
    AND table_name = 'citations'
    AND constraint_type = 'UNIQUE'
  ) THEN
    -- Check if there's a unique index instead
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE indexname = 'citations_project_id_key_key'
      AND tablename = 'citations'
    ) THEN
      ALTER TABLE citations ADD CONSTRAINT citations_project_id_key_unique UNIQUE (project_id, key);
      RAISE NOTICE 'Added missing UNIQUE constraint: citations(project_id, key)';
    ELSE
      RAISE NOTICE 'UNIQUE index on citations(project_id, key) already exists';
    END IF;
  ELSE
    RAISE NOTICE 'UNIQUE constraint on citations(project_id, key) already exists';
  END IF;
END $$;

-- =======================
-- 3. ADD COMPREHENSIVE DATA VALIDATION CONSTRAINTS
-- =======================

-- Ensure citation keys are not empty (if not already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'citations_key_not_empty'
  ) THEN
    ALTER TABLE citations ADD CONSTRAINT citations_key_not_empty 
    CHECK (length(trim(key)) > 0);
    RAISE NOTICE 'Added constraint: citations_key_not_empty';
  END IF;
END $$;

-- Ensure CSL JSON is not empty (if not already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'citations_csl_json_not_empty'
  ) THEN
    ALTER TABLE citations ADD CONSTRAINT citations_csl_json_not_empty 
    CHECK (csl_json != '{}'::jsonb AND csl_json IS NOT NULL);
    RAISE NOTICE 'Added constraint: citations_csl_json_not_empty';
  END IF;
END $$;

-- Ensure citation links have valid positional data
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'citation_links_valid_positions'
  ) THEN
    ALTER TABLE citation_links ADD CONSTRAINT citation_links_valid_positions 
    CHECK (start_pos >= 0 AND end_pos >= start_pos);
    RAISE NOTICE 'Added constraint: citation_links_valid_positions';
  END IF;
END $$;

-- Ensure section names are not empty
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'citation_links_section_not_empty'
  ) THEN
    ALTER TABLE citation_links ADD CONSTRAINT citation_links_section_not_empty 
    CHECK (length(trim(section)) > 0);
    RAISE NOTICE 'Added constraint: citation_links_section_not_empty';
  END IF;
END $$;

-- Ensure reason is not empty
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'citation_links_reason_not_empty'
  ) THEN
    ALTER TABLE citation_links ADD CONSTRAINT citation_links_reason_not_empty 
    CHECK (length(trim(reason)) > 0);
    RAISE NOTICE 'Added constraint: citation_links_reason_not_empty';
  END IF;
END $$;

-- =======================
-- 4. COMPREHENSIVE PERFORMANCE INDEXES
-- =======================

-- Primary lookup indexes
CREATE INDEX IF NOT EXISTS citations_project_key_lookup_idx ON citations (project_id, key);
CREATE INDEX IF NOT EXISTS citation_links_project_lookup_idx ON citation_links (project_id);
CREATE INDEX IF NOT EXISTS citation_links_citation_lookup_idx ON citation_links (citation_id);

-- CSL JSON search index for content-based queries
CREATE INDEX IF NOT EXISTS citations_csl_json_gin_idx ON citations USING gin (csl_json);

-- Temporal indexes for ordering and filtering
CREATE INDEX IF NOT EXISTS citations_created_at_idx ON citations (created_at DESC);
CREATE INDEX IF NOT EXISTS citations_updated_at_idx ON citations (updated_at DESC);
CREATE INDEX IF NOT EXISTS citation_links_created_at_idx ON citation_links (created_at DESC);

-- Positional search indexes for future text editor integration
CREATE INDEX IF NOT EXISTS citation_links_start_pos_idx ON citation_links (start_pos);
CREATE INDEX IF NOT EXISTS citation_links_end_pos_idx ON citation_links (end_pos);
CREATE INDEX IF NOT EXISTS citation_links_section_idx ON citation_links (section);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS citations_project_updated_idx ON citations (project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS citation_links_project_section_idx ON citation_links (project_id, section);

-- =======================
-- 5. ENHANCED UPSERT FUNCTION WITH PROPER RETURN TYPE
-- =======================

-- Update upsert function to have proper return type and enhanced validation
CREATE OR REPLACE FUNCTION upsert_citation(
  p_project_id UUID,
  p_key TEXT,
  p_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result citations;
  cleaned_key TEXT;
BEGIN
  -- Input validation
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'Project ID cannot be null';
  END IF;
  
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'Citation key cannot be empty or null';
  END IF;
  
  IF p_data IS NULL OR p_data = '{}'::jsonb THEN
    RAISE EXCEPTION 'CSL JSON cannot be empty or null';
  END IF;

  -- Clean and validate the key
  cleaned_key := trim(p_key);
  
  -- Ensure the project exists and user has access
  IF NOT EXISTS (
    SELECT 1 FROM research_projects 
    WHERE id = p_project_id 
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Project not found or access denied';
  END IF;

  -- Upsert the citation
  INSERT INTO citations (project_id, key, csl_json)
  VALUES (p_project_id, cleaned_key, p_data)
  ON CONFLICT (project_id, key) 
  DO UPDATE SET 
    csl_json = EXCLUDED.csl_json,
    updated_at = now()
  RETURNING * INTO result;
  
  -- Return the result as JSONB
  RETURN to_jsonb(result);
  
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Citation key already exists for this project';
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'Invalid project ID or foreign key constraint violation';
  WHEN check_violation THEN
    RAISE EXCEPTION 'Data validation failed: %', SQLERRM;
END;
$$;

-- =======================
-- 6. ADD HELPER FUNCTION FOR CITATION VALIDATION
-- =======================

-- Function to validate citation data before insertion
CREATE OR REPLACE FUNCTION validate_citation_data(p_data JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check for required CSL fields
  IF NOT (p_data ? 'title') THEN
    RAISE EXCEPTION 'Citation must have a title';
  END IF;
  
  IF NOT (p_data ? 'type') THEN
    RAISE EXCEPTION 'Citation must have a type';
  END IF;
  
  -- Validate title is not empty
  IF p_data->>'title' IS NULL OR length(trim(p_data->>'title')) = 0 THEN
    RAISE EXCEPTION 'Citation title cannot be empty';
  END IF;
  
  RETURN TRUE;
END;
$$;

-- =======================
-- 7. ADD CLEANUP FUNCTION FOR ORPHANED DATA
-- =======================

-- Function to clean up any orphaned citation links (defensive)
CREATE OR REPLACE FUNCTION cleanup_orphaned_citation_links()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM citation_links 
  WHERE citation_id NOT IN (SELECT id FROM citations);
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  IF deleted_count > 0 THEN
    RAISE NOTICE 'Cleaned up % orphaned citation links', deleted_count;
  END IF;
  
  RETURN deleted_count;
END;
$$;

-- Run the cleanup function once
SELECT cleanup_orphaned_citation_links();

-- =======================
-- 8. VERIFY ALL CONSTRAINTS ARE IN PLACE
-- =======================

-- Create a verification function
CREATE OR REPLACE FUNCTION verify_citation_constraints()
RETURNS TABLE (
  constraint_type TEXT,
  constraint_name TEXT,
  table_name TEXT,
  status TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'FOREIGN KEY'::TEXT,
    'citation_links_citation_id_fkey'::TEXT,
    'citation_links'::TEXT,
    CASE 
      WHEN EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'citation_links_citation_id_fkey'
        AND table_name = 'citation_links'
        AND constraint_type = 'FOREIGN KEY'
      ) THEN '✅ EXISTS'
      ELSE '❌ MISSING'
    END::TEXT
  
  UNION ALL
  
  SELECT 
    'UNIQUE'::TEXT,
    'citations_project_id_key'::TEXT,
    'citations'::TEXT,
    CASE 
      WHEN EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'citations'
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE '%project_id%key%'
      ) OR EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'citations'
        AND indexdef LIKE '%UNIQUE%'
        AND indexdef LIKE '%project_id%'
        AND indexdef LIKE '%key%'
      ) THEN '✅ EXISTS'
      ELSE '❌ MISSING'
    END::TEXT;
END;
$$;

-- Run verification
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE '=== CITATION SYSTEM CONSTRAINT VERIFICATION ===';
  FOR rec IN SELECT * FROM verify_citation_constraints() LOOP
    RAISE NOTICE '% % on %: %', 
      rec.constraint_type, 
      rec.constraint_name, 
      rec.table_name, 
      rec.status;
  END LOOP;
  RAISE NOTICE '=== VERIFICATION COMPLETE ===';
END $$; 