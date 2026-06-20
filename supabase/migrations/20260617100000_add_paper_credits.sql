-- Migration: Add paper_credits column to profiles for pay-per-paper
-- $7.99 purchase = 1 paper, papers never expire

-- Add paper_credits column to profiles (stores purchased paper count)
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS paper_credits INTEGER NOT NULL DEFAULT 0;

-- Add comment explaining the column
COMMENT ON COLUMN profiles.paper_credits IS 
  'Purchased papers available. $7.99 = 1 paper. Never expire.';

-- Create function to increment purchased papers (called after successful $7.99 payment)
CREATE OR REPLACE FUNCTION increment_paper_credits(p_user_id UUID, p_amount INTEGER DEFAULT 1)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_total INTEGER;
BEGIN
  UPDATE profiles
  SET paper_credits = paper_credits + p_amount
  WHERE id = p_user_id
  RETURNING paper_credits INTO v_new_total;
  
  RETURN COALESCE(v_new_total, 0);
END;
$$;

-- Create function to use a purchased paper for generation
-- Returns false if no papers available
CREATE OR REPLACE FUNCTION use_paper_credit(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Try to decrement if user has purchased papers
  UPDATE profiles
  SET paper_credits = paper_credits - 1
  WHERE id = p_user_id
    AND paper_credits > 0;
  
  -- Return true if we successfully decremented
  RETURN FOUND;
END;
$$;

-- Create function to get available credits
CREATE OR REPLACE FUNCTION get_paper_credits(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_credits INTEGER;
BEGIN
  SELECT paper_credits INTO v_credits
  FROM profiles
  WHERE id = p_user_id;
  
  RETURN COALESCE(v_credits, 0);
END;
$$;

-- Add index for efficient lookups of users with credits
CREATE INDEX IF NOT EXISTS idx_profiles_paper_credits 
ON profiles(paper_credits) 
WHERE paper_credits > 0;
