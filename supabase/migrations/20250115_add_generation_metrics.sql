-- Migration: Add generation metrics tracking table
-- Purpose: Store automated quality metrics for content generation analysis

CREATE TABLE IF NOT EXISTS generation_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id TEXT NOT NULL,
    paper_type TEXT NOT NULL,
    section_key TEXT NOT NULL,
    topic TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    generation_time_ms INTEGER NOT NULL,
    model_used TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    
    -- Core quality metrics
    citation_coverage DECIMAL(5,4) NOT NULL DEFAULT 0,
    relevance_score DECIMAL(5,4) NOT NULL DEFAULT 0,
    verbosity_ratio DECIMAL(5,4) NOT NULL DEFAULT 0,
    fact_density DECIMAL(5,4) NOT NULL DEFAULT 0,
    
    -- Content structure metrics
    paragraph_count INTEGER NOT NULL DEFAULT 0,
    average_paragraph_length DECIMAL(8,2) NOT NULL DEFAULT 0,
    transition_word_density DECIMAL(5,4) NOT NULL DEFAULT 0,
    
    -- Citation quality metrics
    citation_density DECIMAL(5,4) NOT NULL DEFAULT 0,
    citation_diversity DECIMAL(5,4) NOT NULL DEFAULT 0,
    citation_distribution DECIMAL(5,4) NOT NULL DEFAULT 0,
    
    -- Depth and complexity metrics
    depth_cue_coverage DECIMAL(5,4) NOT NULL DEFAULT 0,
    argument_complexity DECIMAL(5,4) NOT NULL DEFAULT 0,
    evidence_integration DECIMAL(5,4) NOT NULL DEFAULT 0,
    
    -- Constraints
    CONSTRAINT valid_scores CHECK (
        citation_coverage >= 0 AND citation_coverage <= 1 AND
        relevance_score >= 0 AND relevance_score <= 1 AND
        fact_density >= 0 AND fact_density <= 1 AND
        citation_diversity >= 0 AND citation_diversity <= 1 AND
        citation_distribution >= 0 AND citation_distribution <= 1 AND
        depth_cue_coverage >= 0 AND depth_cue_coverage <= 1 AND
        argument_complexity >= 0 AND argument_complexity <= 1 AND
        evidence_integration >= 0 AND evidence_integration <= 1
    )
);

-- Indexes for performance
CREATE INDEX idx_generation_metrics_timestamp ON generation_metrics(timestamp);
CREATE INDEX idx_generation_metrics_paper_type ON generation_metrics(paper_type);
CREATE INDEX idx_generation_metrics_section_key ON generation_metrics(section_key);
CREATE INDEX idx_generation_metrics_model_prompt ON generation_metrics(model_used, prompt_version);
CREATE INDEX idx_generation_metrics_quality_lookup ON generation_metrics(paper_type, section_key, timestamp);

-- View for aggregated metrics analysis
CREATE OR REPLACE VIEW generation_metrics_summary AS
SELECT 
    paper_type,
    section_key,
    model_used,
    prompt_version,
    DATE_TRUNC('day', timestamp) as date,
    COUNT(*) as total_generations,
    AVG(generation_time_ms) as avg_generation_time,
    AVG(word_count) as avg_word_count,
    AVG(citation_coverage) as avg_citation_coverage,
    AVG(relevance_score) as avg_relevance_score,
    AVG(fact_density) as avg_fact_density,
    AVG(depth_cue_coverage) as avg_depth_cue_coverage,
    AVG(evidence_integration) as avg_evidence_integration,
    
    -- Composite quality score
    AVG(
        citation_coverage * 0.25 +
        relevance_score * 0.20 +
        fact_density * 0.15 +
        depth_cue_coverage * 0.15 +
        evidence_integration * 0.15 +
        LEAST(argument_complexity, 1.0) * 0.10
    ) as avg_composite_score
FROM generation_metrics
GROUP BY paper_type, section_key, model_used, prompt_version, DATE_TRUNC('day', timestamp);

-- Function to get performance insights
CREATE OR REPLACE FUNCTION get_performance_insights(
    p_paper_type TEXT DEFAULT NULL,
    p_section_key TEXT DEFAULT NULL,
    p_days_back INTEGER DEFAULT 7
)
RETURNS TABLE (
    config TEXT,
    sample_size BIGINT,
    avg_score DECIMAL,
    score_trend TEXT,
    recommendation TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH config_performance AS (
        SELECT 
            CONCAT(model_used, '::', prompt_version) as configuration,
            COUNT(*) as samples,
            AVG(
                citation_coverage * 0.25 +
                relevance_score * 0.20 +
                fact_density * 0.15 +
                depth_cue_coverage * 0.15 +
                evidence_integration * 0.15 +
                LEAST(argument_complexity, 1.0) * 0.10
            ) as composite_score,
            
            -- Calculate trend (current week vs previous week)
            AVG(CASE 
                WHEN timestamp >= NOW() - INTERVAL '7 days' THEN
                    citation_coverage * 0.25 +
                    relevance_score * 0.20 +
                    fact_density * 0.15 +
                    depth_cue_coverage * 0.15 +
                    evidence_integration * 0.15 +
                    LEAST(argument_complexity, 1.0) * 0.10
                ELSE NULL
            END) as recent_score,
            
            AVG(CASE 
                WHEN timestamp < NOW() - INTERVAL '7 days' 
                AND timestamp >= NOW() - INTERVAL '14 days' THEN
                    citation_coverage * 0.25 +
                    relevance_score * 0.20 +
                    fact_density * 0.15 +
                    depth_cue_coverage * 0.15 +
                    evidence_integration * 0.15 +
                    LEAST(argument_complexity, 1.0) * 0.10
                ELSE NULL
            END) as previous_score
            
        FROM generation_metrics
        WHERE timestamp >= NOW() - INTERVAL '14 days'
        AND (p_paper_type IS NULL OR paper_type = p_paper_type)
        AND (p_section_key IS NULL OR section_key = p_section_key)
        GROUP BY model_used, prompt_version
        HAVING COUNT(*) >= 3
    ),
    ranked_configs AS (
        SELECT *,
            RANK() OVER (ORDER BY composite_score DESC) as performance_rank,
            CASE 
                WHEN recent_score > previous_score * 1.05 THEN 'improving'
                WHEN recent_score < previous_score * 0.95 THEN 'declining'
                ELSE 'stable'
            END as trend
        FROM config_performance
    )
    SELECT 
        configuration,
        samples,
        ROUND(composite_score * 100, 2),
        COALESCE(trend, 'insufficient_data'),
        CASE 
            WHEN performance_rank = 1 THEN 'best_performer'
            WHEN performance_rank <= 3 THEN 'recommended'
            WHEN trend = 'declining' THEN 'consider_alternatives'
            ELSE 'monitor'
        END
    FROM ranked_configs
    ORDER BY composite_score DESC;
END;
$$ LANGUAGE plpgsql;

-- RLS Policies (if needed)
ALTER TABLE generation_metrics ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated users
CREATE POLICY "Allow read access to generation metrics" ON generation_metrics
    FOR SELECT TO authenticated
    USING (true);

-- Allow insert for service role (for storing metrics)
CREATE POLICY "Allow insert for service role" ON generation_metrics
    FOR INSERT TO service_role
    WITH CHECK (true);

-- Comment for documentation
COMMENT ON TABLE generation_metrics IS 'Stores automated quality metrics for generated content to enable data-driven optimization of the generation system';
COMMENT ON FUNCTION get_performance_insights IS 'Analyzes generation performance across different configurations and provides recommendations for optimization'; 