-- Fix ambiguous column reference in add_citation_unified function
-- The return column "csl_json" conflicts with the table column of the same name

-- Drop and recreate the function with proper table aliases
DROP FUNCTION IF EXISTS add_citation_unified(uuid, uuid, jsonb, text, text);

CREATE OR REPLACE FUNCTION add_citation_unified(
  p_project_id uuid,
  p_paper_id uuid,
  p_csl_json jsonb,
  p_reason text DEFAULT NULL,
  p_quote text DEFAULT NULL
)
RETURNS TABLE (
  is_new boolean,
  cite_key text,
  citation_number integer,
  result_csl_json jsonb  -- Renamed to avoid ambiguity
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_id uuid;
  v_cite_key text;
  v_is_new boolean := true;
  v_citation_number integer;
  v_csl_json jsonb;
BEGIN
  -- Generate a consistent cite_key from project and paper IDs
  v_cite_key := substring(p_project_id::text from 1 for 8) || '-' || substring(p_paper_id::text from 1 for 8);
  
  -- Check if citation already exists for this project+paper combination
  -- Use table alias to avoid column reference ambiguity
  SELECT pc.id, pc.csl_json INTO v_existing_id, v_csl_json
  FROM project_citations pc
  WHERE pc.project_id = p_project_id AND pc.paper_id = p_paper_id
  LIMIT 1;
  
  IF v_existing_id IS NOT NULL THEN
    -- Citation exists, return existing data
    v_is_new := false;
    
    -- Get the citation number (order in project)
    SELECT COUNT(*) INTO v_citation_number
    FROM project_citations pc2
    WHERE pc2.project_id = p_project_id
      AND pc2.created_at <= (SELECT pc3.created_at FROM project_citations pc3 WHERE pc3.id = v_existing_id);
    
    RETURN QUERY SELECT v_is_new, v_cite_key, v_citation_number, v_csl_json;
    RETURN;
  END IF;
  
  -- Calculate next citation number for this project
  SELECT COALESCE(MAX(pc.citation_number), 0) + 1 INTO v_citation_number
  FROM project_citations pc
  WHERE pc.project_id = p_project_id;
  
  -- Insert new citation
  INSERT INTO project_citations (
    project_id,
    paper_id,
    cite_key,
    citation_number,
    first_seen_order,
    csl_json,
    reason,
    quote,
    created_at
  ) VALUES (
    p_project_id,
    p_paper_id,
    v_cite_key,
    v_citation_number,
    v_citation_number,
    p_csl_json,
    p_reason,
    p_quote,
    NOW()
  )
  ON CONFLICT (project_id, paper_id) DO UPDATE SET
    -- Update if concurrent insert happened
    csl_json = COALESCE(EXCLUDED.csl_json, project_citations.csl_json),
    reason = COALESCE(EXCLUDED.reason, project_citations.reason),
    quote = COALESCE(EXCLUDED.quote, project_citations.quote)
  RETURNING project_citations.csl_json INTO v_csl_json;
  
  RETURN QUERY SELECT v_is_new, v_cite_key, v_citation_number, COALESCE(v_csl_json, p_csl_json);
END;
$$;

COMMENT ON FUNCTION add_citation_unified IS 'Add or retrieve a citation for a project. Returns existing citation if paper already cited, or creates new one. Thread-safe with ON CONFLICT handling.';
