-- Migration: Add durable generation job queue for worker backend.

CREATE TABLE IF NOT EXISTS generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL UNIQUE REFERENCES generation_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  worker_id TEXT,
  lease_until TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_status_created_at
  ON generation_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_lease_until
  ON generation_jobs(lease_until);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_run_id
  ON generation_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_project_id
  ON generation_jobs(project_id);

CREATE OR REPLACE FUNCTION set_generation_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generation_jobs_updated_at ON generation_jobs;
CREATE TRIGGER trg_generation_jobs_updated_at
BEFORE UPDATE ON generation_jobs
FOR EACH ROW
EXECUTE FUNCTION set_generation_jobs_updated_at();

-- Atomic claim operation with lease acquisition.
-- Claims the oldest pending (or stale running) job.
CREATE OR REPLACE FUNCTION claim_generation_job(
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
    WHERE attempts < max_attempts
      AND (
        status = 'pending'
        OR (status = 'running' AND lease_until IS NOT NULL AND lease_until < NOW())
      )
    ORDER BY created_at ASC
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

-- Extends lease for the currently running worker-owned job.
CREATE OR REPLACE FUNCTION heartbeat_generation_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated INTEGER;
  v_lease_interval INTERVAL;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 THEN
    p_lease_seconds := 30;
  END IF;
  v_lease_interval := make_interval(secs => p_lease_seconds);

  UPDATE generation_jobs
  SET
    lease_until = NOW() + v_lease_interval,
    last_heartbeat_at = NOW()
  WHERE id = p_job_id
    AND status = 'running'
    AND worker_id = p_worker_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;

-- Worker/API operations use service role; no client-side policies are required.
