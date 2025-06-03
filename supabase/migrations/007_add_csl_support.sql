-- Add CSL-JSON column to papers table for citation formatting
ALTER TABLE papers ADD COLUMN IF NOT EXISTS csl_json JSONB;

-- Create index for CSL JSON queries
CREATE INDEX IF NOT EXISTS papers_csl_json_idx ON papers USING gin (csl_json);

-- Function to generate CSL-JSON from existing paper metadata
CREATE OR REPLACE FUNCTION generate_csl_json(paper_row papers)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    authors_array JSONB := '[]'::JSONB;
    author_record RECORD;
    name_parts TEXT[];
    family_name TEXT;
    given_name TEXT;
    paper_type TEXT := 'article-journal';
BEGIN
    -- Determine publication type based on venue
    IF paper_row.venue IS NOT NULL THEN
        IF LOWER(paper_row.venue) LIKE '%conference%' OR LOWER(paper_row.venue) LIKE '%proceedings%' THEN
            paper_type := 'paper-conference';
        ELSIF LOWER(paper_row.venue) LIKE '%arxiv%' OR LOWER(paper_row.venue) LIKE '%preprint%' THEN
            paper_type := 'article';
        END IF;
    END IF;

    -- Build authors array from join
    FOR author_record IN
        SELECT a.name
        FROM paper_authors pa
        JOIN authors a ON a.id = pa.author_id
        WHERE pa.paper_id = paper_row.id
        ORDER BY pa.ordinal
    LOOP
        -- Parse author name intelligently
        IF author_record.name LIKE '%,%' THEN
            -- Format: "Last, First" 
            family_name := trim(split_part(author_record.name, ', ', 1));
            given_name := trim(COALESCE(split_part(author_record.name, ', ', 2), ''));
        ELSE
            -- Format: "First Last" or "First Middle Last"
            name_parts := string_to_array(trim(author_record.name), ' ');
            IF array_length(name_parts, 1) >= 2 THEN
                -- Take last part as family name, rest as given name
                family_name := name_parts[array_length(name_parts, 1)];
                given_name := array_to_string(name_parts[1:array_length(name_parts, 1)-1], ' ');
            ELSE
                -- Single name - put it all in family
                family_name := trim(author_record.name);
                given_name := '';
            END IF;
        END IF;

        -- Only add author if we have a valid family name
        IF family_name IS NOT NULL AND family_name != '' THEN
            authors_array := authors_array || jsonb_build_object(
                'family', family_name,
                'given', COALESCE(given_name, '')
            );
        END IF;
    END LOOP;

    -- Return CSL-JSON object
    RETURN jsonb_build_object(
        'id', paper_row.id,
        'type', paper_type,
        'title', COALESCE(paper_row.title, 'Untitled'),
        'author', authors_array,
        'container-title', paper_row.venue,
        'issued', CASE 
            WHEN paper_row.publication_date IS NOT NULL THEN
                jsonb_build_object(
                    'date-parts', jsonb_build_array(
                        jsonb_build_array(EXTRACT(YEAR FROM paper_row.publication_date))
                    )
                )
            ELSE NULL
        END,
        'DOI', paper_row.doi,
        'URL', paper_row.url,
        'abstract', paper_row.abstract
    );
END;
$$;

-- Backfill CSL JSON for existing papers
UPDATE papers 
SET csl_json = generate_csl_json(papers.*) 
WHERE csl_json IS NULL;

-- Regenerate CSL JSON for all papers to fix author parsing
UPDATE papers 
SET csl_json = generate_csl_json(papers.*);

-- Trigger to auto-generate CSL JSON on paper insert/update
CREATE OR REPLACE FUNCTION update_csl_json()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.csl_json := generate_csl_json(NEW.*);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS papers_csl_json_trigger ON papers;
CREATE TRIGGER papers_csl_json_trigger
    BEFORE INSERT OR UPDATE ON papers
    FOR EACH ROW
    EXECUTE FUNCTION update_csl_json(); 