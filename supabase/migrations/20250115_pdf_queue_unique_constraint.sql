-- Prevent duplicate PDF processing jobs for same paper+URL combination
-- This ensures idempotent queue operations across deployments

CREATE UNIQUE INDEX IF NOT EXISTS pdf_job_unique
ON pdf_processing_logs(paper_id, pdf_url)
WHERE status IN ('pending','processing');

-- Add comment for documentation
COMMENT ON INDEX pdf_job_unique IS 'Prevents duplicate PDF processing jobs for same paper+URL while job is active';
