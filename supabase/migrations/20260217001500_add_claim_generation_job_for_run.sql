-- Migration: Add run-specific claim function for one-shot workers.
-- This lets us launch one worker per generation run safely.

CREATE OR REPLACE FUNCTION claim_generation_job_for_run(
  p_run_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS generation_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  v_claimed generation_jobs;
  v_lease_interval INTERVAL;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 THEN
    p_lease_seconds := 30;
  END IF;
  v_lease_interval := make_interval(secs => p_lease_seconds);

  WITH candidate AS (
    SELECT id
    FROM generation_jobs
    WHERE run_id = p_run_id
      AND attempts < max_attempts
      AND (
        status = 'pending'
        OR (status = 'running' AND lease_until IS NOT NULL AND lease_until < NOW())
      )
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE generation_jobs j
  SET
    status = 'running',
    attempts = j.attempts + 1,
    worker_id = p_worker_id,
    started_at = COALESCE(j.started_at, NOW()),
    lease_until = NOW() + v_lease_interval,
    last_heartbeat_at = NOW(),
    error_message = NULL
  FROM candidate
  WHERE j.id = candidate.id
  RETURNING j.* INTO v_claimed;

  RETURN v_claimed;
END;
$$;
