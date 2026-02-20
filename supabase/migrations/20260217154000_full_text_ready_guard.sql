-- Enforce write-time invariants for full_text_ready.
-- full_text_ready means valid full text is persisted and source is trustworthy.

-- Canonicalize missing/invalid content_source for valid full-text rows.
UPDATE papers
SET content_source = 'pdf'
WHERE processing_status = 'full_text_ready'
  AND pdf_content IS NOT NULL
  AND length(pdf_content) >= 500
  AND (content_source IS NULL OR content_source NOT IN ('pdf', 'html'));

-- Downgrade invalid full_text_ready rows so the guard can be enforced safely.
UPDATE papers
SET processing_status = 'abstract_ready'
WHERE processing_status = 'full_text_ready'
  AND (
    pdf_content IS NULL
    OR length(pdf_content) < 500
    OR content_source IS NULL
    OR content_source NOT IN ('pdf', 'html')
  );

ALTER TABLE papers
  DROP CONSTRAINT IF EXISTS papers_processing_status_full_text_guard_check;

ALTER TABLE papers
  ADD CONSTRAINT papers_processing_status_full_text_guard_check
  CHECK (
    processing_status <> 'full_text_ready'
    OR (
      pdf_content IS NOT NULL
      AND length(pdf_content) >= 500
      AND content_source IN ('pdf', 'html')
    )
  );
