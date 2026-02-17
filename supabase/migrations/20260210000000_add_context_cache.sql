-- Migration: Add context_cache column to generation_runs
-- Stores serialized section contexts between generation steps to avoid
-- expensive re-computation (vector search, enrichment) per step.
-- Uses text to store gzip-compressed, base64-encoded JSON.

ALTER TABLE generation_runs
ADD COLUMN IF NOT EXISTS context_cache text;

COMMENT ON COLUMN generation_runs.context_cache IS 'Compressed (gzip+base64) section contexts cached between generation steps. Cleared on finalization.';
