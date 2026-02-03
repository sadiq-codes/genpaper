Good questions - let me give you my recommendations with reasoning:
---
My Recommendations
1. Extraction Schema: Hybrid: Core + Extensions (Option 3)
Reasoning:
| Approach | Pros | Cons |
|----------|------|------|
| Separate schemas | Clean, type-specific | Duplication, complex routing |
| Unified optional | Simple, one extraction path | Messy schema, unclear what applies when |
| Core + Extensions | Best of both - shared foundation + type-specific depth | Slightly more complex, but manageable |
Proposed Structure:
// Core schema - ALL papers get this
interface CoreExtraction {
  paper_id: string
  paper_type: 'quantitative' | 'qualitative' | 'theoretical' | 'review' | 'humanities' | 'mixed'
  
  // Universal fields
  main_claims: Claim[]              // Every paper makes claims
  methodology_summary: string        // How they did it
  key_contributions: string[]        // What's new
  limitations: string[]              // What they acknowledge
  context: {
    domain: string
    geographic?: string
    temporal?: string
  }
}
// Extensions - type-specific
interface QuantitativeExtension {
  sample_size: number
  study_design: 'experimental' | 'quasi-experimental' | 'observational' | 'longitudinal' | 'cross-sectional'
  statistical_findings: StatisticalFinding[]  // effect sizes, p-values, CIs
  variables: { independent: string[], dependent: string[], control: string[] }
}
interface QualitativeExtension {
  methodology: 'grounded_theory' | 'phenomenology' | 'ethnography' | 'case_study' | 'narrative' | 'other'
  participant_count?: number
  themes_identified: Theme[]
  data_sources: string[]
}
interface TheoreticalExtension {
  framework_type: 'new_theory' | 'extension' | 'critique' | 'synthesis'
  key_concepts: Concept[]
  propositions: Proposition[]
  builds_on: string[]  // Referenced theories
}
interface HumanitiesExtension {
  analysis_approach: 'literary' | 'historical' | 'philosophical' | 'cultural' | 'rhetorical'
  primary_sources: string[]
  interpretive_claims: InterpretiveClaim[]
  theoretical_lens?: string
}
Why this is best:
1. LLM extracts core for all papers - always get something useful
2. Type detection triggers extension extraction - only extract what's relevant
3. Analysis engine has unified core to work with, plus rich type-specific data
4. Graceful degradation - if extension extraction fails, core still works
---
2. Analysis Engine: Hybrid: Custom + LLM (Option 4)
Reasoning:
| Approach | Pros | Cons |
|----------|------|------|
| Custom only | Deterministic, testable | Limited pattern recognition |
| R/Python packages | Rigorous statistics | Overkill for MVP, deployment complexity |
| LLM only | Flexible, handles nuance | Expensive, non-deterministic |
| Custom + LLM | Best of both - reliable basics + smart pattern recognition | More complex, but optimal results |
Division of Labor:
| Task | Approach | Reasoning |
|------|----------|-----------|
| Frequency counting | Custom | 18 of 23 studies - simple, must be accurate |
| Effect direction grouping | Custom | Categorize positive/negative/null - deterministic |
| Quality score calculation | Custom | Formula-based, reproducible |
| Contradiction detection | Custom + LLM | Custom identifies conflicts, LLM explains why |
| Temporal trend analysis | Custom | Sort by year, calculate means per period |
| Mechanism inference | LLM | "Why does X cause Y?" - requires reasoning |
| Gap identification | Custom + LLM | Custom finds missing coverage, LLM articulates |
| Context clustering | LLM | Semantic grouping of study contexts |
Why this is best:
1. Deterministic for numbers - "18 of 23" must be correct, not hallucinated
2. LLM for semantics - explaining contradictions, inferring mechanisms
3. Testable - custom functions can be unit tested
4. Cost-efficient - LLM only called for complex reasoning
---
High-Level Architecture
Now let me outline the full system:
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SYNTHESIS ENGINE v2                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   LAYER 1   │    │   LAYER 2   │    │   LAYER 3   │    │   LAYER 4   │  │
│  │ Extraction  │───▶│  Analysis   │───▶│  Synthesis  │───▶│  Writing    │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│                                                                             │
│  PDF/Papers         Structured         Cross-Doc          Data-Driven       │
│  → Structured       Findings DB        Analysis           Narrative         │
│    Data             → Patterns         → Synthesis        Generation        │
│                                          Plan                               │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                         NEW COMPONENTS                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Structured Extraction Service                                        │   │
│  │ - Paper type classifier                                              │   │
│  │ - Core extractor (claims, methodology, contributions)                │   │
│  │ - Extension extractors (quantitative, qualitative, theoretical, etc) │   │
│  │ - Validation & confidence scoring                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Cross-Document Analysis Engine                                       │   │
│  │ - Frequency analyzer (X of Y studies)                                │   │
│  │ - Direction aggregator (positive/negative/null)                      │   │
│  │ - Contradiction detector                                             │   │
│  │ - Temporal trend analyzer                                            │   │
│  │ - Context clusterer                                                  │   │
│  │ - Quality weighter                                                   │   │
│  │ - Gap identifier                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Synthesis Plan Builder                                               │   │
│  │ - Pattern prioritization                                             │   │
│  │ - Evidence grouping                                                  │   │
│  │ - Narrative structure planning                                       │   │
│  │ - Section evidence assignment                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Data-Driven Writer                                                   │   │
│  │ - Template system with quantitative placeholders                     │   │
│  │ - Pattern-to-prose converter                                         │   │
│  │ - Evidence-backed claim generator                                    │   │
│  │ - Synthesis paragraph builder                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                         NEW DATA MODELS                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  paper_extractions        - Structured extraction per paper                 │
│  paper_findings           - Individual findings with effect sizes           │
│  extraction_extensions    - Type-specific extracted data                    │
│  analysis_patterns        - Detected patterns (per project)                 │
│  synthesis_plans          - Generated synthesis structure                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
---
Implementation Phases
Phase 1: Structured Extraction Foundation (4-6 weeks)
Goal: Extract structured data from papers at ingestion time
New Components:
lib/extraction/
├── paper-classifier.ts      # Detect paper type
├── core-extractor.ts        # Extract universal fields
├── extensions/
│   ├── quantitative.ts      # Effect sizes, sample sizes, stats
│   ├── qualitative.ts       # Themes, methodology
│   ├── theoretical.ts       # Frameworks, propositions
│   └── humanities.ts        # Interpretive claims
├── validator.ts             # Confidence scoring
└── types.ts                 # Extraction schemas
Database Changes:
-- Structured extractions
CREATE TABLE paper_extractions (
  id UUID PRIMARY KEY,
  paper_id UUID REFERENCES papers(id),
  paper_type TEXT NOT NULL,
  extraction_version INTEGER DEFAULT 1,
  confidence_score FLOAT,
  
  -- Core fields (JSONB for flexibility)
  main_claims JSONB,
  methodology_summary TEXT,
  key_contributions JSONB,
  limitations JSONB,
  context JSONB,
  
  -- Metadata
  extracted_at TIMESTAMP DEFAULT NOW(),
  model_used TEXT,
  extraction_time_ms INTEGER
);
-- Type-specific findings
CREATE TABLE paper_findings (
  id UUID PRIMARY KEY,
  extraction_id UUID REFERENCES paper_extractions(id),
  finding_type TEXT,  -- 'statistical', 'thematic', 'interpretive', etc.
  claim TEXT NOT NULL,
  evidence_quote TEXT,
  
  -- For quantitative
  effect_size FLOAT,
  effect_size_type TEXT,  -- 'cohen_d', 'odds_ratio', 'correlation', etc.
  confidence_interval JSONB,
  p_value FLOAT,
  sample_size INTEGER,
  
  -- For qualitative
  theme_name TEXT,
  participant_quote TEXT,
  
  -- Common
  section_source TEXT,
  confidence FLOAT
);
Deliverables:
- [ ] Paper type classifier (90%+ accuracy)
- [ ] Core extraction working for all paper types
- [ ] Quantitative extension (effect sizes, sample sizes)
- [ ] Qualitative extension (themes, methodology)
- [ ] Database migrations
- [ ] Extraction triggered on paper ingestion
---
Phase 2: Cross-Document Analysis Engine (4-6 weeks)
Goal: Analyze patterns across all extracted papers
New Components:
lib/analysis/
├── engine.ts                # Main analysis orchestrator
├── frequency-analyzer.ts    # "X of Y studies found..."
├── direction-aggregator.ts  # Positive/negative/null grouping
├── contradiction-detector.ts
├── temporal-analyzer.ts     # Trends over time
├── context-clusterer.ts     # Group by study context
├── quality-weighter.ts      # Weight by methodological rigor
├── gap-identifier.ts
├── mechanism-inferrer.ts    # LLM-powered
└── types.ts
Analysis Output Schema:
interface AnalysisResult {
  projectId: string
  analyzedPapers: number
  
  patterns: Pattern[]
  contradictions: Contradiction[]
  temporalTrends: TemporalTrend[]
  contextClusters: ContextCluster[]
  gaps: Gap[]
  
  metadata: {
    analysisVersion: number
    computedAt: Date
    qualityDistribution: { high: number, medium: number, low: number }
  }
}
interface Pattern {
  id: string
  claim: string                    // "Prior experience increases venture success"
  direction: 'positive' | 'negative' | 'null' | 'mixed'
  
  support: {
    count: number                  // 18
    total: number                  // 23
    percentage: number             // 78%
    combinedSampleSize: number     // 8,932
  }
  
  effectSizes?: {
    mean: number
    range: [number, number]
    weightedMean?: number          // Quality-weighted
  }
  
  supportingPapers: string[]       // Paper IDs
  quality: 'strong' | 'moderate' | 'weak'
  moderators?: string[]            // Identified boundary conditions
}
Deliverables:
- [ ] Frequency analysis ("18 of 23 studies")
- [ ] Effect direction aggregation
- [ ] Quality weighting algorithm
- [ ] Contradiction detection with context explanation
- [ ] Temporal trend analysis
- [ ] Gap identification
- [ ] Analysis caching per project
---
Phase 3: Synthesis Plan Builder (3-4 weeks)
Goal: Create structured plan for synthesis writing
New Components:
lib/synthesis/
├── plan-builder.ts          # Orchestrates plan creation
├── pattern-prioritizer.ts   # Rank patterns by importance
├── evidence-grouper.ts      # Assign evidence to sections
├── narrative-structurer.ts  # Determine prose structure
└── types.ts
Synthesis Plan Schema:
interface SynthesisPlan {
  projectId: string
  sections: SynthesisSectionPlan[]
}
interface SynthesisSectionPlan {
  sectionKey: string
  title: string
  
  // What to synthesize
  patterns: PatternWritingPlan[]
  contradictions: ContradictionWritingPlan[]
  gaps: GapWritingPlan[]
  
  // How to structure
  narrativeApproach: 'pattern_first' | 'chronological' | 'methodological'
  targetWordCount: number
  
  // Evidence allocation
  primaryPapers: string[]      // Must cite
  supportingPapers: string[]   // Can cite if needed
}
interface PatternWritingPlan {
  patternId: string
  placement: 'opening' | 'body' | 'closing'
  emphasisLevel: 'major' | 'minor'
  
  // Data for templates
  data: {
    claim: string
    supportCount: string       // "18 of 23 studies (78%)"
    effectSize?: string        // "mean β=0.34, range: 0.12-0.67"
    combinedN?: string         // "n=8,932"
    moderators?: string        // "except in capital-intensive industries"
  }
}
Deliverables:
- [ ] Pattern prioritization algorithm
- [ ] Section-to-pattern mapping
- [ ] Evidence allocation logic
- [ ] Narrative structure recommendations
---
Phase 4: Data-Driven Writer (4-6 weeks)
Goal: Generate synthesis prose from analysis + plan
New Components:
lib/writing/
├── data-driven-writer.ts    # Main writer using plan
├── templates/
│   ├── pattern-synthesis.ts # "X of Y studies found..."
│   ├── contradiction.ts     # "While A found X, B found Y due to..."
│   ├── temporal-trend.ts    # "Early studies showed X, recent show Y"
│   ├── gap-statement.ts     # "Only N% of studies examined..."
│   └── mechanism.ts         # "This effect likely operates through..."
├── paragraph-builder.ts     # Assemble template outputs
├── citation-integrator.ts   # Weave citations naturally
└── coherence-checker.ts     # Ensure flow between paragraphs
Template Example:
// pattern-synthesis.ts
function synthesizePattern(plan: PatternWritingPlan, analysis: Pattern): string {
  const { claim, supportCount, effectSize, combinedN, moderators } = plan.data
  
  // Data-driven template
  let synthesis = `${claim} emerges as a ${analysis.quality} finding across the literature. `
  synthesis += `${supportCount} demonstrate this relationship`
  
  if (combinedN) {
    synthesis += ` (combined n=${combinedN})`
  }
  
  if (effectSize) {
    synthesis += `, with ${effectSize}`
  }
  
  synthesis += `. `
  
  if (moderators) {
    synthesis += `However, this effect ${moderators}. `
  }
  
  // Add citations
  synthesis = integrateCitations(synthesis, analysis.supportingPapers)
  
  return synthesis
}
Output Example:
Prior experience emerges as a strong finding across the literature. 
Eighteen of twenty-three studies (78%, combined n=8,932) demonstrate 
this relationship, with moderate to strong effects (mean β=0.34, 
range: 0.12-0.67) [Smith 2020; Chen 2021; Garcia 2022]. However, 
this effect disappears in capital-intensive industries [Jones 2022; 
Lee 2023], where funding access overrides experience benefits.
Deliverables:
- [ ] Template system for all synthesis types
- [ ] Paragraph assembly logic
- [ ] Natural citation integration
- [ ] Coherence checking
- [ ] Integration with existing prompt system
---
Phase 5: Integration & Pipeline Rewrite (3-4 weeks)
Goal: Replace current pipeline with new synthesis engine
Changes to Existing Files:
lib/generation/pipeline.ts   # Major rewrite
  - Remove chunk dumping
  - Add extraction trigger
  - Add analysis phase
  - Add synthesis planning phase
  - Use data-driven writer
lib/prompts/unified/         # Refactor
  - New templates for synthesis
  - Remove evidence snippet dumping
  - Pass analysis results instead
New Pipeline Flow:
1. Paper Discovery (keep existing)
2. Structured Extraction (NEW - Phase 1)
3. Cross-Document Analysis (NEW - Phase 2)
4. Synthesis Planning (NEW - Phase 3)
5. Data-Driven Writing (NEW - Phase 4)
6. Quality Validation (enhance existing)
Deliverables:
- [ ] New pipeline orchestrator
- [ ] Migration from old to new
- [ ] Feature flag for gradual rollout
- [ ] Performance optimization
- [ ] Error handling
---
Phase 6: Validation & Refinement (2-3 weeks)
Goal: Ensure quality matches human-written reviews
Validation Approach:
1. Expert Review Panel - Have academics review generated synthesis
2. A/B Comparison - Old system vs new, blind evaluation
3. Metric Tracking:
   - Citation diversity (unique papers cited / papers available)
   - Synthesis depth (patterns identified / patterns possible)
   - Quantitative accuracy (numbers match source data)
   - Coherence score (human rated)
Refinement:
- [ ] Tune extraction prompts based on failures
- [ ] Adjust analysis thresholds
- [ ] Improve templates based on feedback
- [ ] Handle edge cases
---
Timeline Summary
| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Extraction | 4-6 weeks | None |
| Phase 2: Analysis | 4-6 weeks | Phase 1 |
| Phase 3: Planning | 3-4 weeks | Phase 2 |
| Phase 4: Writing | 4-6 weeks | Phase 3 |
| Phase 5: Integration | 3-4 weeks | Phase 4 |
| Phase 6: Validation | 2-3 weeks | Phase 5 |
| Total | 20-29 weeks (~5-7 months) |
---
Questions Before Proceeding
1. Does this phased approach work for you? Each phase is independently deployable and testable.
2. Extraction accuracy vs speed trade-off: Should extraction happen:
   - At ingestion time (slower ingestion, faster generation)
   - At generation time (faster ingestion, slower generation)
   - Background job after ingestion (best UX, more complex)
3. Should we build a UI for viewing/editing extractions? Users could correct extraction errors, improving quality.
4. For Phase 1, should I start with quantitative papers (clearer schema) or build all extractors in parallel?
5. Any constraints I should know about? (Budget, team size, deadlines, etc.)