-- Automatic quota resets using pg_cron
-- Daily PDF quota resets at midnight
-- Monthly OCR quota resets on first day of month

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Daily PDF quota reset (runs at midnight UTC)
SELECT cron.schedule(
  'daily-pdf-quota-reset',
  '0 0 * * *', -- Every day at midnight
  $$
  UPDATE user_quotas 
  SET daily_pdf_used = 0, 
      last_reset = now() 
  WHERE last_reset < date_trunc('day', now());
  $$
);

-- Monthly OCR quota reset (runs at midnight on 1st of each month)
SELECT cron.schedule(
  'monthly-ocr-quota-reset', 
  '0 0 1 * *', -- 1st day of every month at midnight
  $$
  UPDATE user_quotas 
  SET monthly_ocr_used = 0,
      last_reset = now()
  WHERE date_trunc('month', last_reset) < date_trunc('month', now());
  $$
);

-- Add indexes for efficient quota queries
CREATE INDEX IF NOT EXISTS idx_user_quotas_last_reset ON user_quotas(last_reset);
CREATE INDEX IF NOT EXISTS idx_user_quotas_user_id ON user_quotas(user_id);

-- Add comments for documentation
COMMENT ON EXTENSION pg_cron IS 'Automatic quota reset scheduling';
COMMENT ON INDEX idx_user_quotas_last_reset IS 'Efficient quota reset queries';
