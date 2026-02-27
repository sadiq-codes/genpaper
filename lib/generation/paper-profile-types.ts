/**
 * Paper Profile Types
 * 
 * Defines the structure of a contextually-generated paper profile
 * that guides all aspects of paper generation. This enables discipline-aware,
 * topic-specific guidance rather than hardcoded rules.
 */

import type { VoiceProfileId, VoiceProfileCore } from './voice-profiles'
import type { SectionType } from './paper-type-config'

/**
 * Discipline context describes the academic field and its characteristics
 */
export interface DisciplineContext {
  /** Primary academic discipline (e.g., "Business/Entrepreneurship") */
  primary: string
  /** Related fields that inform this topic (e.g., ["Economics", "Psychology"]) */
  related: string[]
  /** Characteristics of the field that affect paper expectations */
  fieldCharacteristics: {
    /** How fast the field evolves - affects recency expectations */
    paceOfChange: 'rapid' | 'moderate' | 'slow'
    /** Balance between theoretical and empirical work */
    theoryVsEmpirical: 'theory-heavy' | 'balanced' | 'empirical-heavy'
    /** Whether practitioner/real-world relevance is expected */
    practitionerRelevance: 'high' | 'medium' | 'low'
  }
}

/**
 * Profile for a single section in the paper
 */
export interface SectionProfile {
  /** Machine-readable key (e.g., "introduction", "thematicAnalysis") */
  key: string
  /** Human-readable title (e.g., "Introduction", "Thematic Analysis") */
  title: string
  /** What this section should accomplish */
  purpose: string
  /** Minimum word count for adequate coverage */
  minWords: number
  /** Maximum word count to avoid over-expansion */
  maxWords: number
  /** Expected citation density for this section */
  citationExpectation: 'none' | 'light' | 'moderate' | 'heavy'
  /** Key elements that should appear in this section */
  keyElements: string[]
  /** 
   * Whether this section discusses/synthesizes existing literature.
   * TRUE for sections that review, synthesize, or discuss prior work.
   * FALSE for sections describing original methodology, data, or results.
   * For literature reviews, most sections are literature-focused.
   */
  isLiteratureFocused?: boolean
  /**
   * Semantic classification of this section's role in the paper.
   * Set by the LLM during profile generation; inferred from key/title as fallback.
   */
  sectionType?: SectionType
  /** Optional subsections within this section */
  subsections?: SectionProfile[]
}

/**
 * Guidance on paper structure - what sections to include and avoid
 */
export interface StructureGuidance {
  /** Sections that are appropriate for this paper type and topic */
  appropriateSections: SectionProfile[]
  /** Sections that should NOT appear, with reasons */
  inappropriateSections: {
    name: string
    reason: string
  }[]
  /** Elements that must appear somewhere in the paper */
  requiredElements: string[]
}

/**
 * Expectations for sources and citations
 */
export interface SourceExpectations {
  /** Minimum number of unique sources for an adequate paper */
  minimumUniqueSources: number
  /** Ideal number of sources for a comprehensive paper */
  idealSourceCount: number
  /** How much to prioritize recent vs foundational literature */
  recencyProfile: 'cutting-edge' | 'balanced' | 'foundational-heavy'
  /** Explicit year range for searching papers - determined by AI based on topic context */
  searchYearRange: {
    /** Start year for paper search (e.g., 2019 for COVID-19 topics, 1980 for foundational fields) */
    fromYear: number
    /** End year for paper search (typically current year) */
    toYear: number
    /** Explanation of why this year range is appropriate for the topic */
    rationale: string
  }
  /** Specific guidance on recency for this field */
  recencyGuidance: string
}

/**
 * A specific quality criterion for this paper
 */
export interface QualityCriterion {
  /** Name of the criterion (e.g., "Synthesis across sources") */
  criterion: string
  /** What this criterion means in context */
  description: string
  /** Practical advice on how to achieve this */
  howToAchieve: string
}

/**
 * Expected content coverage for comprehensiveness
 */
export interface ContentCoverage {
  /** Themes that MUST be addressed for the paper to be complete */
  requiredThemes: string[]
  /** Themes that would strengthen the paper if included */
  recommendedThemes: string[]
  /** Scholarly debates that exist in this area */
  debates: string[]
  /** Methodological considerations specific to this topic */
  methodologicalConsiderations: string[]
  /** Common mistakes or weaknesses to avoid */
  commonPitfalls: string[]
}

/**
 * Rules specific to this paper genre/type
 */
export interface GenreRule {
  /** The rule itself */
  rule: string
  /** Why this rule matters for this paper type */
  rationale: string
}

/**
 * Title Contract Analysis
 * 
 * Captures what the title/topic promises to deliver to the reader.
 * This ensures the paper answers its own research question rather than
 * just covering related background material.
 */
export interface TitleContract {
  /** What the title promises the reader will learn or understand */
  promise: string
  /** Specific content/analysis that MUST appear to fulfill the promise */
  requiredDeliverables: string[]
  /** How to verify the paper delivered on its promise */
  successCriteria: string[]
  /** What would make this paper fail despite covering related topics */
  failureMode: string
}

/**
 * Paper Subtype Selection
 * 
 * Captures which specific type/mode was selected for the paper based on the topic.
 * Each paper type (literatureReview, capstoneProject, etc.) has subtypes that
 * determine the appropriate structure and approach.
 * 
 * Examples:
 * - Literature Review: Type A (Standalone), Type B (Background), Type C (Systematic), Type D (Scoping)
 * - Capstone Project: Type A (Empirical), Type B (Secondary), Type C (Applied), Type D (Creative)
 * - Master's Thesis: Type A (Empirical), Type B (Theoretical), Type C (Applied)
 * - PhD Dissertation: Type A (Empirical), Type B (Theoretical), Type C (Humanities), Type D (Practice-Based)
 * - Research Article: Mode A (Primary), Mode B (Secondary), Mode C (Mixed)
 */
export interface PaperSubtype {
  /** The type identifier (e.g., "A", "B", "C", "D" or mode name) */
  type: string
  /** Human-readable name (e.g., "Standalone Literature Review", "Applied Capstone") */
  name: string
  /** Why this type/mode was selected based on the topic */
  rationale: string
}

/**
 * Voice configuration for authorial persona
 * Enables distinct "author voices" to reduce AI detectability
 */
export interface PaperVoiceConfig {
  /** Selected voice profile ID */
  profileId: VoiceProfileId
  /** AI-generated rationale for why this voice was selected */
  rationale?: string
  /** Custom overrides to the base voice profile */
  overrides?: Partial<VoiceProfileCore>
}

/**
 * Complete paper profile - the central configuration for paper generation
 */
export interface PaperProfile {
  // Metadata
  /** When the profile was generated */
  generatedAt: string
  /** The topic being written about */
  topic: string
  /** The type of paper being generated */
  paperType: string
  /** Whether this paper has original research */
  hasOriginalResearch: boolean
  
  // Core profile components
  /** Discipline analysis and context */
  discipline: DisciplineContext
  /** Structure guidance - sections to include/avoid */
  structure: StructureGuidance
  /** Source and citation expectations */
  sourceExpectations: SourceExpectations
  /** Quality criteria specific to this paper */
  qualityCriteria: QualityCriterion[]
  /** Content coverage requirements */
  coverage: ContentCoverage
  /** Genre-specific rules */
  genreRules: GenreRule[]
  
  // Voice/Authorial persona (optional - defaults to 'balanced-academic')
  /** 
   * Voice configuration for authorial persona
   * Controls hedging, confidence, citation posture, and intellectual risk
   * to produce authentic-feeling variation across papers
   */
  voice?: PaperVoiceConfig
  
  // Title Contract (captures what the title promises to deliver)
  /**
   * Analysis of what the title/topic promises to deliver.
   * Ensures the paper answers its own research question rather than
   * just covering related background material.
   */
  titleContract?: TitleContract
  
  // Paper Subtype (explicit type/mode selection)
  /**
   * The selected subtype/mode for this paper based on topic analysis.
   * Makes explicit which type (e.g., Systematic Review vs. Standalone Review)
   * was chosen and why, enabling debugging and transparency.
   */
  paperSubtype?: PaperSubtype
  
  // Detailed outline with subsections
  /**
   * Industry-standard outline generated as part of the profile.
   * Includes subsections for each major section, based on discipline conventions,
   * paper type, and topic context.
   */
  outline?: {
    sections: ProfileOutlineSection[]
    totalEstimatedWords: number
  }
}

/**
 * Outline section generated as part of the paper profile.
 * Supports nested subsections for proper academic structure.
 */
export interface ProfileOutlineSection {
  /** Machine-readable key (camelCase, e.g., "introduction", "literatureReview") */
  sectionKey: string
  /** Human-readable title (e.g., "Introduction") */
  title: string
  /** Target word count for this section */
  expectedWords: number
  /** Key objectives or questions this section should address */
  keyPoints: string[]
  /** Nested subsections (e.g., "1.1 Background", "1.2 Objectives") */
  subsections?: ProfileOutlineSection[]
}

/**
 * Input for profile generation
 */
export interface ProfileGenerationInput {
  topic: string
  paperType: string
  hasOriginalResearch?: boolean
  userContext?: string
  signal?: AbortSignal
  /** Target total word count for the paper */
  length?: number
  /** User's research question (if original research) */
  researchQuestion?: string
  /** User's key findings — raw or normalized (if original research) */
  keyFindings?: string
}

/**
 * Result of profile-based validation
 */
export interface ProfileValidationResult {
  /** Whether the paper passes validation */
  valid: boolean
  /** Overall quality score (0-100) */
  score: number
  /** Critical issues that should be addressed */
  issues: string[]
  /** Warnings that may indicate problems */
  warnings: string[]
  /** Section-level analysis */
  sectionAnalysis: {
    found: string[]
    missing: string[]
    recommendations: string[]
  }
  /** Citation analysis */
  citationAnalysis: {
    uniqueSourceCount: number
    minimumRequired: number
    adequate: boolean
  }
  /** Theme coverage analysis */
  themeCoverage: {
    covered: string[]
    missing: string[]
  }
  /** Title contract deliverables analysis */
  titleContractCoverage?: {
    covered: string[]
    missing: string[]
    promise: string
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Theme Extraction Types
// These types support the theme extraction step that analyzes collected papers
// BEFORE outline generation, enabling themes to emerge from actual literature
// rather than being assumed from the topic alone.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * An emergent theme identified from analyzing collected papers
 */
export interface EmergentTheme {
  /** Descriptive name of the theme (e.g., "Machine Learning in Drug Discovery") */
  name: string
  /** Brief description of what this theme encompasses */
  description: string
  /** Paper IDs that support/discuss this theme */
  supportingPaperIds: string[]
  /** How prevalent this theme is across the collected literature */
  strength: 'dominant' | 'moderate' | 'emerging'
  /** Key concepts or terms associated with this theme */
  keyTerms?: string[]
}

/**
 * A scholarly debate or controversy identified in the literature
 */
export interface ScholarlyDebate {
  /** Topic of the debate (e.g., "Effectiveness of remote work on productivity") */
  topic: string
  /** Different positions or perspectives on this debate */
  positions: {
    /** The position or stance */
    stance: string
    /** Paper IDs that support this position */
    supportingPaperIds: string[]
  }[]
  /** Why this debate matters for the topic */
  significance?: string
}

/**
 * A gap identified in the collected literature
 */
export interface LiteratureGap {
  /** Description of what's missing (e.g., "Limited studies on long-term effects") */
  description: string
  /** Related themes where this gap was noticed */
  relatedThemes: string[]
  /** How significant this gap is */
  significance: 'critical' | 'notable' | 'minor'
  /** Potential research directions this gap suggests */
  potentialDirections?: string[]
}

/**
 * A paper identified as pivotal/influential in the field
 */
export interface PivotalPaper {
  /** The paper ID */
  paperId: string
  /** Title of the paper (for reference) */
  title: string
  /** Why this paper appears to be influential */
  reason: string
  /** Citation count if available from the API */
  citationCount?: number
  /** How the paper's influence was determined */
  evidenceType: 'citation_count' | 'frequently_referenced' | 'foundational_methods' | 'field_defining'
}

/**
 * Suggested organizational approach for the literature review
 */
export interface OrganizationSuggestion {
  /** Recommended approach */
  approach: 'thematic' | 'chronological' | 'methodological' | 'theoretical' | 'hybrid'
  /** Why this approach is recommended for this topic and literature */
  rationale: string
  /** If hybrid, which approaches to combine */
  hybridComponents?: ('thematic' | 'chronological' | 'methodological' | 'theoretical')[]
  /** Suggested section structure based on the analysis */
  suggestedSections?: {
    title: string
    description: string
    relatedThemes?: string[]
  }[]
}

/**
 * Methodological approaches found in the collected literature
 */
export interface MethodologicalApproach {
  /** Name of the approach (e.g., "Randomized Controlled Trial", "Case Study") */
  name: string
  /** Paper IDs using this approach */
  paperIds: string[]
  /** Prevalence in the collected literature */
  prevalence: 'common' | 'moderate' | 'rare'
}

/**
 * Complete theme analysis result from analyzing collected papers
 * This is generated AFTER paper collection and BEFORE outline generation
 */
export interface ThemeAnalysis {
  /** When the analysis was performed */
  analyzedAt: string
  
  /** Number of papers analyzed */
  papersAnalyzed: number
  
  /** Papers that had full text available (vs abstract only) */
  papersWithFullText: number
  
  /** Themes that emerged from the literature */
  emergentThemes: EmergentTheme[]
  
  /** Scholarly debates identified in the literature */
  debates: ScholarlyDebate[]
  
  /** Gaps identified in the collected literature */
  gaps: LiteratureGap[]
  
  /** Papers identified as pivotal/influential */
  pivotalPapers: PivotalPaper[]
  
  /** Methodological approaches found in the literature */
  methodologicalApproaches: MethodologicalApproach[]
  
  /** Recommended organizational approach for the paper */
  organizationSuggestion: OrganizationSuggestion
  
  /** Chronological span of the literature (earliest to most recent year) */
  temporalSpan?: {
    earliest: number
    latest: number
    concentrationPeriod?: string // e.g., "2018-2023"
  }
  
  /** Confidence score for the analysis (0-1) based on data quality */
  confidence: number
  
  /** Any limitations or caveats about the analysis */
  limitations?: string[]
}

/**
 * Input for theme extraction
 */
export interface ThemeExtractionInput {
  /** The topic being researched */
  topic: string
  /** The paper profile (provides discipline context) */
  profile: PaperProfile
  /** Papers to analyze */
  papers: {
    id: string
    title: string
    abstract?: string
    publicationDate?: string
    citationCount?: number
    venue?: string
    /** Full text chunks if available (for hybrid analysis) */
    fullTextExcerpts?: string[]
  }[]
}
