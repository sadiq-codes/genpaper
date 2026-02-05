-- Add daily usage tracking for free tier limits
-- Free users get 10 chats and 10 autocompletes per day
-- Paid users (starter/pro) get unlimited access

-- Add daily usage tracking columns to profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS chat_uses_today INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS autocomplete_uses_today INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS usage_reset_at DATE NOT NULL DEFAULT CURRENT_DATE;

-- Index for efficient lookups when checking usage
CREATE INDEX IF NOT EXISTS profiles_usage_reset_idx ON profiles(usage_reset_at);

-- Function to check and increment chat usage
-- Returns true if the action is allowed, false if limit reached
CREATE OR REPLACE FUNCTION check_and_increment_chat_usage(
  p_user_id UUID, 
  p_daily_limit INTEGER DEFAULT 10
)
RETURNS TABLE(
  allowed BOOLEAN,
  current_uses INTEGER,
  daily_limit INTEGER,
  resets_at TIMESTAMPTZ
) AS $$
DECLARE
  v_tier TEXT;
  v_current_uses INTEGER;
  v_reset_date DATE;
  v_allowed BOOLEAN := TRUE;
BEGIN
  -- Get current usage and tier
  SELECT subscription_tier, chat_uses_today, usage_reset_at
  INTO v_tier, v_current_uses, v_reset_date
  FROM profiles WHERE id = p_user_id;
  
  -- Paid tiers get unlimited access
  IF v_tier IN ('starter', 'pro') THEN
    RETURN QUERY SELECT 
      TRUE::BOOLEAN, 
      0::INTEGER, 
      -1::INTEGER,  -- -1 indicates unlimited
      (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ;
    RETURN;
  END IF;
  
  -- Reset if new day (UTC)
  IF v_reset_date < CURRENT_DATE THEN
    UPDATE profiles 
    SET chat_uses_today = 0, 
        autocomplete_uses_today = 0, 
        usage_reset_at = CURRENT_DATE
    WHERE id = p_user_id;
    v_current_uses := 0;
  END IF;
  
  -- Check limit
  IF v_current_uses >= p_daily_limit THEN
    v_allowed := FALSE;
  ELSE
    -- Increment usage
    UPDATE profiles 
    SET chat_uses_today = chat_uses_today + 1 
    WHERE id = p_user_id;
    v_current_uses := v_current_uses + 1;
  END IF;
  
  -- Return result
  RETURN QUERY SELECT 
    v_allowed,
    v_current_uses,
    p_daily_limit,
    (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check and increment autocomplete usage
CREATE OR REPLACE FUNCTION check_and_increment_autocomplete_usage(
  p_user_id UUID, 
  p_daily_limit INTEGER DEFAULT 10
)
RETURNS TABLE(
  allowed BOOLEAN,
  current_uses INTEGER,
  daily_limit INTEGER,
  resets_at TIMESTAMPTZ
) AS $$
DECLARE
  v_tier TEXT;
  v_current_uses INTEGER;
  v_reset_date DATE;
  v_allowed BOOLEAN := TRUE;
BEGIN
  -- Get current usage and tier
  SELECT subscription_tier, autocomplete_uses_today, usage_reset_at
  INTO v_tier, v_current_uses, v_reset_date
  FROM profiles WHERE id = p_user_id;
  
  -- Paid tiers get unlimited access
  IF v_tier IN ('starter', 'pro') THEN
    RETURN QUERY SELECT 
      TRUE::BOOLEAN, 
      0::INTEGER, 
      -1::INTEGER,  -- -1 indicates unlimited
      (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ;
    RETURN;
  END IF;
  
  -- Reset if new day (UTC)
  IF v_reset_date < CURRENT_DATE THEN
    UPDATE profiles 
    SET chat_uses_today = 0, 
        autocomplete_uses_today = 0, 
        usage_reset_at = CURRENT_DATE
    WHERE id = p_user_id;
    v_current_uses := 0;
  END IF;
  
  -- Check limit
  IF v_current_uses >= p_daily_limit THEN
    v_allowed := FALSE;
  ELSE
    -- Increment usage
    UPDATE profiles 
    SET autocomplete_uses_today = autocomplete_uses_today + 1 
    WHERE id = p_user_id;
    v_current_uses := v_current_uses + 1;
  END IF;
  
  -- Return result
  RETURN QUERY SELECT 
    v_allowed,
    v_current_uses,
    p_daily_limit,
    (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get current usage stats without incrementing
CREATE OR REPLACE FUNCTION get_daily_usage_stats(p_user_id UUID)
RETURNS TABLE(
  chat_used INTEGER,
  chat_limit INTEGER,
  autocomplete_used INTEGER,
  autocomplete_limit INTEGER,
  resets_at TIMESTAMPTZ,
  is_unlimited BOOLEAN
) AS $$
DECLARE
  v_tier TEXT;
  v_chat_uses INTEGER;
  v_autocomplete_uses INTEGER;
  v_reset_date DATE;
BEGIN
  -- Get current usage and tier
  SELECT subscription_tier, chat_uses_today, autocomplete_uses_today, usage_reset_at
  INTO v_tier, v_chat_uses, v_autocomplete_uses, v_reset_date
  FROM profiles WHERE id = p_user_id;
  
  -- Paid tiers get unlimited
  IF v_tier IN ('starter', 'pro') THEN
    RETURN QUERY SELECT 
      0::INTEGER,
      -1::INTEGER,
      0::INTEGER,
      -1::INTEGER,
      (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ,
      TRUE::BOOLEAN;
    RETURN;
  END IF;
  
  -- Reset if new day
  IF v_reset_date < CURRENT_DATE THEN
    UPDATE profiles 
    SET chat_uses_today = 0, 
        autocomplete_uses_today = 0, 
        usage_reset_at = CURRENT_DATE
    WHERE id = p_user_id;
    v_chat_uses := 0;
    v_autocomplete_uses := 0;
  END IF;
  
  -- Return stats
  RETURN QUERY SELECT 
    v_chat_uses,
    10::INTEGER,  -- Default limit
    v_autocomplete_uses,
    10::INTEGER,  -- Default limit
    (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ,
    FALSE::BOOLEAN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments
COMMENT ON COLUMN profiles.chat_uses_today IS 'Number of chat messages used today (free tier only)';
COMMENT ON COLUMN profiles.autocomplete_uses_today IS 'Number of autocomplete requests used today (free tier only)';
COMMENT ON COLUMN profiles.usage_reset_at IS 'Date when daily usage counters were last reset (UTC)';
