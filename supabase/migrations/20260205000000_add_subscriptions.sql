-- Add subscription fields to profiles
-- Supports Polar.sh integration for subscription management

-- Add subscription columns to profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS polar_customer_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'free',
ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS polar_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS papers_used_this_period INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS period_started_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS period_ends_at TIMESTAMPTZ;

-- Add constraint for valid tiers
ALTER TABLE profiles 
ADD CONSTRAINT valid_subscription_tier 
CHECK (subscription_tier IN ('free', 'starter', 'pro'));

-- Add constraint for valid subscription status
ALTER TABLE profiles 
ADD CONSTRAINT valid_subscription_status 
CHECK (subscription_status IN ('active', 'canceled', 'past_due', 'trialing'));

-- Index for looking up users by Polar customer ID (webhook handling)
CREATE INDEX IF NOT EXISTS profiles_polar_customer_id_idx 
ON profiles(polar_customer_id) 
WHERE polar_customer_id IS NOT NULL;

-- Subscription events table for audit trail
CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  tier TEXT,
  polar_subscription_id TEXT,
  polar_event_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying events by user
CREATE INDEX IF NOT EXISTS subscription_events_user_id_idx 
ON subscription_events(user_id);

-- Index for querying events by type
CREATE INDEX IF NOT EXISTS subscription_events_type_idx 
ON subscription_events(event_type);

-- Function to reset paper usage at period start
-- Called by webhook when subscription renews
CREATE OR REPLACE FUNCTION reset_paper_usage(p_user_id UUID, p_period_ends_at TIMESTAMPTZ)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET 
    papers_used_this_period = 0,
    period_started_at = NOW(),
    period_ends_at = p_period_ends_at
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to increment paper usage
-- Returns false if limit exceeded
CREATE OR REPLACE FUNCTION increment_paper_usage(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_tier TEXT;
  v_used INTEGER;
  v_limit INTEGER;
BEGIN
  -- Get current tier and usage
  SELECT subscription_tier, papers_used_this_period
  INTO v_tier, v_used
  FROM profiles
  WHERE id = p_user_id;
  
  -- Determine limit based on tier
  v_limit := CASE v_tier
    WHEN 'free' THEN 1
    WHEN 'starter' THEN 5
    WHEN 'pro' THEN 15
    ELSE 1
  END;
  
  -- Check if limit exceeded
  IF v_used >= v_limit THEN
    RETURN FALSE;
  END IF;
  
  -- Increment usage
  UPDATE profiles
  SET papers_used_this_period = papers_used_this_period + 1
  WHERE id = p_user_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS policies for subscription_events
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

-- Users can only see their own subscription events
CREATE POLICY "Users can view own subscription events"
ON subscription_events FOR SELECT
USING (auth.uid() = user_id);

-- Only service role can insert events (via webhooks)
CREATE POLICY "Service role can insert subscription events"
ON subscription_events FOR INSERT
WITH CHECK (TRUE);

-- Comment on columns for documentation
COMMENT ON COLUMN profiles.polar_customer_id IS 'Polar.sh customer ID for this user';
COMMENT ON COLUMN profiles.subscription_tier IS 'Current subscription tier: free, starter, or pro';
COMMENT ON COLUMN profiles.subscription_status IS 'Subscription status: active, canceled, past_due, trialing';
COMMENT ON COLUMN profiles.polar_subscription_id IS 'Polar.sh subscription ID if subscribed';
COMMENT ON COLUMN profiles.papers_used_this_period IS 'Number of papers generated in current billing period';
COMMENT ON COLUMN profiles.period_started_at IS 'Start of current billing period';
COMMENT ON COLUMN profiles.period_ends_at IS 'End of current billing period (null for free tier)';
