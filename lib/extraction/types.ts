/**
 * Structured Extraction Types
 * 
 * This module defines the schemas for extracting structured data from academic papers.
 * The system uses a Core + Extensions architecture:
 * - Core extraction: Universal fields extracted from ALL papers
 * - Extensions: Type-specific fields (quantitative, qualitative, theoretical, humanities)
 * 
 * @module lib/extraction/types
 */

// =============================================================================
// Paper Type Classification
// =============================================================================

/**
 * Classification of academic paper types
 * Used to determine which extension extractors to run
 */
export type PaperType = 
  | 'quantitative'    // Empirical research with statistical analysis
  | 'qualitative'     // Empirical research with thematic/interpretive analysis
  | 'mixed_methods'   // Combines quantitative and qualitative approaches
  | 'theoretical'     // Develops/critiques theoretical frameworks
  | 'review'          // Literature review, systematic review, meta-analysis
  | 'humanities'      // Literary, historical, philosophical analysis
  | 'case_study'      // In-depth analysis of specific cases
  | 'methodological'  // Develops or validates research methods
  | 'commentary'      // Editorial, opinion, response papers
  | 'unknown'         // Could not classify

/**
 * Confidence level for classifications and extractions
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/**
 * Result of paper type classification
 */
export interface PaperTypeClassification {
  primaryType: PaperType
  secondaryType?: PaperType          // For mixed papers
  confidence: ConfidenceLevel
  confidenceScore: number            // 0-1
  indicators: string[]               // What led to this classification
  suggestedExtensions: ExtensionType[]
}

// =============================================================================
// Core Extraction (All Papers)
// =============================================================================

/**
 * A claim made in the paper
 */
export interface Claim {
  id: string
  text: string                       // The claim statement
  type: ClaimType
  evidenceQuote?: string             // Supporting quote from paper
  section: PaperSection              // Where in the paper
  confidence: number                 // 0-1 extraction confidence
}

export type ClaimType = 
  | 'finding'           // Empirical result
  | 'argument'          // Theoretical argument
  | 'hypothesis'        // Proposed but not tested here
  | 'conclusion'        // Summary conclusion
  | 'limitation'        // Acknowledged limitation
  | 'implication'       // Practical/theoretical implication
  | 'future_work'       // Suggested future research
  | 'background'        // Contextual claim from literature

export type PaperSection = 
  | 'abstract'
  | 'introduction'
  | 'literature_review'
  | 'theory'
  | 'methodology'
  | 'results'
  | 'discussion'
  | 'conclusion'
  | 'unknown'

/**
 * Research context information
 */
export interface ResearchContext {
  domain: string                     // e.g., "entrepreneurship", "oncology"
  subDomain?: string                 // e.g., "venture capital", "breast cancer"
  geographic?: string                // e.g., "United States", "Global"
  temporal?: {
    period?: string                  // e.g., "2010-2020"
    dataCollectionYear?: number
  }
  population?: string                // e.g., "startup founders", "postmenopausal women"
  setting?: string                   // e.g., "university hospital", "Fortune 500 companies"
}

/**
 * Core extraction - extracted from ALL papers regardless of type
 */
export interface CoreExtraction {
  paperId: string
  paperType: PaperTypeClassification
  
  // Research identification
  title: string
  researchQuestion?: string          // Main RQ if explicitly stated
  objectives: string[]               // Research objectives/aims
  
  // Claims and contributions
  mainClaims: Claim[]                // Primary claims/findings
  keyContributions: string[]         // Novel contributions
  
  // Methodology (high-level)
  methodologySummary: string         // Brief methodology description
  dataSource?: string                // What data was used
  
  // Context
  context: ResearchContext
  
  // Limitations and future work
  limitations: string[]
  futureWork: string[]
  
  // Quality indicators
  peerReviewed?: boolean
  citationCount?: number
  
  // Extraction metadata
  extractionMetadata: ExtractionMetadata
}

/**
 * Metadata about the extraction process
 */
export interface ExtractionMetadata {
  extractionVersion: string          // Schema version
  extractedAt: Date
  modelUsed: string                  // LLM model used
  extractionTimeMs: number
  overallConfidence: number          // 0-1
  warnings: string[]                 // Any extraction issues
}

// =============================================================================
// Quantitative Extension
// =============================================================================

/**
 * Study design types for quantitative research
 */
export type StudyDesign = 
  | 'experimental'           // True experiment with randomization
  | 'quasi_experimental'     // Experiment without full randomization
  | 'observational'          // No intervention
  | 'longitudinal'           // Data over time
  | 'cross_sectional'        // Single point in time
  | 'cohort'                 // Following a group over time
  | 'case_control'           // Comparing cases to controls
  | 'survey'                 // Survey-based
  | 'secondary_data'         // Analysis of existing data
  | 'simulation'             // Computational simulation
  | 'other'

/**
 * Types of effect sizes
 */
export type EffectSizeType = 
  | 'cohens_d'               // Standardized mean difference
  | 'hedges_g'               // Corrected standardized mean difference
  | 'odds_ratio'             // OR
  | 'risk_ratio'             // RR
  | 'hazard_ratio'           // HR
  | 'correlation_r'          // Pearson's r
  | 'correlation_rho'        // Spearman's rho
  | 'beta'                   // Regression coefficient (standardized)
  | 'b'                      // Regression coefficient (unstandardized)
  | 'eta_squared'            // Effect size for ANOVA
  | 'partial_eta_squared'    // Partial effect size
  | 'r_squared'              // Variance explained
  | 'percentage'             // Simple percentage
  | 'mean_difference'        // Raw mean difference
  | 'other'

/**
 * A statistical finding from a quantitative study
 */
export interface StatisticalFinding {
  id: string
  
  // What was found
  description: string                // Plain language description
  relationship: RelationshipType     // Type of relationship found
  
  // Variables involved
  independentVariable: string
  dependentVariable: string
  controlVariables?: string[]
  moderators?: string[]
  mediators?: string[]
  
  // Statistical details
  effectSize?: number
  effectSizeType?: EffectSizeType
  confidenceInterval?: {
    lower: number
    upper: number
    level: number                    // e.g., 0.95 for 95% CI
  }
  pValue?: number
  significanceLevel?: number         // e.g., 0.05
  isSignificant?: boolean
  
  // Test information
  statisticalTest?: string           // e.g., "t-test", "ANOVA", "regression"
  testStatistic?: number             // e.g., t-value, F-value
  degreesOfFreedom?: number | [number, number]
  
  // Sample for this finding
  sampleSize?: number
  subgroupDescription?: string       // If finding is for a subgroup
  
  // Extraction confidence
  confidence: number
  rawQuote?: string                  // Original text from paper
}

export type RelationshipType = 
  | 'positive'               // Positive relationship
  | 'negative'               // Negative relationship
  | 'null'                   // No significant relationship
  | 'curvilinear'            // Non-linear relationship
  | 'interaction'            // Moderating effect
  | 'mediation'              // Mediating effect
  | 'comparison'             // Group comparison

/**
 * Variable information
 */
export interface VariableInfo {
  name: string
  operationalization?: string        // How it was measured
  measurementType?: 'continuous' | 'categorical' | 'ordinal' | 'binary'
  reliability?: number               // Cronbach's alpha, etc.
  source?: string                    // Established scale, custom, etc.
}

/**
 * Quantitative paper extension
 */
export interface QuantitativeExtension {
  paperId: string
  
  // Study design
  studyDesign: StudyDesign
  designDetails?: string
  
  // Sample
  sampleSize: number
  sampleDescription?: string
  samplingMethod?: string
  responseRate?: number              // For surveys
  attritionRate?: number             // For longitudinal
  
  // Variables
  variables: {
    independent: VariableInfo[]
    dependent: VariableInfo[]
    control?: VariableInfo[]
    moderator?: VariableInfo[]
    mediator?: VariableInfo[]
  }
  
  // Analysis
  analysisMethod: string[]           // e.g., ["regression", "SEM"]
  softwareUsed?: string              // e.g., "SPSS 26", "R"
  
  // Findings
  statisticalFindings: StatisticalFinding[]
  
  // Quality indicators
  powerAnalysis?: boolean
  effectSizeReported: boolean
  confidenceIntervalsReported: boolean
  assumptionsTested?: boolean
  
  // Extraction metadata
  extractionConfidence: number
}

// =============================================================================
// Qualitative Extension
// =============================================================================

/**
 * Qualitative methodology types
 */
export type QualitativeMethodology = 
  | 'grounded_theory'
  | 'phenomenology'
  | 'ethnography'
  | 'case_study'
  | 'narrative_inquiry'
  | 'content_analysis'
  | 'thematic_analysis'
  | 'discourse_analysis'
  | 'action_research'
  | 'mixed_qualitative'
  | 'other'

/**
 * Data collection methods for qualitative research
 */
export type QualitativeDataSource = 
  | 'interviews'
  | 'focus_groups'
  | 'observation'
  | 'documents'
  | 'artifacts'
  | 'field_notes'
  | 'diaries'
  | 'visual_data'
  | 'social_media'
  | 'other'

/**
 * A theme identified in qualitative research
 */
export interface QualitativeTheme {
  id: string
  name: string
  description: string
  subThemes?: QualitativeTheme[]
  
  // Evidence
  supportingQuotes: ParticipantQuote[]
  prevalence?: 'universal' | 'common' | 'variant' | 'rare'  // How many participants
  
  // Relationships
  relatedThemes?: string[]           // IDs of related themes
  
  confidence: number
}

/**
 * A quote from a participant
 */
export interface ParticipantQuote {
  text: string
  participantId?: string             // Anonymized ID
  context?: string                   // Context of the quote
}

/**
 * Qualitative paper extension
 */
export interface QualitativeExtension {
  paperId: string
  
  // Methodology
  methodology: QualitativeMethodology
  methodologyJustification?: string
  philosophicalStance?: string       // e.g., "constructivist", "pragmatic"
  
  // Participants/Data
  participantCount?: number
  participantDescription?: string
  selectionCriteria?: string
  dataSources: QualitativeDataSource[]
  dataCollectionPeriod?: string
  
  // Analysis
  analysisApproach: string
  codingMethod?: string              // e.g., "open coding", "a priori codes"
  softwareUsed?: string              // e.g., "NVivo", "Atlas.ti"
  
  // Findings
  themes: QualitativeTheme[]
  theoreticalModel?: string          // If a model was developed
  
  // Quality/Rigor
  trustworthinessStrategies?: string[]  // e.g., "member checking", "triangulation"
  reflexivityStatement?: boolean
  auditTrail?: boolean
  
  // Extraction metadata
  extractionConfidence: number
}

// =============================================================================
// Theoretical Extension
// =============================================================================

/**
 * Type of theoretical contribution
 */
export type TheoreticalContributionType = 
  | 'new_theory'             // Develops entirely new theory
  | 'theory_extension'       // Extends existing theory
  | 'theory_integration'     // Integrates multiple theories
  | 'theory_critique'        // Critiques existing theory
  | 'framework_development'  // Develops conceptual framework
  | 'typology'              // Develops classification system
  | 'model_development'     // Develops theoretical model

/**
 * A theoretical concept
 */
export interface TheoreticalConcept {
  id: string
  name: string
  definition: string
  dimensions?: string[]              // Sub-dimensions of concept
  relatedConcepts?: string[]
  sourceTheory?: string              // If borrowed from another theory
}

/**
 * A theoretical proposition
 */
export interface Proposition {
  id: string
  statement: string
  type: 'axiom' | 'proposition' | 'hypothesis' | 'corollary'
  concepts: string[]                 // Concept IDs involved
  relationship?: string              // Nature of relationship
  conditions?: string[]              // Boundary conditions
  supportingArgument?: string
}

/**
 * Theoretical paper extension
 */
export interface TheoreticalExtension {
  paperId: string
  
  // Contribution type
  contributionType: TheoreticalContributionType
  
  // Theoretical foundations
  buildsOn: string[]                 // Theories this builds on
  critiqueOf?: string[]              // Theories this critiques
  
  // Core elements
  concepts: TheoreticalConcept[]
  propositions: Proposition[]
  
  // Framework/Model
  frameworkName?: string
  frameworkDescription?: string
  frameworkDiagram?: string          // Description of visual model
  
  // Scope
  scopeConditions?: string[]         // Where theory applies
  levelOfAnalysis?: string           // e.g., "individual", "organizational"
  
  // Validation
  illustrativeExamples?: string[]
  empiricalSupport?: string          // References to supporting studies
  
  // Extraction metadata
  extractionConfidence: number
}

// =============================================================================
// Humanities Extension
// =============================================================================

/**
 * Humanities analysis approaches
 */
export type HumanitiesApproach = 
  | 'literary_analysis'
  | 'historical_analysis'
  | 'philosophical_analysis'
  | 'cultural_analysis'
  | 'rhetorical_analysis'
  | 'critical_theory'
  | 'hermeneutics'
  | 'comparative_analysis'
  | 'archival_research'
  | 'textual_criticism'
  | 'other'

/**
 * An interpretive claim in humanities research
 */
export interface InterpretiveClaim {
  id: string
  claim: string
  argument: string                   // The argument supporting the claim
  evidence: string[]                 // Textual/historical evidence cited
  counterArguments?: string[]        // Addressed counterarguments
  confidence: number
}

/**
 * Humanities paper extension
 */
export interface HumanitiesExtension {
  paperId: string
  
  // Approach
  analysisApproach: HumanitiesApproach
  theoreticalLens?: string           // e.g., "Marxist", "feminist", "postcolonial"
  
  // Sources
  primarySources: string[]           // Texts, artifacts, archives analyzed
  primarySourcePeriod?: string       // Historical period
  
  // Analysis
  interpretiveClaims: InterpretiveClaim[]
  centralArgument: string
  
  // Contextualization
  historicalContext?: string
  culturalContext?: string
  
  // Scholarly conversation
  dialogueWith?: string[]            // Scholars/works in dialogue with
  revisionsTo?: string[]             // What interpretations this revises
  
  // Extraction metadata
  extractionConfidence: number
}

// =============================================================================
// Review Paper Extension
// =============================================================================

/**
 * Types of review papers
 */
export type ReviewType = 
  | 'narrative_review'
  | 'systematic_review'
  | 'meta_analysis'
  | 'scoping_review'
  | 'critical_review'
  | 'integrative_review'
  | 'umbrella_review'

/**
 * Review paper extension
 */
export interface ReviewExtension {
  paperId: string
  
  // Review type
  reviewType: ReviewType
  
  // Scope
  searchStrategy?: string
  databases?: string[]
  dateRange?: string
  inclusionCriteria?: string[]
  exclusionCriteria?: string[]
  
  // Results
  studiesIncluded: number
  studiesScreened?: number
  
  // Synthesis
  synthesisMethod?: string           // e.g., "thematic synthesis", "meta-analysis"
  
  // For meta-analyses
  metaAnalyticFindings?: StatisticalFinding[]
  heterogeneityAssessed?: boolean
  publicationBiasAssessed?: boolean
  
  // Key findings
  mainFindings: string[]
  researchGaps: string[]
  futureDirections: string[]
  
  // Extraction metadata
  extractionConfidence: number
}

// =============================================================================
// Complete Extraction Result
// =============================================================================

export type ExtensionType = 
  | 'quantitative'
  | 'qualitative'
  | 'theoretical'
  | 'humanities'
  | 'review'

/**
 * Complete extraction result for a paper
 */
export interface PaperExtraction {
  // Core (always present)
  core: CoreExtraction
  
  // Extensions (present based on paper type)
  quantitative?: QuantitativeExtension
  qualitative?: QualitativeExtension
  theoretical?: TheoreticalExtension
  humanities?: HumanitiesExtension
  review?: ReviewExtension
  
  // Which extensions were extracted
  extensions: ExtensionType[]
  
  // Overall quality
  overallConfidence: number
  validationStatus: 'pending' | 'validated' | 'rejected'
  validationNotes?: string[]
}

// =============================================================================
// Extraction Request/Response Types
// =============================================================================

/**
 * Input for extraction
 */
export interface ExtractionInput {
  paperId: string
  title: string
  abstract?: string
  fullText?: string
  metadata?: {
    authors?: string[]
    year?: number
    venue?: string
    doi?: string
    citationCount?: number
  }
  
  // Options
  options?: ExtractionOptions
}

/**
 * Extraction options
 */
export interface ExtractionOptions {
  // Force specific paper type (skip classification)
  forcePaperType?: PaperType
  
  // Which extensions to extract (auto-detected if not specified)
  extensions?: ExtensionType[]
  
  // Skip certain extractions
  skipCore?: boolean
  
  // Quality thresholds
  minConfidence?: number             // Skip extraction below this confidence
  
  // Model preferences
  preferredModel?: string
  
  // Timeout
  timeoutMs?: number
}

/**
 * Extraction result with status
 */
export interface ExtractionResult {
  success: boolean
  extraction?: PaperExtraction
  error?: string
  
  // Timing
  classificationTimeMs: number
  coreExtractionTimeMs: number
  extensionExtractionTimeMs: number
  totalTimeMs: number
}

// =============================================================================
// Database Types (for Supabase)
// =============================================================================

/**
 * Database row type for paper_extractions table
 */
export interface PaperExtractionRow {
  id: string
  paper_id: string
  extraction_version: number
  
  // Classification
  paper_type: PaperType
  paper_type_confidence: number
  secondary_type?: PaperType
  
  // Core extraction as JSONB
  core_extraction: CoreExtraction
  
  // Extensions as JSONB (nullable)
  quantitative_extension?: QuantitativeExtension
  qualitative_extension?: QualitativeExtension
  theoretical_extension?: TheoreticalExtension
  humanities_extension?: HumanitiesExtension
  review_extension?: ReviewExtension
  
  // Metadata
  overall_confidence: number
  validation_status: 'pending' | 'validated' | 'rejected'
  validation_notes?: string[]
  
  // Timestamps
  extracted_at: string
  updated_at: string
  
  // Extraction info
  model_used: string
  extraction_time_ms: number
}

/**
 * Database row type for paper_findings table
 * Normalized findings for easier querying/analysis
 */
export interface PaperFindingRow {
  id: string
  paper_id: string
  extraction_id: string
  
  // Finding identification
  finding_type: 'statistical' | 'thematic' | 'interpretive' | 'theoretical' | 'claim'
  
  // Content
  description: string
  raw_quote?: string
  section_source?: PaperSection
  
  // For statistical findings
  effect_size?: number
  effect_size_type?: EffectSizeType
  confidence_interval_lower?: number
  confidence_interval_upper?: number
  p_value?: number
  sample_size?: number
  is_significant?: boolean
  
  // Variables (for statistical)
  independent_variable?: string
  dependent_variable?: string
  relationship_direction?: 'positive' | 'negative' | 'null' | 'mixed'
  
  // For thematic findings
  theme_name?: string
  theme_prevalence?: string
  
  // Metadata
  confidence: number
  created_at: string
}
