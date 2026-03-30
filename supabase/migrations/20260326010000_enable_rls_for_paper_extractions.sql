-- Enable RLS for extraction tables created after the original RLS migration.
-- These tables store derived shared paper knowledge, so they follow the same
-- access pattern as papers/paper_chunks/paper_claims:
-- - authenticated users can read
-- - only backend/service paths can write

ALTER TABLE IF EXISTS paper_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS paper_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view paper extractions" ON paper_extractions;
DROP POLICY IF EXISTS "Service role can insert paper extractions" ON paper_extractions;
DROP POLICY IF EXISTS "Service role can update paper extractions" ON paper_extractions;
DROP POLICY IF EXISTS "Service role can delete paper extractions" ON paper_extractions;

CREATE POLICY "Authenticated users can view paper extractions"
  ON paper_extractions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert paper extractions"
  ON paper_extractions FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update paper extractions"
  ON paper_extractions FOR UPDATE
  TO service_role
  USING (true);

CREATE POLICY "Service role can delete paper extractions"
  ON paper_extractions FOR DELETE
  TO service_role
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can view paper findings" ON paper_findings;
DROP POLICY IF EXISTS "Service role can insert paper findings" ON paper_findings;
DROP POLICY IF EXISTS "Service role can update paper findings" ON paper_findings;
DROP POLICY IF EXISTS "Service role can delete paper findings" ON paper_findings;

CREATE POLICY "Authenticated users can view paper findings"
  ON paper_findings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert paper findings"
  ON paper_findings FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update paper findings"
  ON paper_findings FOR UPDATE
  TO service_role
  USING (true);

CREATE POLICY "Service role can delete paper findings"
  ON paper_findings FOR DELETE
  TO service_role
  USING (true);
