-- Migration to simplify the generation process from a block-based system
-- to a sentence-based system.

-- This migration will:
-- 1. Drop tables related to the block-based content system.
-- 2. Drop the old versioning table.
-- 3. Drop associated database functions.
-- 4. Add a 'content' column to the 'research_projects' table for storing the full markdown document.

BEGIN;

-- Drop tables first to remove dependencies on functions
DROP TABLE IF EXISTS "public"."block_citations";
DROP TABLE IF EXISTS "public"."research_project_versions";
DROP TABLE IF EXISTS "public"."blocks";
DROP TABLE IF EXISTS "public"."documents";
DROP TABLE IF EXISTS "public"."block_types";

-- Now that tables are gone, drop the functions that depended on them
DROP FUNCTION IF EXISTS "public"."update_document_timestamp"();
DROP FUNCTION IF EXISTS "public"."parse_content_to_blocks"(uuid, text);
DROP FUNCTION IF EXISTS "public"."insert_block_with_citation"(p_block_id char(26), p_document_id uuid, p_position numeric(8,4), p_content jsonb, p_citation_id uuid, p_citation_key text, p_citation_title text, p_citation_authors jsonb, p_citation_year integer, p_citation_journal text);
DROP FUNCTION IF EXISTS "public"."insert_blocks_batch"(p_blocks jsonb);
DROP FUNCTION IF EXISTS "public"."generate_ulid"();


-- Add content column to research_projects
ALTER TABLE "public"."research_projects"
ADD COLUMN "content" TEXT;

COMMENT ON COLUMN "public"."research_projects"."content" IS 'Full markdown content of the generated paper.';

COMMIT; 