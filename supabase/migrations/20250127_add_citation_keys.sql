-- Migration: Add citeKey and first_seen_order to citations
-- Ensures stable references and explicit ordering for render-time numbering

-- Add citeKey column if not present
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'project_citations' 
    AND column_name = 'cite_key'
  ) THEN
    ALTER TABLE project_citations 
    ADD COLUMN cite_key TEXT;
    
    -- Backfill existing citations with generated keys
    UPDATE project_citations 
    SET cite_key = project_id::text || '-' || paper_id::text 
    WHERE cite_key IS NULL;
    
    -- Make it NOT NULL after backfill
    ALTER TABLE project_citations 
    ALTER COLUMN cite_key SET NOT NULL;
    
    RAISE NOTICE 'Added cite_key column and backfilled existing citations';
  ELSE
    RAISE NOTICE 'cite_key column already exists';
  END IF;
END $$;

-- Add first_seen_order column if not present (defaults to number for existing rows)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'project_citations' 
    AND column_name = 'first_seen_order'
  ) THEN
    ALTER TABLE project_citations 
    ADD COLUMN first_seen_order INTEGER;
    
    -- Backfill with existing number (ordered by created_at)
    WITH ordered_citations AS (
      SELECT 
        id,
        ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, number) as order_num
      FROM project_citations
    )
    UPDATE project_citations 
    SET first_seen_order = ordered_citations.order_num
    FROM ordered_citations 
    WHERE project_citations.id = ordered_citations.id;
    
    -- Make it NOT NULL after backfill
    ALTER TABLE project_citations 
    ALTER COLUMN first_seen_order SET NOT NULL;
    
    RAISE NOTICE 'Added first_seen_order column and backfilled with creation order';
  ELSE
    RAISE NOTICE 'first_seen_order column already exists';
  END IF;
END $$;

-- Create index for citeKey lookups
CREATE INDEX IF NOT EXISTS project_citations_cite_key_idx 
ON project_citations (cite_key);

-- Create index for first_seen_order
CREATE INDEX IF NOT EXISTS project_citations_first_seen_order_idx 
ON project_citations (project_id, first_seen_order);

-- Update the add_citation_unified function to populate these fields
CREATE OR REPLACE FUNCTION add_citation_unified(
  p_project_id UUID,
  p_paper_id UUID,
  p_csl_json JSONB,
  p_reason TEXT,
  p_quote TEXT DEFAULT NULL
)
RETURNS TABLE (
  citation_number INTEGER,
  is_new BOOLEAN,
  cite_key TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  existing_number INTEGER;
  existing_cite_key TEXT;
  new_number INTEGER;
  new_cite_key TEXT;
  max_order INTEGER;
BEGIN
  -- Generate cite key
  new_cite_key := p_project_id::text || '-' || p_paper_id::text;
  
  -- Check if citation already exists
  SELECT number, cite_key INTO existing_number, existing_cite_key
  FROM project_citations
  WHERE project_id = p_project_id AND paper_id = p_paper_id;
  
  IF existing_number IS NOT NULL THEN
    -- Return existing citation
    RETURN QUERY SELECT existing_number, false, COALESCE(existing_cite_key, new_cite_key);
  ELSE
    -- Get next number and order
    SELECT COALESCE(MAX(number), 0) + 1, COALESCE(MAX(first_seen_order), 0) + 1
    INTO new_number, max_order
    FROM project_citations
    WHERE project_id = p_project_id;
    
    -- Insert new citation
    INSERT INTO project_citations (
      project_id,
      paper_id,
      number,
      csl_json,
      reason,
      quote,
      cite_key,
      first_seen_order
    ) VALUES (
      p_project_id,
      p_paper_id,
      new_number,
      p_csl_json,
      p_reason,
      p_quote,
      new_cite_key,
      max_order
    );
    
    RETURN QUERY SELECT new_number, true, new_cite_key;
  END IF;
END;
$$;

-- Add comment explaining the columns
COMMENT ON COLUMN project_citations.cite_key IS 'Stable reference key for citations (project_id-paper_id)';
COMMENT ON COLUMN project_citations.first_seen_order IS 'Order in which citations were first added to project (for consistent numbering)';