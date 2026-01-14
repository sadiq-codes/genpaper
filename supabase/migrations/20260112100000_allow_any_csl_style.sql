-- Migration: Allow any CSL style ID
-- Removes restrictive check constraints to support 1000+ CSL styles

-- 1. Drop the restrictive check constraints
ALTER TABLE research_projects
DROP CONSTRAINT IF EXISTS valid_citation_style;

ALTER TABLE user_preferences
DROP CONSTRAINT IF EXISTS valid_user_citation_style;

-- 2. Add new looser constraints (just ensure style is not empty if set)
ALTER TABLE research_projects
ADD CONSTRAINT valid_citation_style 
CHECK (citation_style IS NULL OR length(citation_style) > 0 AND length(citation_style) <= 100);

ALTER TABLE user_preferences
ADD CONSTRAINT valid_user_citation_style 
CHECK (length(citation_style) > 0 AND length(citation_style) <= 100);

COMMENT ON COLUMN research_projects.citation_style IS 'Project-specific CSL citation style ID (e.g., apa, ieee, nature, chicago-author-date). NULL means use user default.';
COMMENT ON COLUMN user_preferences.citation_style IS 'User default CSL citation style ID.';
