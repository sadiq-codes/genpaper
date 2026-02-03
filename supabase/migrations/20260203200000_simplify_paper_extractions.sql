-- Migration: Simplify Paper Extractions Schema
-- Description: Replace complex type-specific schema with flexible findings-based approach
-- Part of: Synthesis Engine v2 - Simplified Schema

-- =============================================================================
-- Drop Old Tables (if exist)
-- =============================================================================

-- Drop dependent objects first
DROP FUNCTION IF EXISTS get_paper_extraction(UUID);
DROP FUNCTION IF EXISTS get_findings_by_direction(UUID[], TEXT);
DROP FUNCTION IF EXISTS aggregate_findings(UUID[]);
DROP TRIGGER IF EXISTS paper_extractions_updated_at ON paper_extractions;
DROP FUNCTION IF EXISTS update_paper_extractions_updated_at();

-- Drop old tables
DROP TABLE IF EXISTS paper_findings;
DROP TABLE IF EXISTS paper_extractions;

-- =============================================================================
-- Paper Extractions Table (Simplified)
-- =============================================================================

CREATE TABLE paper_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  extraction_version INTEGER NOT NULL DEFAULT 1,
  
  -- Metadata (JSONB - flexible, LLM-extracted)
  metadata JSONB NOT NULL,
  -- Expected structure: { title, authors, year, domain, paperType, methodology }
  
  -- Findings (JSONB array - the core unit)
  findings JSONB NOT NULL DEFAULT '[]',
  -- Expected structure: [{ id, claim, evidence, value, valueType, direction, comparedTo, context, isMainFinding, confidence }]
  
  -- Summary
  research_question TEXT,
  contributions JSONB NOT NULL DEFAULT '[]',  -- string[]
  limitations JSONB NOT NULL DEFAULT '[]',    -- string[]
  
  -- Extraction quality
  extraction_confidence FLOAT NOT NULL CHECK (extraction_confidence >= 0 AND extraction_confidence <= 1),
  extraction_notes JSONB NOT NULL DEFAULT '[]',  -- string[]
  
  -- Timestamps
  extracted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  extraction_time_ms INTEGER,
  model_used TEXT NOT NULL,
  
  -- Constraints
  UNIQUE(paper_id, extraction_version)
);

-- Indexes
CREATE INDEX idx_paper_extractions_paper_id ON paper_extractions(paper_id);
CREATE INDEX idx_paper_extractions_confidence ON paper_extractions(extraction_confidence);
CREATE INDEX idx_paper_extractions_extracted_at ON paper_extractions(extracted_at);

-- GIN index for JSONB searches
CREATE INDEX idx_paper_extractions_metadata_gin ON paper_extractions USING GIN (metadata);
CREATE INDEX idx_paper_extractions_findings_gin ON paper_extractions USING GIN (findings);

-- =============================================================================
-- Paper Findings Table (Simplified, Normalized)
-- =============================================================================

CREATE TABLE paper_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  extraction_id UUID NOT NULL REFERENCES paper_extractions(id) ON DELETE CASCADE,
  
  -- Core finding data (all text - flexible, LLM describes)
  claim TEXT NOT NULL,
  evidence TEXT NOT NULL,
  
  -- Value (optional - LLM extracts in natural format)
  value TEXT,                    -- "24%", "β=0.34", "n=200", etc.
  value_type TEXT,               -- LLM describes: "percentage", "correlation", etc.
  
  -- Direction (optional - LLM interprets)
  direction TEXT,                -- "positive", "negative", "descriptive", etc.
  
  -- Context (optional)
  compared_to TEXT,              -- What this compares against
  context TEXT,                  -- Population, setting, conditions
  
  -- Importance
  is_main_finding BOOLEAN NOT NULL DEFAULT false,
  
  -- Quality
  confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  
  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_paper_findings_paper_id ON paper_findings(paper_id);
CREATE INDEX idx_paper_findings_extraction_id ON paper_findings(extraction_id);
CREATE INDEX idx_paper_findings_is_main ON paper_findings(is_main_finding);
CREATE INDEX idx_paper_findings_direction ON paper_findings(direction) WHERE direction IS NOT NULL;
CREATE INDEX idx_paper_findings_confidence ON paper_findings(confidence);

-- Full text search on claims
CREATE INDEX idx_paper_findings_claim_search ON paper_findings USING GIN (to_tsvector('english', claim));

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE paper_extractions IS 'Flexible extraction of findings from academic papers - LLM discovers structure';
COMMENT ON TABLE paper_findings IS 'Normalized findings for cross-document analysis';
COMMENT ON COLUMN paper_extractions.metadata IS 'Paper metadata: { title, authors, year, domain, paperType, methodology }';
COMMENT ON COLUMN paper_extractions.findings IS 'Array of findings with claims, evidence, values';
COMMENT ON COLUMN paper_findings.value IS 'Quantitative value in natural format (e.g., "24%", "β=0.34")';
COMMENT ON COLUMN paper_findings.value_type IS 'LLM-described type of value (e.g., "percentage", "correlation")';
COMMENT ON COLUMN paper_findings.direction IS 'Nature of finding (e.g., "positive", "negative", "descriptive")';
