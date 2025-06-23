-- Migration: Add atomic citation creation function
-- This function creates citations and citation links in a single transaction to prevent race conditions

CREATE OR REPLACE FUNCTION create_citation_with_link(
  p_project_id UUID,
  p_citation_key TEXT,
  p_csl_data JSONB,
  p_section TEXT,
  p_reason TEXT,
  p_start_pos INTEGER DEFAULT NULL,
  p_end_pos INTEGER DEFAULT NULL,
  p_context TEXT DEFAULT NULL,
  p_source_paper_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_citation_id UUID;
  v_result JSONB;
BEGIN
  -- First, upsert the citation
  INSERT INTO citations (project_id, key, csl_json)
  VALUES (p_project_id, p_citation_key, p_csl_data)
  ON CONFLICT (project_id, key) 
  DO UPDATE SET 
    csl_json = EXCLUDED.csl_json,
    updated_at = NOW()
  RETURNING id INTO v_citation_id;

  -- Validate source_paper_id exists if provided
  IF p_source_paper_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM papers WHERE id = p_source_paper_id) THEN
      -- Log warning but don't fail - proceed without source link
      p_source_paper_id := NULL;
    END IF;
  END IF;

  -- Create the citation link
  INSERT INTO citation_links (
    project_id,
    citation_id,
    section,
    start_pos,
    end_pos,
    reason,
    context,
    source_paper_id
  ) VALUES (
    p_project_id,
    v_citation_id,
    p_section,
    p_start_pos,
    p_end_pos,
    p_reason,
    p_context,
    p_source_paper_id
  );

  -- Return success with citation info
  SELECT jsonb_build_object(
    'success', true,
    'citation_id', v_citation_id,
    'citation_key', p_citation_key
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION create_citation_with_link TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION create_citation_with_link IS 'Atomically creates or updates a citation and its associated citation link in a single transaction'; 