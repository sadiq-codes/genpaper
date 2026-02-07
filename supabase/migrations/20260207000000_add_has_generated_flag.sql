-- Add has_generated flag to research_projects
-- Used to track if a project has ever had a successful generation (for billing)

-- Add the column with default false for new projects
ALTER TABLE research_projects 
ADD COLUMN IF NOT EXISTS has_generated BOOLEAN NOT NULL DEFAULT FALSE;

-- Set existing projects with content to has_generated = true
-- (They were generated before this billing feature existed)
UPDATE research_projects 
SET has_generated = TRUE 
WHERE content IS NOT NULL AND content != '';

-- Create index for efficient billing queries
CREATE INDEX IF NOT EXISTS research_projects_has_generated_idx 
ON research_projects(user_id, has_generated) 
WHERE has_generated = FALSE;

-- Function to mark a project as generated and increment billing
-- Returns TRUE if this was the first generation (billing was incremented)
-- Returns FALSE if already generated (no billing change)
CREATE OR REPLACE FUNCTION mark_project_generated_and_bill(
  p_project_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_already_generated BOOLEAN;
  v_tier TEXT;
  v_used INTEGER;
  v_limit INTEGER;
BEGIN
  -- Check if project was already generated (with row lock)
  SELECT has_generated INTO v_already_generated
  FROM research_projects
  WHERE id = p_project_id AND user_id = p_user_id
  FOR UPDATE;
  
  -- If not found or already generated, return false
  IF v_already_generated IS NULL OR v_already_generated = TRUE THEN
    RETURN FALSE;
  END IF;
  
  -- Get user's subscription info
  SELECT subscription_tier, papers_used_this_period
  INTO v_tier, v_used
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;
  
  -- Determine limit based on tier
  v_limit := CASE v_tier
    WHEN 'free' THEN 1
    WHEN 'starter' THEN 5
    WHEN 'pro' THEN 15
    ELSE 1
  END;
  
  -- Mark project as generated
  UPDATE research_projects
  SET has_generated = TRUE
  WHERE id = p_project_id;
  
  -- Increment usage (even if at limit - the check should happen before generation starts)
  UPDATE profiles
  SET papers_used_this_period = papers_used_this_period + 1
  WHERE id = p_user_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
