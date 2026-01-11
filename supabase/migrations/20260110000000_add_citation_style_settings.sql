-- Migration: Add citation style settings
-- Adds citation_style column to research_projects and creates user_preferences table

-- 1. Add citation_style to research_projects (project-level override)
ALTER TABLE research_projects 
ADD COLUMN IF NOT EXISTS citation_style TEXT DEFAULT NULL;

-- Add check constraint for valid citation styles
ALTER TABLE research_projects
ADD CONSTRAINT valid_citation_style 
CHECK (citation_style IS NULL OR citation_style IN ('apa', 'mla', 'chicago', 'ieee', 'harvard'));

COMMENT ON COLUMN research_projects.citation_style IS 'Project-specific citation style override. NULL means use user default.';

-- 2. Create user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  citation_style TEXT DEFAULT 'apa' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Ensure one preference record per user
  CONSTRAINT unique_user_preferences UNIQUE (user_id),
  
  -- Valid citation styles
  CONSTRAINT valid_user_citation_style 
  CHECK (citation_style IN ('apa', 'mla', 'chicago', 'ieee', 'harvard'))
);

-- Enable RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can only access their own preferences
CREATE POLICY "Users can view own preferences" 
ON user_preferences FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences" 
ON user_preferences FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences" 
ON user_preferences FOR UPDATE 
USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- 3. Create function to get effective citation style for a project
CREATE OR REPLACE FUNCTION get_project_citation_style(p_project_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  project_style TEXT;
  user_style TEXT;
BEGIN
  -- First check project-specific setting
  SELECT citation_style INTO project_style
  FROM research_projects
  WHERE id = p_project_id AND user_id = p_user_id;
  
  -- If project has a style set, use it
  IF project_style IS NOT NULL THEN
    RETURN project_style;
  END IF;
  
  -- Otherwise, get user's default
  SELECT citation_style INTO user_style
  FROM user_preferences
  WHERE user_id = p_user_id;
  
  -- Return user's style or default to 'apa'
  RETURN COALESCE(user_style, 'apa');
END;
$$;

-- 4. Create function to upsert user preferences
CREATE OR REPLACE FUNCTION upsert_user_preferences(
  p_user_id UUID,
  p_citation_style TEXT DEFAULT NULL
)
RETURNS user_preferences
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result user_preferences;
BEGIN
  INSERT INTO user_preferences (user_id, citation_style)
  VALUES (
    p_user_id,
    COALESCE(p_citation_style, 'apa')
  )
  ON CONFLICT (user_id) 
  DO UPDATE SET
    citation_style = COALESCE(p_citation_style, user_preferences.citation_style),
    updated_at = NOW()
  RETURNING * INTO result;
  
  RETURN result;
END;
$$;

COMMENT ON FUNCTION get_project_citation_style IS 'Gets effective citation style for a project (project override or user default)';
COMMENT ON FUNCTION upsert_user_preferences IS 'Creates or updates user preferences';
