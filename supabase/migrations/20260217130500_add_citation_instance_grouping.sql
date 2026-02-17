-- Migration: Persist multi-cite grouping metadata on citation_instances
-- Purpose: preserve explicit [@id1; @id2] cluster intent after conversion

ALTER TABLE citation_instances
  ADD COLUMN IF NOT EXISTS citation_group_id uuid;

ALTER TABLE citation_instances
  ADD COLUMN IF NOT EXISTS citation_group_order integer;

ALTER TABLE citation_instances
  ADD COLUMN IF NOT EXISTS group_required boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_citation_instances_group_lookup
  ON citation_instances(project_id, citation_group_id, citation_group_order);

COMMENT ON COLUMN citation_instances.citation_group_id IS
  'Optional group identifier for citation instances that originated from an explicit multi-cite cluster.';

COMMENT ON COLUMN citation_instances.citation_group_order IS
  'Order of a citation instance inside its multi-cite group (0-based).';

COMMENT ON COLUMN citation_instances.group_required IS
  'True when citation originated from an explicit multi-cite marker and should be considered groupable by renderers.';
