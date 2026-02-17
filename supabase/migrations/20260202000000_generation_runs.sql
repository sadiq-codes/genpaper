-- Migration: Add generation_runs and generation_events tables for resumable generation
-- This enables event-sourced generation that survives network disconnects and browser minimization

-- generation_runs: Tracks each generation attempt
CREATE TABLE generation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current_stage TEXT,
  current_section TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

-- generation_events: Event log for streaming replay
-- Uses BIGSERIAL for efficient ordering and Last-Event-ID support
CREATE TABLE generation_events (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('progress', 'text_chunk', 'section_start', 'section_complete', 'complete', 'error', 'cancelled')),
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_generation_runs_project ON generation_runs(project_id);
CREATE INDEX idx_generation_runs_user ON generation_runs(user_id);
CREATE INDEX idx_generation_runs_status ON generation_runs(status) WHERE status = 'running';
CREATE INDEX idx_generation_runs_expires ON generation_runs(expires_at);

-- Events are queried by run_id, ordered by id (for streaming replay)
CREATE INDEX idx_generation_events_run_id ON generation_events(run_id, id);
-- For cleanup job - delete old events
CREATE INDEX idx_generation_events_created ON generation_events(created_at);

-- RLS Policies
ALTER TABLE generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_events ENABLE ROW LEVEL SECURITY;

-- Users can only see their own generation runs
CREATE POLICY "Users can view own generation runs"
  ON generation_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generation runs"
  ON generation_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own generation runs"
  ON generation_runs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own generation runs"
  ON generation_runs FOR DELETE
  USING (auth.uid() = user_id);

-- Events inherit access from their parent run
CREATE POLICY "Users can view events for own runs"
  ON generation_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM generation_runs
      WHERE generation_runs.id = generation_events.run_id
      AND generation_runs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert events for own runs"
  ON generation_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM generation_runs
      WHERE generation_runs.id = generation_events.run_id
      AND generation_runs.user_id = auth.uid()
    )
  );

-- Service role needs full access for background jobs
-- This is handled by using service role key in server-side code

-- Function to get events after a given ID (for Last-Event-ID support)
CREATE OR REPLACE FUNCTION get_generation_events_after(
  p_run_id UUID,
  p_after_id BIGINT DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
  event_type TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT id, event_type, payload, created_at
  FROM generation_events
  WHERE run_id = p_run_id AND id > p_after_id
  ORDER BY id ASC;
$$;

-- Function to cancel running generations for a project (used when starting new generation)
CREATE OR REPLACE FUNCTION cancel_running_generations(
  p_project_id UUID,
  p_exclude_run_id UUID DEFAULT NULL
)
RETURNS SETOF generation_runs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE generation_runs
  SET 
    status = 'cancelled',
    completed_at = NOW()
  WHERE 
    project_id = p_project_id
    AND status IN ('pending', 'running')
    AND (p_exclude_run_id IS NULL OR id != p_exclude_run_id)
  RETURNING *;
END;
$$;

-- Function to clean up expired runs and events (called by cron job)
CREATE OR REPLACE FUNCTION cleanup_expired_generation_data()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete expired runs (cascade will delete events)
  DELETE FROM generation_runs
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
