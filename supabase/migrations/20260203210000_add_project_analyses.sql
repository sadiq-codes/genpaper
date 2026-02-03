-- Migration: Add Project Analyses Table
-- Description: Store cross-document analysis results with caching
-- Part of: Synthesis Engine v2 - Phase 2

-- =============================================================================
-- Project Analyses Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Analysis results (flexible JSONB)
  patterns JSONB NOT NULL DEFAULT '[]',
  contradictions JSONB NOT NULL DEFAULT '[]',
  gaps JSONB NOT NULL DEFAULT '[]',
  
  -- Summary
  summary TEXT NOT NULL,
  key_insights JSONB NOT NULL DEFAULT '[]',  -- string[]
  
  -- Input tracking for cache invalidation
  findings_hash TEXT NOT NULL,
  analyzed_papers INTEGER NOT NULL,
  total_findings INTEGER NOT NULL,
  
  -- Metadata
  analyzed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  analysis_time_ms INTEGER,
  model_used TEXT NOT NULL
);

-- Indexes
CREATE INDEX idx_project_analyses_project_id ON project_analyses(project_id);
CREATE INDEX idx_project_analyses_analyzed_at ON project_analyses(analyzed_at);
CREATE INDEX idx_project_analyses_findings_hash ON project_analyses(findings_hash);

-- GIN indexes for JSONB queries
CREATE INDEX idx_project_analyses_patterns_gin ON project_analyses USING GIN (patterns);
CREATE INDEX idx_project_analyses_contradictions_gin ON project_analyses USING GIN (contradictions);
CREATE INDEX idx_project_analyses_gaps_gin ON project_analyses USING GIN (gaps);

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE project_analyses IS 'Cross-document analysis results - patterns, contradictions, and gaps';
COMMENT ON COLUMN project_analyses.patterns IS 'Patterns found across multiple papers';
COMMENT ON COLUMN project_analyses.contradictions IS 'Contradictions between papers';
COMMENT ON COLUMN project_analyses.gaps IS 'Gaps identified in the literature';
COMMENT ON COLUMN project_analyses.findings_hash IS 'Hash of input findings for cache invalidation';
