-- Migration: generation_metrics materialized views + hourly refresh

-- 1. DAILY materialized view (last 24h)
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_generation_metrics AS
SELECT *
FROM generation_metrics
WHERE timestamp >= NOW() - INTERVAL '1 day';

-- 2. WEEKLY materialized view (last 7d)
CREATE MATERIALIZED VIEW IF NOT EXISTS weekly_generation_metrics AS
SELECT *
FROM generation_metrics
WHERE timestamp >= NOW() - INTERVAL '7 day';

-- 3. Indexes to accelerate selects
CREATE INDEX IF NOT EXISTS idx_daily_generation_metrics_timestamp ON daily_generation_metrics (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_generation_metrics_timestamp ON weekly_generation_metrics (timestamp DESC);

-- 4. Set up automatic hourly refresh via pg_cron (requires supabase cron extension)
-- Skip if extension unavailable in local dev
DO $$
BEGIN
  PERFORM cron.schedule('refresh_daily_generation_metrics', '0 * * * *', $$REFRESH MATERIALIZED VIEW CONCURRENTLY daily_generation_metrics;$$);
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'pg_cron not available, skipping cron schedule';
END$$;

DO $$
BEGIN
  PERFORM cron.schedule('refresh_weekly_generation_metrics', '30 * * * *', $$REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_generation_metrics;$$);
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'pg_cron not available, skipping cron schedule';
END$$; 