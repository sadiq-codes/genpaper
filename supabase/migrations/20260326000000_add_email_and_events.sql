-- Email preferences on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_email_step int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS onboarding_email_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_email_opt_out boolean NOT NULL DEFAULT false;

-- Log of every email sent (debugging + rate awareness)
CREATE TABLE IF NOT EXISTS email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  email_type text NOT NULL,
  subject text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_log_user ON email_log(user_id);
CREATE INDEX IF NOT EXISTS idx_email_log_type ON email_log(email_type, sent_at);

-- Bulk email campaigns
CREATE TABLE IF NOT EXISTS email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  body_html text NOT NULL,
  recipient_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- Lightweight event tracking for metrics + failure analysis
CREATE TABLE IF NOT EXISTS app_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_events_type ON app_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_app_events_user ON app_events(user_id, created_at);

-- RLS policies
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_events ENABLE ROW LEVEL SECURITY;

-- Service role can do everything; users cannot read these directly
CREATE POLICY "Service role full access on email_log"
  ON email_log FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on email_campaigns"
  ON email_campaigns FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on app_events"
  ON app_events FOR ALL USING (true) WITH CHECK (true);
