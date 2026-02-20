-- Migration: processing_status explicit state machine
-- Canonical statuses:
--   pending         -> metadata only, no chunk-ready content
--   abstract_ready  -> abstract-level chunk(s) ready
--   full_text_ready -> full-text extracted and chunked
--   failed          -> full-text acquisition attempted and failed

-- Drop old check first (old enum blocks writes to abstract_ready/full_text_ready).
ALTER TABLE papers
  DROP CONSTRAINT IF EXISTS papers_processing_status_check;

-- Normalize legacy enum values first (cheap status-only rewrites).
UPDATE papers
SET processing_status = 'full_text_ready'
WHERE processing_status = 'processed';

UPDATE papers
SET processing_status = 'pending'
WHERE processing_status = 'processing' OR processing_status IS NULL;

-- Promote rows that already have full text.
UPDATE papers
SET processing_status = 'full_text_ready'
WHERE processing_status IN ('pending', 'abstract_ready', 'failed')
  AND pdf_content IS NOT NULL
  AND length(pdf_content) > 500;

-- Promote pending rows that already have chunks but no full text.
UPDATE papers p
SET processing_status = 'abstract_ready'
WHERE p.processing_status = 'pending'
  AND (p.pdf_content IS NULL OR length(p.pdf_content) <= 500)
  AND EXISTS (
    SELECT 1
    FROM paper_chunks pc
    WHERE pc.paper_id = p.id
  );

-- Enforce default + non-null for explicit state machine semantics.
ALTER TABLE papers
  ALTER COLUMN processing_status SET DEFAULT 'pending';

UPDATE papers
SET processing_status = 'pending'
WHERE processing_status IS NULL;

ALTER TABLE papers
  ALTER COLUMN processing_status SET NOT NULL;

-- Add new canonical-state check constraint.
ALTER TABLE papers
  ADD CONSTRAINT papers_processing_status_check
  CHECK (processing_status IN ('pending', 'abstract_ready', 'full_text_ready', 'failed'));

COMMENT ON COLUMN papers.processing_status IS
  'Canonical content state: pending, abstract_ready, full_text_ready, failed';
