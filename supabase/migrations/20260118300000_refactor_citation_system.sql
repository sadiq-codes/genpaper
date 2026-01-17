-- Migration: Comprehensive Citation System Refactor
-- 
-- This migration implements the ideal citation design:
-- 1. Papers are the source of truth for metadata
-- 2. Foreign keys enforce referential integrity
-- 3. owner_id distinguishes user-uploaded vs global papers
-- 4. CSL JSON is computed on-demand, not stored redundantly
-- 5. Drops unused tables (documents, processing_logs, citations)
--
-- Design principles:
-- - AI writes [CITE: uuid] markers in content
-- - Server validates UUIDs exist in papers table
-- - project_citations links papers to projects
-- - Editor loads papers via FK join

-- ============================================================
-- PHASE 0: Drop unused tables
-- ============================================================

-- These tables have zero references in the codebase
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS processing_logs CASCADE;

-- The 'citations' table was superseded by 'project_citations'
-- All citation functionality now uses project_citations
DROP TABLE IF EXISTS citations CASCADE;

-- ============================================================
-- PHASE 1: Add owner_id to papers table
-- ============================================================

-- Add owner_id column (NULL = global/API paper, UUID = user-uploaded)
ALTER TABLE papers 
ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add is_public flag for user papers they want to share
ALTER TABLE papers
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;

-- Index for filtering by owner
CREATE INDEX IF NOT EXISTS idx_papers_owner_id ON papers(owner_id);

-- Comment documenting the ownership model
COMMENT ON COLUMN papers.owner_id IS 'NULL = global paper from APIs (Semantic Scholar, etc). UUID = user-uploaded paper, private by default.';
COMMENT ON COLUMN papers.is_public IS 'If true, other users can cite this paper. Only applies when owner_id is set.';

-- ============================================================
-- PHASE 2: Add foreign key constraints to project_citations
-- ============================================================

-- First, clean up any orphaned citations that reference non-existent papers
-- This prevents FK constraint from failing
DELETE FROM project_citations 
WHERE paper_id NOT IN (SELECT id FROM papers);

-- Delete citations referencing non-existent projects
DELETE FROM project_citations 
WHERE project_id NOT IN (SELECT id FROM research_projects);

-- Add FK to papers table (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'project_citations_paper_id_fkey'
    AND table_name = 'project_citations'
  ) THEN
    ALTER TABLE project_citations
    ADD CONSTRAINT project_citations_paper_id_fkey
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add FK to research_projects table (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'project_citations_project_id_fkey'
    AND table_name = 'project_citations'
  ) THEN
    ALTER TABLE project_citations
    ADD CONSTRAINT project_citations_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES research_projects(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- PHASE 3: Add/ensure indexes for performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_project_citations_project_id 
ON project_citations(project_id);

CREATE INDEX IF NOT EXISTS idx_project_citations_paper_id 
ON project_citations(paper_id);

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_project_citations_project_paper 
ON project_citations(project_id, paper_id);

-- ============================================================
-- PHASE 4: Add unique constraint for deduplication
-- ============================================================

-- Ensure one citation per paper per project
-- First remove duplicates if any exist
DELETE FROM project_citations a
USING project_citations b
WHERE a.id > b.id 
  AND a.project_id = b.project_id 
  AND a.paper_id = b.paper_id;

-- Add unique constraint (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'project_citations_project_paper_unique'
    AND table_name = 'project_citations'
  ) THEN
    ALTER TABLE project_citations
    ADD CONSTRAINT project_citations_project_paper_unique
    UNIQUE (project_id, paper_id);
  END IF;
END $$;

-- ============================================================
-- PHASE 5: Keep csl_json for now (backward compatibility)
-- ============================================================
-- We'll compute CSL on-demand but keep the column for caching
-- This avoids breaking existing code while we refactor

-- Add updated_at if not exists (for cache invalidation)
ALTER TABLE project_citations
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ============================================================
-- PHASE 6: Add RLS policies for paper ownership
-- ============================================================

-- Papers RLS: Users can see global papers OR their own OR public papers
DO $$
BEGIN
  -- Drop existing policy if it exists
  DROP POLICY IF EXISTS "Users can view accessible papers" ON papers;
  
  -- Create new policy
  CREATE POLICY "Users can view accessible papers" ON papers
    FOR SELECT
    USING (
      owner_id IS NULL  -- Global papers (from APIs)
      OR owner_id = auth.uid()  -- User's own papers
      OR is_public = true  -- Public user papers
    );
END $$;

-- Papers RLS: Users can only update/delete their own papers
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can modify own papers" ON papers;
  
  CREATE POLICY "Users can modify own papers" ON papers
    FOR ALL
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());
END $$;

-- ============================================================
-- Documentation
-- ============================================================

COMMENT ON TABLE project_citations IS 
'Links papers to research projects. One citation per paper per project.
The papers table is the source of truth for metadata.
CSL JSON can be cached here but should be computed from papers data.';

COMMENT ON CONSTRAINT project_citations_paper_id_fkey ON project_citations IS
'Ensures paper_id references a valid paper. Enables Supabase automatic joins with papers(*).';

COMMENT ON CONSTRAINT project_citations_project_id_fkey ON project_citations IS
'Ensures project_id references a valid project. Cascades delete when project is removed.';
