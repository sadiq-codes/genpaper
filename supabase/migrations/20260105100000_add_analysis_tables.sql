-- Research Assistant Analysis Tables
-- These tables store extracted claims, identified gaps, and analysis results

-- Store extracted claims from papers (sentence-level)
CREATE TABLE IF NOT EXISTS paper_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL,
  evidence_quote TEXT, -- The exact quote supporting this claim
  section TEXT, -- Which section of the paper (abstract, introduction, etc.)
  claim_type TEXT, -- 'finding', 'method', 'limitation', 'future_work', 'background'
  confidence FLOAT DEFAULT 0.5, -- How confident we are in the extraction
  embedding VECTOR(384), -- For semantic similarity search
  metadata JSONB DEFAULT '{}', -- Additional structured data
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient paper lookups
CREATE INDEX IF NOT EXISTS idx_paper_claims_paper_id ON paper_claims(paper_id);
-- Index for claim type filtering
CREATE INDEX IF NOT EXISTS idx_paper_claims_type ON paper_claims(claim_type);
-- Vector index for semantic search
CREATE INDEX IF NOT EXISTS idx_paper_claims_embedding ON paper_claims USING ivfflat (embedding vector_l2_ops) WITH (lists=100);

-- Store identified research gaps
CREATE TABLE IF NOT EXISTS research_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  gap_type TEXT NOT NULL, -- 'unstudied', 'contradiction', 'limitation'
  description TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]', -- Array of {claim_id, paper_id, quote}
  supporting_paper_ids UUID[] DEFAULT '{}',
  confidence FLOAT DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for project lookups
CREATE INDEX IF NOT EXISTS idx_research_gaps_project_id ON research_gaps(project_id);
-- Index for gap type filtering
CREATE INDEX IF NOT EXISTS idx_research_gaps_type ON research_gaps(gap_type);

-- Store synthesis/analysis outputs (structured + markdown)
CREATE TABLE IF NOT EXISTS project_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL, -- 'claim_extraction', 'gap_analysis', 'synthesis', 'literature_review'
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  structured_output JSONB, -- Machine-readable structured output
  markdown_output TEXT, -- Human-readable markdown
  metadata JSONB DEFAULT '{}', -- Processing stats, errors, etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for project lookups
CREATE INDEX IF NOT EXISTS idx_project_analysis_project_id ON project_analysis(project_id);
-- Index for analysis type
CREATE INDEX IF NOT EXISTS idx_project_analysis_type ON project_analysis(analysis_type);

-- Add analysis_status to research_projects
ALTER TABLE research_projects 
ADD COLUMN IF NOT EXISTS analysis_status TEXT DEFAULT 'none';

-- Comment explaining the tables
COMMENT ON TABLE paper_claims IS 'Extracted claims from papers at sentence level';
COMMENT ON TABLE research_gaps IS 'Identified research gaps (unstudied areas, contradictions, limitations)';
COMMENT ON TABLE project_analysis IS 'Stored analysis outputs (structured JSON + markdown)';

-- RPC function for semantic claim matching
CREATE OR REPLACE FUNCTION match_paper_claims(
  query_embedding VECTOR(384),
  paper_ids UUID[],
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  paper_id UUID,
  claim_text TEXT,
  evidence_quote TEXT,
  section TEXT,
  claim_type TEXT,
  confidence FLOAT,
  similarity FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT 
    c.id,
    c.paper_id,
    c.claim_text,
    c.evidence_quote,
    c.section,
    c.claim_type,
    c.confidence,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM paper_claims c
  WHERE c.paper_id = ANY(paper_ids)
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
