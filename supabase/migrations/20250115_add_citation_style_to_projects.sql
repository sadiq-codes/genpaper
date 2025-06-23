-- Migration: Add citation_style to research_projects table
-- This enables user-level citation style preferences for each project

-- Add citation_style column with default APA
ALTER TABLE research_projects 
ADD COLUMN citation_style TEXT DEFAULT 'apa' CHECK (citation_style IN ('apa', 'mla', 'chicago', 'ieee'));

-- Add comment for documentation
COMMENT ON COLUMN research_projects.citation_style IS 'User-preferred citation style for this project (apa, mla, chicago, ieee). Used by frontend for rendering citations from CSL JSON data.'; 