-- Migration: Add pipeline_state column to generation_runs for step-by-step execution
-- This enables Inngest to store intermediate state between steps, allowing long-running
-- paper generation to work within Vercel's 60-second function timeout.

-- Add pipeline_state column for storing intermediate generation state
ALTER TABLE generation_runs 
ADD COLUMN IF NOT EXISTS pipeline_state JSONB DEFAULT '{}';

-- Add comment explaining the column
COMMENT ON COLUMN generation_runs.pipeline_state IS 
'Stores intermediate pipeline state between Inngest steps. Includes: profile, paperIds, extractionProgress, themeAnalysis, contexts, sectionResults, qualityIssues. State is cleared on completion.';
