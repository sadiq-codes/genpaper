-- Add missing citation fields to papers table
-- These fields are shown in the citation modal but not currently tracked

-- Add volume, issue, and page fields
ALTER TABLE papers 
ADD COLUMN IF NOT EXISTS volume TEXT,
ADD COLUMN IF NOT EXISTS issue TEXT,
ADD COLUMN IF NOT EXISTS page_range TEXT,
ADD COLUMN IF NOT EXISTS publisher TEXT,
ADD COLUMN IF NOT EXISTS isbn TEXT,
ADD COLUMN IF NOT EXISTS issn TEXT;

-- Update the CSL JSON generation function to include new fields
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

    -- Return enhanced CSL-JSON object with new fields
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
        'abstract', paper_row.abstract,
        'volume', paper_row.volume,
        'issue', paper_row.issue,
        'page', paper_row.page_range,
        'publisher', paper_row.publisher,
        'ISBN', paper_row.isbn,
        'ISSN', paper_row.issn
    );
END;
$$;

-- Regenerate CSL JSON for all papers to include new fields
UPDATE papers 
SET csl_json = generate_csl_json(papers.*);

-- Add indexes for the new fields
CREATE INDEX IF NOT EXISTS papers_volume_idx ON papers(volume) WHERE volume IS NOT NULL;
CREATE INDEX IF NOT EXISTS papers_issue_idx ON papers(issue) WHERE issue IS NOT NULL;
CREATE INDEX IF NOT EXISTS papers_isbn_idx ON papers(isbn) WHERE isbn IS NOT NULL;
CREATE INDEX IF NOT EXISTS papers_issn_idx ON papers(issn) WHERE issn IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN papers.volume IS 'Journal volume number';
COMMENT ON COLUMN papers.issue IS 'Journal issue number';
COMMENT ON COLUMN papers.page_range IS 'Page range (e.g., 123-145)';
COMMENT ON COLUMN papers.publisher IS 'Publisher name';
COMMENT ON COLUMN papers.isbn IS 'ISBN for books';
COMMENT ON COLUMN papers.issn IS 'ISSN for journals'; 