-- Migration: Auto-generate csl_json for project_citations
-- This ensures every citation has proper CSL JSON for rendering

-- Step 1: Create a function to build CSL JSON from paper metadata
CREATE OR REPLACE FUNCTION build_csl_json_from_paper(p_paper_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_paper RECORD;
  v_authors jsonb;
  v_year int;
BEGIN
  -- Fetch paper data
  SELECT id, title, authors, publication_date, venue, doi
  INTO v_paper
  FROM papers
  WHERE id = p_paper_id;
  
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  
  -- Extract year from publication_date
  v_year := EXTRACT(YEAR FROM COALESCE(v_paper.publication_date, NOW()))::int;
  
  -- Build authors array in CSL format
  -- Handle both "Last, First" and "First Last" formats
  SELECT COALESCE(
    jsonb_agg(
      CASE 
        WHEN author_name LIKE '%,%' THEN 
          jsonb_build_object(
            'family', TRIM(SPLIT_PART(author_name, ',', 1)),
            'given', TRIM(SPLIT_PART(author_name, ',', 2))
          )
        WHEN author_name LIKE '% %' THEN 
          jsonb_build_object(
            'family', TRIM((regexp_match(author_name, '(\S+)$'))[1]),
            'given', TRIM(regexp_replace(author_name, '\s+\S+$', ''))
          )
        ELSE 
          jsonb_build_object('family', TRIM(author_name))
      END
    ),
    '[]'::jsonb
  )
  INTO v_authors
  FROM jsonb_array_elements_text(COALESCE(v_paper.authors, '[]'::jsonb)) AS author_name
  WHERE author_name IS NOT NULL AND TRIM(author_name) != '';
  
  -- Build and return CSL JSON
  RETURN jsonb_build_object(
    'type', 'article',
    'title', COALESCE(v_paper.title, 'Untitled'),
    'author', v_authors,
    'issued', jsonb_build_object(
      'date-parts', jsonb_build_array(jsonb_build_array(v_year))
    ),
    'container-title', v_paper.venue,
    'DOI', v_paper.doi
  );
END;
$$;

-- Step 2: Create trigger function to auto-populate csl_json on insert/update
CREATE OR REPLACE FUNCTION auto_populate_citation_csl_json()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only populate if csl_json is NULL and paper_id exists
  IF NEW.csl_json IS NULL AND NEW.paper_id IS NOT NULL THEN
    NEW.csl_json := build_csl_json_from_paper(NEW.paper_id);
  END IF;
  
  -- Also auto-generate cite_key if missing
  IF NEW.cite_key IS NULL AND NEW.project_id IS NOT NULL AND NEW.paper_id IS NOT NULL THEN
    NEW.cite_key := SUBSTRING(NEW.project_id::text FROM 1 FOR 8) || '-' || SUBSTRING(NEW.paper_id::text FROM 1 FOR 8);
  END IF;
  
  -- Auto-set first_seen_order if missing
  IF NEW.first_seen_order IS NULL THEN
    SELECT COALESCE(MAX(first_seen_order), 0) + 1 
    INTO NEW.first_seen_order
    FROM project_citations
    WHERE project_id = NEW.project_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Step 3: Create trigger on project_citations table
DROP TRIGGER IF EXISTS trigger_auto_populate_citation_csl_json ON project_citations;
CREATE TRIGGER trigger_auto_populate_citation_csl_json
  BEFORE INSERT OR UPDATE ON project_citations
  FOR EACH ROW
  EXECUTE FUNCTION auto_populate_citation_csl_json();

-- Step 4: Backfill existing citations that have NULL csl_json
UPDATE project_citations
SET 
  csl_json = build_csl_json_from_paper(paper_id),
  cite_key = COALESCE(cite_key, SUBSTRING(project_id::text FROM 1 FOR 8) || '-' || SUBSTRING(paper_id::text FROM 1 FOR 8)),
  first_seen_order = COALESCE(first_seen_order, citation_number, 1)
WHERE csl_json IS NULL AND paper_id IS NOT NULL;

-- Step 5: Add helpful comments
COMMENT ON FUNCTION build_csl_json_from_paper IS 'Builds CSL-JSON metadata from a paper record for citation formatting';
COMMENT ON FUNCTION auto_populate_citation_csl_json IS 'Trigger function to auto-populate csl_json, cite_key, and first_seen_order on project_citations';
