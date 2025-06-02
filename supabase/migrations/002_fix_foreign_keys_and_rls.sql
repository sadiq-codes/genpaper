/* ───────────────────────────────
   FIX FOREIGN KEYS AND RLS ISSUES
   ─────────────────────────────── */

-- 1. Fix user_id references to point to auth.users instead of public.users
-- Drop existing foreign keys that reference public.users
ALTER TABLE research_projects DROP CONSTRAINT IF EXISTS research_projects_user_id_fkey;
ALTER TABLE library_papers DROP CONSTRAINT IF EXISTS library_papers_user_id_fkey;
ALTER TABLE library_collections DROP CONSTRAINT IF EXISTS library_collections_user_id_fkey;
ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_user_id_fkey;

-- Add proper foreign keys to auth.users
ALTER TABLE research_projects 
ADD CONSTRAINT fk_research_projects_user 
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE library_papers 
ADD CONSTRAINT fk_library_papers_user 
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE library_collections 
ADD CONSTRAINT fk_library_collections_user 
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE tags 
ADD CONSTRAINT fk_tags_user 
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Ensure all other foreign keys are properly named (they should already exist from schema)
-- Just verify they exist with proper names

-- library_papers -> papers
ALTER TABLE library_papers 
DROP CONSTRAINT IF EXISTS library_papers_paper_id_fkey;
ALTER TABLE library_papers 
ADD CONSTRAINT fk_library_papers_paper 
FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE;

-- collection_papers -> library_collections
ALTER TABLE collection_papers 
DROP CONSTRAINT IF EXISTS collection_papers_collection_id_fkey;
ALTER TABLE collection_papers 
ADD CONSTRAINT fk_collection_papers_collection 
FOREIGN KEY (collection_id) REFERENCES library_collections(id) ON DELETE CASCADE;

-- collection_papers -> papers  
ALTER TABLE collection_papers 
DROP CONSTRAINT IF EXISTS collection_papers_paper_id_fkey;
ALTER TABLE collection_papers 
ADD CONSTRAINT fk_collection_papers_paper 
FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE;

-- library_paper_tags -> library_papers
ALTER TABLE library_paper_tags 
DROP CONSTRAINT IF EXISTS library_paper_tags_paper_id_fkey;
ALTER TABLE library_paper_tags 
ADD CONSTRAINT fk_library_paper_tags_paper 
FOREIGN KEY (paper_id) REFERENCES library_papers(id) ON DELETE CASCADE;

-- library_paper_tags -> tags
ALTER TABLE library_paper_tags 
DROP CONSTRAINT IF EXISTS library_paper_tags_tag_id_fkey;
ALTER TABLE library_paper_tags 
ADD CONSTRAINT fk_library_paper_tags_tag 
FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;

-- 3. Add missing RLS policies for collection_papers (was missing from original schema)
ALTER TABLE collection_papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own collection papers" ON collection_papers
FOR SELECT USING (
  auth.uid() = (SELECT user_id FROM library_collections WHERE id = collection_id)
);

CREATE POLICY "Users can manage own collection papers" ON collection_papers
FOR ALL USING (
  auth.uid() = (SELECT user_id FROM library_collections WHERE id = collection_id)
);

-- 4. Add missing RLS policy for library_paper_tags
CREATE POLICY "Users can view own library paper tags" ON library_paper_tags
FOR SELECT USING (
  auth.uid() = (SELECT user_id FROM library_papers WHERE id = paper_id)
);

CREATE POLICY "Users can manage own library paper tags" ON library_paper_tags
FOR ALL USING (
  auth.uid() = (SELECT user_id FROM library_papers WHERE id = paper_id)
);

-- 5. Allow papers to be inserted/updated (for AI generation and manual uploads)
CREATE POLICY "Authenticated users can create papers" ON papers
FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update papers" ON papers  
FOR UPDATE TO authenticated USING (true);

-- 6. Allow authors to be created
CREATE POLICY "Authenticated users can create authors" ON authors
FOR INSERT TO authenticated WITH CHECK (true);

-- 7. Allow paper_authors relationship to be created
CREATE POLICY "Authenticated users can create paper author relationships" ON paper_authors
FOR INSERT TO authenticated WITH CHECK (true);

-- 8. Drop the custom users table since we're using auth.users
DROP TABLE IF EXISTS users CASCADE;

COMMENT ON SCHEMA public IS 'Fixed foreign keys to reference auth.users and added missing RLS policies'; 