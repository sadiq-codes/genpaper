-- Transactional functions for block operations
-- Ensures atomicity when creating blocks with citations

-- Function to insert block with citation in a single transaction
CREATE OR REPLACE FUNCTION insert_block_with_citation(
  p_block_id CHAR(26),
  p_document_id UUID,
  p_position NUMERIC(8,4),
  p_content JSONB,
  p_citation_id UUID DEFAULT NULL,
  p_citation_key TEXT DEFAULT NULL,
  p_citation_title TEXT DEFAULT NULL,
  p_citation_authors JSONB DEFAULT NULL,
  p_citation_year INTEGER DEFAULT NULL,
  p_citation_journal TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  -- Insert the block first
  INSERT INTO blocks (
    id, 
    document_id, 
    type, 
    content, 
    "position",
    metadata
  ) VALUES (
    p_block_id,
    p_document_id,
    'citation',
    p_content,
    p_position,
    jsonb_build_object('citationKey', p_citation_key, 'documentId', p_document_id)
  );
  
  -- Insert the citation link if citation data provided
  IF p_citation_key IS NOT NULL THEN
    INSERT INTO block_citations (
      block_id,
      citation_id,
      citation_key,
      title,
      authors,
      year,
      journal
    ) VALUES (
      p_block_id,
      p_citation_id,
      p_citation_key,
      p_citation_title,
      p_citation_authors,
      p_citation_year,
      p_citation_journal
    );
  END IF;
  
  -- Function will automatically commit if no errors
EXCEPTION
  WHEN OTHERS THEN
    -- Rollback happens automatically
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to batch insert multiple blocks efficiently
CREATE OR REPLACE FUNCTION insert_blocks_batch(
  p_blocks JSONB
) RETURNS VOID AS $$
DECLARE
  block_record JSONB;
BEGIN
  -- Validate input
  IF NOT jsonb_typeof(p_blocks) = 'array' THEN
    RAISE EXCEPTION 'p_blocks must be a JSON array';
  END IF;
  
  -- Insert each block
  FOR block_record IN SELECT * FROM jsonb_array_elements(p_blocks)
  LOOP
    INSERT INTO blocks (
      id,
      document_id,
      parent_id,
      type,
      content,
      "position",
      metadata
    ) VALUES (
      (block_record->>'id')::CHAR(26),
      (block_record->>'document_id')::UUID,
      CASE 
        WHEN block_record->>'parent_id' IS NOT NULL 
        THEN (block_record->>'parent_id')::CHAR(26) 
        ELSE NULL 
      END,
      block_record->>'type',
      block_record->'content',
      (block_record->>'position')::NUMERIC(8,4),
      COALESCE(block_record->'metadata', '{}'::JSONB)
    );
  END LOOP;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to update block content and position atomically
CREATE OR REPLACE FUNCTION update_block_content(
  p_block_id CHAR(26),
  p_content JSONB,
  p_position NUMERIC(8,4) DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  -- Verify block exists and user has permission (RLS will handle this)
  IF NOT EXISTS (SELECT 1 FROM blocks WHERE id = p_block_id) THEN
    RAISE EXCEPTION 'Block not found: %', p_block_id;
  END IF;
  
  -- Update content and optionally position
  UPDATE blocks 
  SET 
    content = p_content,
    "position" = COALESCE(p_position, "position"),
    updated_at = now()
  WHERE id = p_block_id;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to reorder blocks efficiently
CREATE OR REPLACE FUNCTION reorder_blocks(
  p_document_id UUID,
  p_block_positions JSONB
) RETURNS VOID AS $$
DECLARE
  position_record JSONB;
BEGIN
  -- Validate input
  IF NOT jsonb_typeof(p_block_positions) = 'array' THEN
    RAISE EXCEPTION 'p_block_positions must be a JSON array of {id, position} objects';
  END IF;
  
  -- Update positions in batch
  FOR position_record IN SELECT * FROM jsonb_array_elements(p_block_positions)
  LOOP
    UPDATE blocks 
    SET 
      "position" = (position_record->>'position')::NUMERIC(8,4),
      updated_at = now()
    WHERE 
      id = (position_record->>'id')::CHAR(26) 
      AND document_id = p_document_id;
  END LOOP;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get blocks for a document with efficient querying
CREATE OR REPLACE FUNCTION get_document_blocks(
  p_document_id UUID,
  p_include_citations BOOLEAN DEFAULT TRUE
) RETURNS TABLE (
  id CHAR(26),
  type TEXT,
  content JSONB,
  "position" NUMERIC(8,4),
  metadata JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  citations JSONB
) AS $$
BEGIN
  IF p_include_citations THEN
    RETURN QUERY
    SELECT 
      b.id,
      b.type,
      b.content,
      b."position",
      b.metadata,
      b.created_at,
      b.updated_at,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', bc.id,
            'citation_key', bc.citation_key,
            'citation_id', bc.citation_id,
            'title', bc.title,
            'authors', bc.authors,
            'year', bc.year,
            'journal', bc.journal
          )
        ) FILTER (WHERE bc.id IS NOT NULL),
        '[]'::JSONB
      ) as citations
    FROM blocks b
    LEFT JOIN block_citations bc ON b.id = bc.block_id
    WHERE b.document_id = p_document_id
    GROUP BY b.id, b.type, b.content, b."position", b.metadata, b.created_at, b.updated_at
    ORDER BY b."position";
  ELSE
    RETURN QUERY
    SELECT 
      b.id,
      b.type,
      b.content,
      b."position",
      b.metadata,
      b.created_at,
      b.updated_at,
      '[]'::JSONB as citations
    FROM blocks b
    WHERE b.document_id = p_document_id
    ORDER BY b."position";
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to delete blocks with cascading citation cleanup
CREATE OR REPLACE FUNCTION delete_blocks_cascade(
  p_block_ids CHAR(26)[]
) RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
  current_row_count INTEGER;
  block_id CHAR(26);
BEGIN
  -- Delete citations first (will be handled by FK CASCADE, but explicit for clarity)
  DELETE FROM block_citations 
  WHERE block_id = ANY(p_block_ids);
  
  -- Delete blocks
  FOREACH block_id IN ARRAY p_block_ids
  LOOP
    DELETE FROM blocks WHERE id = block_id;
    GET DIAGNOSTICS current_row_count = ROW_COUNT;
    deleted_count := deleted_count + current_row_count;
  END LOOP;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION insert_block_with_citation TO authenticated;
GRANT EXECUTE ON FUNCTION insert_blocks_batch TO authenticated;
GRANT EXECUTE ON FUNCTION update_block_content TO authenticated;
GRANT EXECUTE ON FUNCTION reorder_blocks TO authenticated;
GRANT EXECUTE ON FUNCTION get_document_blocks TO authenticated;
GRANT EXECUTE ON FUNCTION delete_blocks_cascade TO authenticated; 