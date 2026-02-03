-- Migration: Add Paper Extractions Tables
-- Description: Structured extraction of claims, findings, and analysis from papers
-- Part of: Synthesis Engine v2 - Phase 1

-- =============================================================================
-- Paper Extractions Table
-- Stores structured extraction results for each paper
-- =============================================================================

CREATE TABLE IF NOT EXISTS paper_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  extraction_version INTEGER NOT NULL DEFAULT 1,
  
  -- Classification
  paper_type TEXT NOT NULL CHECK (paper_type IN (
    'quantitative', 'qualitative', 'mixed_methods', 'theoretical',
    'review', 'humanities', 'case_study', 'methodological', 'commentary', 'unknown'
  )),
  paper_type_confidence FLOAT NOT NULL CHECK (paper_type_confidence >= 0 AND paper_type_confidence <= 1),
  secondary_type TEXT CHECK (secondary_type IN (
    'quantitative', 'qualitative', 'mixed_methods', 'theoretical',
    'review', 'humanities', 'case_study', 'methodological', 'commentary', 'unknown'
  )),
  
  -- Core extraction (JSONB for flexibility)
  core_extraction JSONB NOT NULL,
  
  -- Extension extractions (nullable - only present for relevant paper types)
  quantitative_extension JSONB,
  qualitative_extension JSONB,
  theoretical_extension JSONB,
  humanities_extension JSONB,
  review_extension JSONB,
  
  -- Metadata
  overall_confidence FLOAT NOT NULL CHECK (overall_confidence >= 0 AND overall_confidence <= 1),
  validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'validated', 'rejected')),
  validation_notes TEXT[],
  
  -- Timestamps
  extracted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Extraction info
  model_used TEXT NOT NULL,
  extraction_time_ms INTEGER,
  
  -- Constraints
  UNIQUE(paper_id, extraction_version)
);

-- Index for paper lookups
CREATE INDEX idx_paper_extractions_paper_id ON paper_extractions(paper_id);

-- Index for paper type filtering
CREATE INDEX idx_paper_extractions_paper_type ON paper_extractions(paper_type);

-- Index for confidence filtering
CREATE INDEX idx_paper_extractions_confidence ON paper_extractions(overall_confidence);

-- Index for validation status
CREATE INDEX idx_paper_extractions_validation ON paper_extractions(validation_status);

-- GIN index for JSONB searches in core extraction
CREATE INDEX idx_paper_extractions_core_gin ON paper_extractions USING GIN (core_extraction);

-- =============================================================================
-- Paper Findings Table
-- Normalized findings for easier querying and cross-document analysis
-- =============================================================================

CREATE TABLE IF NOT EXISTS paper_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  extraction_id UUID NOT NULL REFERENCES paper_extractions(id) ON DELETE CASCADE,
  
  -- Finding identification
  finding_type TEXT NOT NULL CHECK (finding_type IN (
    'statistical', 'thematic', 'interpretive', 'theoretical', 'claim'
  )),
  
  -- Content
  description TEXT NOT NULL,
  raw_quote TEXT,
  section_source TEXT CHECK (section_source IN (
    'abstract', 'introduction', 'literature_review', 'theory',
    'methodology', 'results', 'discussion', 'conclusion', 'unknown'
  )),
  
  -- For statistical findings
  effect_size FLOAT,
  effect_size_type TEXT CHECK (effect_size_type IN (
    'cohens_d', 'hedges_g', 'odds_ratio', 'risk_ratio', 'hazard_ratio',
    'correlation_r', 'correlation_rho', 'beta', 'b', 'eta_squared',
    'partial_eta_squared', 'r_squared', 'percentage', 'mean_difference', 'other'
  )),
  confidence_interval_lower FLOAT,
  confidence_interval_upper FLOAT,
  p_value FLOAT,
  sample_size INTEGER,
  is_significant BOOLEAN,
  
  -- Variables (for statistical findings)
  independent_variable TEXT,
  dependent_variable TEXT,
  relationship_direction TEXT CHECK (relationship_direction IN ('positive', 'negative', 'null', 'mixed')),
  
  -- For thematic findings
  theme_name TEXT,
  theme_prevalence TEXT CHECK (theme_prevalence IN ('universal', 'common', 'variant', 'rare')),
  
  -- Embedding for semantic search
  embedding vector(384),
  
  -- Metadata
  confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for paper lookups
CREATE INDEX idx_paper_findings_paper_id ON paper_findings(paper_id);

-- Index for extraction lookups
CREATE INDEX idx_paper_findings_extraction_id ON paper_findings(extraction_id);

-- Index for finding type filtering
CREATE INDEX idx_paper_findings_type ON paper_findings(finding_type);

-- Index for relationship direction (for cross-study analysis)
CREATE INDEX idx_paper_findings_direction ON paper_findings(relationship_direction) WHERE relationship_direction IS NOT NULL;

-- Index for significant findings
CREATE INDEX idx_paper_findings_significant ON paper_findings(is_significant) WHERE is_significant IS NOT NULL;

-- Vector index for semantic search on findings
CREATE INDEX idx_paper_findings_embedding ON paper_findings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- =============================================================================
-- RPC Functions for Extraction Queries
-- =============================================================================

-- Get extraction for a paper
CREATE OR REPLACE FUNCTION get_paper_extraction(p_paper_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', pe.id,
    'paper_id', pe.paper_id,
    'paper_type', pe.paper_type,
    'paper_type_confidence', pe.paper_type_confidence,
    'secondary_type', pe.secondary_type,
    'core_extraction', pe.core_extraction,
    'quantitative_extension', pe.quantitative_extension,
    'qualitative_extension', pe.qualitative_extension,
    'theoretical_extension', pe.theoretical_extension,
    'humanities_extension', pe.humanities_extension,
    'review_extension', pe.review_extension,
    'overall_confidence', pe.overall_confidence,
    'validation_status', pe.validation_status,
    'extracted_at', pe.extracted_at
  )
  INTO result
  FROM paper_extractions pe
  WHERE pe.paper_id = p_paper_id
  ORDER BY pe.extraction_version DESC
  LIMIT 1;
  
  RETURN result;
END;
$$;

-- Get findings by relationship direction
CREATE OR REPLACE FUNCTION get_findings_by_direction(
  p_paper_ids UUID[],
  p_direction TEXT
)
RETURNS TABLE (
  id UUID,
  paper_id UUID,
  description TEXT,
  effect_size FLOAT,
  effect_size_type TEXT,
  p_value FLOAT,
  sample_size INTEGER,
  independent_variable TEXT,
  dependent_variable TEXT,
  confidence FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pf.id,
    pf.paper_id,
    pf.description,
    pf.effect_size,
    pf.effect_size_type,
    pf.p_value,
    pf.sample_size,
    pf.independent_variable,
    pf.dependent_variable,
    pf.confidence
  FROM paper_findings pf
  WHERE pf.paper_id = ANY(p_paper_ids)
    AND pf.finding_type = 'statistical'
    AND pf.relationship_direction = p_direction
  ORDER BY pf.confidence DESC, pf.effect_size DESC NULLS LAST;
END;
$$;

-- Aggregate findings across papers
CREATE OR REPLACE FUNCTION aggregate_findings(p_paper_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  result JSONB;
BEGIN
  WITH finding_stats AS (
    SELECT 
      relationship_direction,
      COUNT(*) as count,
      AVG(effect_size) FILTER (WHERE effect_size IS NOT NULL) as avg_effect_size,
      SUM(sample_size) FILTER (WHERE sample_size IS NOT NULL) as total_sample_size,
      COUNT(*) FILTER (WHERE is_significant = true) as significant_count
    FROM paper_findings
    WHERE paper_id = ANY(p_paper_ids)
      AND finding_type = 'statistical'
    GROUP BY relationship_direction
  )
  SELECT jsonb_build_object(
    'total_papers', array_length(p_paper_ids, 1),
    'total_findings', (SELECT COUNT(*) FROM paper_findings WHERE paper_id = ANY(p_paper_ids)),
    'by_direction', (
      SELECT jsonb_agg(jsonb_build_object(
        'direction', relationship_direction,
        'count', count,
        'avg_effect_size', avg_effect_size,
        'total_sample_size', total_sample_size,
        'significant_count', significant_count
      ))
      FROM finding_stats
    )
  )
  INTO result;
  
  RETURN result;
END;
$$;

-- =============================================================================
-- Triggers
-- =============================================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_paper_extractions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER paper_extractions_updated_at
  BEFORE UPDATE ON paper_extractions
  FOR EACH ROW
  EXECUTE FUNCTION update_paper_extractions_updated_at();

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE paper_extractions IS 'Structured extraction of claims, findings, and metadata from academic papers';
COMMENT ON TABLE paper_findings IS 'Normalized findings for cross-document analysis';
COMMENT ON COLUMN paper_extractions.core_extraction IS 'Universal extraction fields (claims, methodology, contributions, etc.)';
COMMENT ON COLUMN paper_extractions.quantitative_extension IS 'Statistical findings, effect sizes, sample info for quantitative papers';
COMMENT ON COLUMN paper_extractions.qualitative_extension IS 'Themes, quotes, methodology for qualitative papers';
COMMENT ON COLUMN paper_findings.relationship_direction IS 'Direction of statistical relationship for cross-study synthesis';
