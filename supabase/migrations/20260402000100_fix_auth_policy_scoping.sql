-- Fix policy role scoping for service-role-only tables.
-- Previous policies were created without explicit TO clauses, which made them
-- apply to broader roles than intended.

-- -----------------------------------------------------------------------------
-- email_log
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access on email_log" ON email_log;

CREATE POLICY "Service role full access on email_log"
  ON email_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- email_campaigns
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access on email_campaigns" ON email_campaigns;

CREATE POLICY "Service role full access on email_campaigns"
  ON email_campaigns
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- app_events
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role full access on app_events" ON app_events;

CREATE POLICY "Service role full access on app_events"
  ON app_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- subscription_events
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role can insert subscription events" ON subscription_events;

CREATE POLICY "Service role can insert subscription events"
  ON subscription_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);
