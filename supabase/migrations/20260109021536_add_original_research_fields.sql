-- Migration: Add original research fields to research_projects
-- This supports the new feature allowing users to provide their own research data
-- for generating empirical research papers rather than just literature reviews.

-- Add paper_type column with default to maintain backwards compatibility
ALTER TABLE research_projects 
  ADD COLUMN IF NOT EXISTS paper_type text DEFAULT 'literatureReview';

-- Add original research fields
ALTER TABLE research_projects 
  ADD COLUMN IF NOT EXISTS has_original_research boolean DEFAULT false;

ALTER TABLE research_projects 
  ADD COLUMN IF NOT EXISTS research_question text;

ALTER TABLE research_projects 
  ADD COLUMN IF NOT EXISTS key_findings text;

-- Add index for filtering by paper type
CREATE INDEX IF NOT EXISTS idx_research_projects_paper_type 
  ON research_projects(paper_type);

-- Add index for filtering by original research flag
CREATE INDEX IF NOT EXISTS idx_research_projects_has_original_research 
  ON research_projects(has_original_research);

-- Add comment explaining the fields
COMMENT ON COLUMN research_projects.paper_type IS 
  'Type of paper: researchArticle, literatureReview, capstoneProject, mastersThesis, phdDissertation';

COMMENT ON COLUMN research_projects.has_original_research IS 
  'Whether the user has provided original research data (hypothesis, methodology, results)';

COMMENT ON COLUMN research_projects.research_question IS 
  'The primary research question the paper addresses (required when has_original_research is true)';

COMMENT ON COLUMN research_projects.key_findings IS 
  'Summary of key findings from the user''s original research (required when has_original_research is true)';
