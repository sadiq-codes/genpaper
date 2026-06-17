import 'server-only'
import type { 
  SectionContext
} from '../types'
import { PromptService, type PromptData, type TemplateOptions, type BuiltPrompt } from '@/lib/prompts/prompt-service'
import { info, warn } from '@/lib/utils/logger'
import { 
  type TemplateVoiceData,
  formatVoiceForTemplate
} from '@/lib/generation/voice-profiles'
import type { PaperVoiceConfig, QualityCriterion } from '@/lib/generation/paper-profile-types'
import type { EnrichedSectionContext } from '@/lib/synthesis-engine/outline-enricher'
import { getPaperTypeConfig } from '@/lib/generation/paper-type-config'

/**
 * Unified prompt builder that assembles contextual PromptData and delegates
 * template loading + rendering to PromptService (pure builder under the hood).
 */

export type UnifiedPromptData = PromptData

export interface OriginalResearchContext {
  hasOriginalResearch: boolean
  researchQuestion?: string
  keyFindings?: string
}

export interface BuildPromptOptions extends TemplateOptions {
  targetWords?: number
  forceRewrite?: boolean
  sentenceMode?: boolean // For sentence-level edits
  // Refinements
  rewriteText?: string
  previousSectionsSummary?: string
  outlineTree?: string
  // Project context (wired from pipeline)
  projectTitle?: string
  projectObjectives?: string
  customInstructions?: string
  paperType?: string // e.g., 'researchArticle', 'literatureReview'
  topic?: string
  // Original research context (for empirical papers)
  originalResearch?: OriginalResearchContext
  // Paper profile guidance (contextual intelligence from profile generation)
  // This is now the SINGLE SOURCE OF TRUTH for paper-type specific guidance
  profileGuidance?: string
  // Note: minSourcesRequired removed - we now use semantic citation guidance instead of quantitative enforcement
  
  // Voice/Authorial persona configuration
  // Controls hedging, confidence, citation posture, and intellectual risk
  voiceConfig?: PaperVoiceConfig
  
  // Quality criteria from paper profile - used directly instead of LLM calls
  // This eliminates per-section generateQualityCriteria() calls
  profileCriteria?: QualityCriterion[]

  // Explicit citation density for this section (from paper profile)
  sectionCitationDensity?: 'none' | 'light' | 'moderate' | 'heavy'
  
  // Output language for non-English papers (e.g., "Persian", "Chinese")
  // When set, the LLM will generate content in this language
  outputLanguage?: string
}

/**
 * Main function: builds the unified prompt with contextual data
 * Accepts both regular SectionContext and EnrichedSectionContext (with synthesis data)
 */
export async function buildUnifiedPrompt(
  context: SectionContext | EnrichedSectionContext,
  options: BuildPromptOptions = {}
): Promise<BuiltPrompt> {

  // Assemble contextual data for template
  const promptData = await generatePromptData(context, options)

  // Delegate to PromptService for template loading + rendering
  const built = await PromptService.buildUnified(promptData, {
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens
  })

  return built
}

/**
 * Generate all contextual data for the prompt
 * Handles both regular and enriched contexts
 */
async function generatePromptData(
  context: SectionContext | EnrichedSectionContext,
  options: BuildPromptOptions
): Promise<UnifiedPromptData> {
  // Project-level metadata (from options or defaults)
  const projectData = getProjectData(options)

  // Document structure and prior coherence (defaults until service integration)
  const outlineTree = options.outlineTree || await buildOutlineTree()
  const previousSummary = options.previousSectionsSummary || await buildPreviousSectionsSummary(context.title || String(context.sectionKey))

  // Section path uses provided title (hierarchical path requires project service integration)
  const sectionPath = context.title || String(context.sectionKey)

  // Current text for rewrites - only provided via options
  const currentText = options.rewriteText ?? null

  // Use provided context chunks only; no hidden retrieval here
  const workingChunks = (context.contextChunks || [])
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))

  // Pre-calculate distinct papers - count papers with meaningful content
  // RELAXED THRESHOLDS: Allow papers with just 1 chunk of 200+ chars (including abstracts)
  // This enables using abstract-only papers for citations when full-text isn't available
  // Previous thresholds (500 chars, 2 chunks) excluded 90%+ of collected papers
  const MIN_CHUNK_LENGTH = 200
  const MIN_CHUNKS_FOR_USABLE = 1
  
  const paperChunkCounts = new Map<string, number>()
  const allPaperIds = new Set<string>()
  
  for (const chunk of workingChunks) {
    const paperId = chunk.paper_id
    const content = chunk.content || ''
    
    if (paperId) {
      allPaperIds.add(paperId)
      // Only count substantial chunks (not just short abstracts)
      if (content.length >= MIN_CHUNK_LENGTH) {
        paperChunkCounts.set(paperId, (paperChunkCounts.get(paperId) || 0) + 1)
      }
    }
  }
  
  // Usable papers = papers with at least MIN_CHUNKS_FOR_USABLE substantial chunks
  const usablePaperIds = [...paperChunkCounts.entries()]
    .filter(([_, count]) => count >= MIN_CHUNKS_FOR_USABLE)
    .map(([paperId, _]) => paperId)
  
  const totalDistinctPapers = allPaperIds.size
  const usablePapers = usablePaperIds.length
  
  console.log(`📊 Content availability: ${usablePapers}/${totalDistinctPapers} papers have substantial content (≥${MIN_CHUNKS_FOR_USABLE} chunks with ≥${MIN_CHUNK_LENGTH} chars)`)
  
  // FALLBACK: If usability is still below 30%, apply emergency relaxed thresholds
  // This ensures we use SOMETHING even if most papers only have very short content
  let finalUsablePapers = usablePapers
  // Note: finalUsablePaperIds reserved for future use (e.g., filtering chunks by usable papers)
  let _finalUsablePaperIds = usablePaperIds
  
  if (totalDistinctPapers > 0 && usablePapers / totalDistinctPapers < 0.3) {
    console.warn(`⚠️ Low content coverage: only ${usablePapers} of ${totalDistinctPapers} papers meet standard thresholds`)
    console.warn(`   Applying emergency fallback: including all papers with ANY content`)
    
    // Emergency fallback: include any paper with at least 1 chunk of 50+ chars
    const EMERGENCY_MIN_CHUNK_LENGTH = 50
    const emergencyPaperIds: string[] = []
    
    for (const chunk of workingChunks) {
      const paperId = chunk.paper_id
      const content = chunk.content || ''
      
      if (paperId && content.length >= EMERGENCY_MIN_CHUNK_LENGTH && !emergencyPaperIds.includes(paperId)) {
        emergencyPaperIds.push(paperId)
      }
    }
    
    if (emergencyPaperIds.length > usablePapers) {
      console.log(`   Emergency fallback recovered ${emergencyPaperIds.length - usablePapers} additional papers`)
      finalUsablePapers = emergencyPaperIds.length
      _finalUsablePaperIds = emergencyPaperIds
    }
  }

  // Use final usable papers count (after fallback) for citation calibration
  const distinctPapers = finalUsablePapers

  // Note: We no longer enforce minimum citation counts quantitatively.
  // Instead, the LLM is instructed semantically on WHEN to cite (statistics, findings, theories, etc.)
  // This produces more natural, contextually appropriate citations.
  // See skeleton.yaml for the semantic citation checklist.
  
  console.log(`📊 Evidence availability: usablePapers=${distinctPapers}, totalPapers=${totalDistinctPapers}`)

  // Calculate source diversity target based on paper type
  const currentPaperType = options.paperType || 'researchArticle'
  const sourceDiversityTarget = calculateSourceDiversityTarget(currentPaperType, distinctPapers)
  console.log(`📊 Source diversity target: ${sourceDiversityTarget.minPapers} papers (${sourceDiversityTarget.percentage}% of ${distinctPapers})`)

  // NOTE: Evidence filtering removed - all sections now have access to all chunks
  // Previously, filterUnusedEvidence() would remove chunks used in earlier sections,
  // causing later sections to have 0 available evidence.
  // Now the full chunk pool is available to all sections.
  // Overlap detection in pipeline.ts still guards against content repetition.
  
  console.log(`📊 Evidence available: ${workingChunks.length} chunks (no filtering)`)

  // Use all chunks - token budget is already enforced upstream by ChunkRetriever
  // Chunks are sorted by relevance, so the most relevant evidence is first
  const distinctChunks = workingChunks
  
  const uniquePapersInContext = new Set(distinctChunks.map(c => c.paper_id)).size
  console.log(`📊 Evidence: ${distinctChunks.length} chunks from ${uniquePapersInContext} papers`)

  // JSON-format evidence for the template
  const evidenceSnippets = PromptService.formatEvidenceSnippets(distinctChunks)

  // Target words: use section's expected words from paper profile
  // The paper profile already determines appropriate word counts per section based on paper type
  // We only apply a minimum floor to ensure substantive content
  const MIN_SECTION_WORDS = 200
  const targetWords = options.targetWords 
    ?? (options.sentenceMode ? 50 : Math.max(MIN_SECTION_WORDS, context.expectedWords ?? 500))

  const synthesisData = buildSynthesisData(context)
  // Use profile criteria directly - no LLM call
  const sectionPurpose = buildSectionPurpose(context.title || String(context.sectionKey), options.profileCriteria)
  // Use profile criteria directly - no LLM call
  const { requiredPoints, qualityCriteria } = buildPlanningData(context.title || String(context.sectionKey), options.profileCriteria)
  const citationDiversityGuidance = buildCitationDiversityGuidance(sourceDiversityTarget, distinctPapers)
  const requiredPointsWithDiversity = [requiredPoints, citationDiversityGuidance.requiredPoint]
    .filter(Boolean)
    .join('\n')
  const qualityCriteriaWithDiversity = [qualityCriteria, citationDiversityGuidance.qualityCriterion]
    .filter(Boolean)
    .join('\n')

  // Original research context (if provided)
  const originalResearch = options.originalResearch

  // Voice/Authorial persona configuration
  // Format voice profile for template injection with section-specific modulations
  const voiceData = options.voiceConfig 
    ? formatVoiceForTemplate(
        options.voiceConfig.profileId,
        sectionPath,
        options.voiceConfig.overrides
      )
    : undefined
  
  // Add computed boolean flags for Mustache conditionals
  const voiceWithFlags = voiceData ? addVoiceConditionalFlags(voiceData) : undefined
  
  // Build quantification context for the literature base
  // This helps the LLM make accurate claims like "X of Y studies found..."
  const quantificationContext = buildQuantificationContext(
    distinctChunks,
    totalDistinctPapers,
    finalUsablePapers
  )

  return {
    paperTitle: projectData.title,
    paperObjectives: projectData.objectives,
    outlineTree,
    previousSectionsSummary: previousSummary,
    sectionPath,
    sectionPurpose,
    requiredPoints: requiredPointsWithDiversity,
    qualityCriteria: qualityCriteriaWithDiversity,
    customInstructions: options.customInstructions,
    targetWords,
    subsectionsPlan: (context.subsections && context.subsections.length > 0)
      ? context.subsections.map(s => ({
          title: s.title,
          expectedWords: s.expectedWords,
          keyPoints: s.keyPoints || []
        }))
      : undefined,
    // minCitations removed - using semantic citation guidance instead of quantitative enforcement
    isRewrite: Boolean(currentText) || Boolean(options.forceRewrite),
    currentText: currentText || undefined,
    evidenceSnippets,
    // Original research fields for empirical papers
    hasOriginalResearch: originalResearch?.hasOriginalResearch || false,
    researchQuestion: originalResearch?.researchQuestion,
    keyFindings: originalResearch?.keyFindings,
    // Paper profile guidance (contextual intelligence) - single source of truth
    profileGuidance: options.profileGuidance || undefined,
    // Voice/Authorial persona - controls hedging, confidence, citation posture
    voice: voiceWithFlags,
    // Quantification context for accurate claims about the literature base
    literatureStats: quantificationContext,
    // Explicit citation density for this section
    sectionCitationDensity: options.sectionCitationDensity,
    
    // Output language for non-English papers
    // When set, the LLM will write the entire section in this language
    outputLanguage: options.outputLanguage,
    
    // Synthesis enrichment (from EnrichedSectionContext if available)
    ...synthesisData
  }
}

/**
 * Build synthesis data from enriched context
 * Returns empty object if context is not enriched
 * Format matches PromptData.synthesisPatterns etc.
 */
function buildSynthesisData(context: SectionContext | EnrichedSectionContext): Partial<PromptData> {
  // Check if this is an enriched context
  const enriched = context as EnrichedSectionContext
  
  if (!enriched.hasSynthesisEnrichment || !enriched.synthesisContent) {
    return {}
  }
  
  // Format patterns to match PromptData.synthesisPatterns type
  const synthesisPatterns = enriched.synthesisContent.patterns.map(p => ({
    claim: p.claim,
    supportStatement: p.data.supportStatement,
    valuesSummary: p.data.valuesSummary,
    presentationApproach: p.presentationApproach,
    importance: p.importance,
    supportingPapers: p.supportingPaperIds
  }))
  
  // Format contradictions to match PromptData.synthesisContradictions type
  const synthesisContradictions = enriched.synthesisContent.contradictions.map(c => ({
    description: c.description,
    presentationApproach: c.presentationApproach,
    resolutionStrategy: c.resolutionStrategy,
    sides: c.sides.map(side => ({
      position: side.position,
      papers: side.paperIds
    }))
  }))
  
  // Format gaps to match PromptData.synthesisGaps type
  const synthesisGaps = enriched.synthesisContent.gaps.map(g => ({
    description: g.description,
    importance: g.importance,
    suggestedFutureWork: g.suggestedFutureWork
  }))
  
  // Build result matching PromptData shape
  const result: Partial<PromptData> = {}
  
  if (synthesisPatterns.length > 0) {
    result.synthesisPatterns = synthesisPatterns
  }
  
  // Determine if this section should require a table.
  // Data-driven rule: require a table only when synthesis signals are rich enough
  // to support non-template, evidence-backed rows.
  const synthesisSignalCount =
    synthesisPatterns.length + synthesisContradictions.length + synthesisGaps.length
  const hasSufficientTabularSignal = synthesisSignalCount >= 3

  const supportingPaperIds = new Set<string>()
  for (const pattern of synthesisPatterns) {
    for (const paper of pattern.supportingPapers || []) {
      if (paper) supportingPaperIds.add(paper)
    }
  }
  for (const contradiction of synthesisContradictions) {
    for (const side of contradiction.sides || []) {
      for (const paper of side.papers || []) {
        if (paper) supportingPaperIds.add(paper)
      }
    }
  }
  const hasCrossSourceComparability = supportingPaperIds.size >= 3

  const requiresTable =
    hasSufficientTabularSignal &&
    hasCrossSourceComparability

  ;(result as Record<string, unknown>).requiresTable = requiresTable
  if (requiresTable) {
    ;(result as Record<string, unknown>).tableSchemaGuidance =
      buildDynamicTableSchemaGuidance({
        patterns: synthesisPatterns,
        contradictions: synthesisContradictions,
        gaps: synthesisGaps,
        keyPointsToMake: enriched.writingGuidance?.keyPointsToMake || [],
      })
  }
  
  if (synthesisContradictions.length > 0) {
    result.synthesisContradictions = synthesisContradictions
  }
  
  if (synthesisGaps.length > 0) {
    result.synthesisGaps = synthesisGaps
  }
  
  // Add paper citation priorities if available
  if (enriched.paperPriority) {
    ;(result as Record<string, unknown>).mustCitePapers = enriched.paperPriority.primary
    ;(result as Record<string, unknown>).supportingPapers = enriched.paperPriority.supporting
  }
  
  // Add writing guidance if available
  if (enriched.writingGuidance) {
    result.sectionWritingGuidance = enriched.writingGuidance
  }
  
  // Diagnostic logging for synthesis pipeline debugging
  const sectionName = enriched.title || String(enriched.sectionKey)
  info({
    stage: 'synthesis-pipeline',
    step: 'prompt-data-built',
    section: sectionName,
    sectionKey: enriched.sectionKey,
    synthesisData: {
      hasSynthesisPatterns: !!result.synthesisPatterns,
      patternsCount: result.synthesisPatterns?.length || 0,
      hasContradictions: !!result.synthesisContradictions,
      contradictionsCount: result.synthesisContradictions?.length || 0,
      hasGaps: !!result.synthesisGaps,
      gapsCount: result.synthesisGaps?.length || 0
    },
    writingGuidance: {
      hasGuidance: !!result.sectionWritingGuidance,
      keyPointsCount: result.sectionWritingGuidance?.keyPointsToMake?.length || 0,
      approach: result.sectionWritingGuidance?.approach || 'none',
      tone: result.sectionWritingGuidance?.tone || 'none'
    }
  }, `Prompt data built for: ${sectionName}`)
  
  return result
}

function buildDynamicTableSchemaGuidance(params: {
  patterns: Array<{ claim: string; valuesSummary?: string }>
  contradictions: Array<{ description: string }>
  gaps: Array<{ description: string }>
  keyPointsToMake: string[]
}): string {
  const dimensions = new Set<string>()

  const addDimension = (value?: string) => {
    if (!value) return
    const cleaned = value.replace(/\s+/g, ' ').trim()
    if (!cleaned) return
    // Keep dimensions concise so the model can actually use them as headers.
    const words = cleaned.split(' ').slice(0, 6).join(' ')
    dimensions.add(words)
  }

  for (const keyPoint of params.keyPointsToMake.slice(0, 5)) addDimension(keyPoint)
  for (const pattern of params.patterns.slice(0, 4)) addDimension(pattern.claim)
  for (const contradiction of params.contradictions.slice(0, 3)) addDimension(contradiction.description)
  for (const gap of params.gaps.slice(0, 3)) addDimension(gap.description)

  const candidates = Array.from(dimensions).slice(0, 8)

  const quantifiedPatternCount = params.patterns.filter(p => Boolean(p.valuesSummary)).length
  const quantitativeHint =
    quantifiedPatternCount > 0
      ? `At least one column should capture quantitative contrast (rates, ranges, or effect summaries), because ${quantifiedPatternCount} pattern(s) include value summaries.`
      : 'Prefer comparative/qualitative columns grounded in source evidence.'

  const candidateText = candidates.length > 0
    ? candidates.map(d => `- ${d}`).join('\n')
    : '- Build columns directly from the strongest claims and contrasts in this section'

  return [
    'Derive a section-specific table schema (4-6 columns) from this section\'s evidence.',
    'Do NOT reuse a generic template schema across sections.',
    quantitativeHint,
    'Candidate dimensions to shape column headers:',
    candidateText,
  ].join('\n')
}

/**
 * Build quantification context for the literature base
 * Enables accurate claims like "X of Y studies found..."
 */
function buildQuantificationContext(
  chunks: Array<{ paper_id?: string; metadata?: { year?: number } }>,
  totalPapers: number,
  usablePapers: number
): {
  totalPapers: number
  usablePapers: number
  dateRange: { earliest: number; latest: number } | null
  hasSubstantialBase: boolean
} {
  // Extract years from chunks
  const years: number[] = []
  for (const chunk of chunks) {
    const year = chunk.metadata?.year
    if (year && typeof year === 'number' && year > 1900 && year < 2100) {
      years.push(year)
    }
  }
  
  const dateRange = years.length > 0
    ? { earliest: Math.min(...years), latest: Math.max(...years) }
    : null
  
  return {
    totalPapers,
    usablePapers,
    dateRange,
    hasSubstantialBase: usablePapers >= 5
  }
}

/**
 * Add boolean flags for Mustache conditionals
 * Mustache doesn't support equality checks, so we need explicit booleans
 */
function addVoiceConditionalFlags(voice: TemplateVoiceData): TemplateVoiceData & {
  hedging: TemplateVoiceData['hedging'] & {
    density_high: boolean
    density_medium: boolean
    density_low: boolean
  }
  citationPosture: TemplateVoiceData['citationPosture'] & {
    style_supportive: boolean
    style_contrastive: boolean
    style_mixed: boolean
  }
} {
  return {
    ...voice,
    hedging: {
      ...voice.hedging,
      density_high: voice.hedging.density === 'high',
      density_medium: voice.hedging.density === 'medium',
      density_low: voice.hedging.density === 'low'
    },
    citationPosture: {
      ...voice.citationPosture,
      style_supportive: voice.citationPosture.style === 'supportive',
      style_contrastive: voice.citationPosture.style === 'contrastive',
      style_mixed: voice.citationPosture.style === 'mixed'
    }
  }
}

// Template loading is fully handled by PromptService

/**
 * Build section purpose guidance using profile criteria directly
 * NO LLM CALLS - uses criteria from paper profile generation
 * 
 * @param sectionTitle - The section being generated
 * @param profileCriteria - Quality criteria from PaperProfile (already generated)
 */
function buildSectionPurpose(sectionTitle: string, profileCriteria?: QualityCriterion[]): string {
  // Use profile criteria directly - no LLM call needed
  // The paper profile already contains discipline-specific quality criteria
  if (profileCriteria && profileCriteria.length > 0) {
    const purposeStatements = profileCriteria.slice(0, 3).map(c => 
      `Ensure ${c.criterion.toLowerCase()}`
    ).join('; ')
    
    return `${purposeStatements}; avoid repetition of previous sections`
  }
  
  // If no profile criteria provided, return generic guidance
  // This should rarely happen since profile is always generated first
  warn({
    stage: 'prompt-builder',
    step: 'build-section-purpose',
    section: sectionTitle
  }, 'No profile criteria provided - using generic guidance')
  
  return `Focus on ${sectionTitle} objectives; integrate evidence from sources; avoid repetition of previous sections`
}

/**
 * Build planning data (required points and quality criteria) using section planning
 */
/**
 * Build planning data using profile criteria directly
 * NO LLM CALLS - uses criteria from paper profile generation
 * 
 * @param sectionTitle - The section being generated
 * @param profileCriteria - Quality criteria from PaperProfile (already generated)
 */
function buildPlanningData(sectionTitle: string, profileCriteria?: QualityCriterion[]): {
  requiredPoints: string
  qualityCriteria: string
} {
  // Use profile criteria directly - no LLM call needed
  // The paper profile already contains discipline-specific quality criteria
  if (profileCriteria && profileCriteria.length > 0) {
    const qualityCriteria = profileCriteria.map(c => `• ${c.criterion}: ${c.howToAchieve}`).join('\n')
    const requiredPoints = `• Address all ${sectionTitle} objectives\n• Integrate evidence from provided sources\n• Maintain logical flow with document structure`
    
    return {
      requiredPoints,
      qualityCriteria
    }
  }
  
  // If no profile criteria provided, return minimal guidance
  // This should rarely happen since profile is always generated first
  warn({
    stage: 'prompt-builder',
    step: 'build-planning-data',
    section: sectionTitle
  }, 'No profile criteria provided - using minimal guidance')
  
  return {
    requiredPoints: `• Address all ${sectionTitle} objectives\n• Integrate evidence from provided sources`,
    qualityCriteria: ''
  }
}

/**
 * Get project metadata (title, objectives) from options or defaults
 */
function getProjectData(options: BuildPromptOptions): { title: string; objectives: string } {
  return {
    title: options.projectTitle || options.topic || 'Research Paper',
    objectives: options.projectObjectives || 
      `Conduct systematic investigation and analysis of ${options.topic || 'the research topic'} with evidence-based conclusions.`
  }
}

/**
 * Build a text representation of the document outline tree
 * Returns a generic academic paper structure as fallback.
 * Callers should provide outline via options.outlineTree when available.
 */
async function buildOutlineTree(): Promise<string> {
  return `• Introduction
• Literature Review  
• Methodology
• Results and Findings
• Discussion
• Conclusion`
}

/**
 * Get summaries of all approved sections before the current one.
 * Callers can provide summaries via options.previousSectionsSummary for richer context.
 */
async function buildPreviousSectionsSummary(currentSectionKey?: string): Promise<string> {
  void currentSectionKey
  // Evidence ledger tracking was removed; callers should provide
  // options.previousSectionsSummary when they want this filled.
  return 'No previous sections approved yet.'
}

// Removed placeholder functions:
// - buildSectionPath: was just returning input, now inlined
// - getCurrentText: was returning null, now inlined  
// - _generateSectionSummary: unused
// - buildAlreadyCoveredList: was returning empty string, now inlined

function calculateSourceDiversityTarget(paperType: string, availablePapers: number): { percentage: number; minPapers: number } {
  const percentage = getPaperTypeConfig(paperType).diversityTargetPct
  const minPapers = Math.ceil(availablePapers * (percentage / 100))
  return { percentage, minPapers }
}

function buildCitationDiversityGuidance(
  sourceDiversityTarget: { percentage: number; minPapers: number },
  usablePapers: number
): { requiredPoint: string; qualityCriterion: string } {
  if (usablePapers < 2) {
    return { requiredPoint: '', qualityCriterion: '' }
  }

  const sectionDistinctTarget = usablePapers >= 12 ? 4 : usablePapers >= 6 ? 3 : 2
  const dominanceCap = usablePapers >= 8 ? 35 : 45

  return {
    requiredPoint: `• Use at least ${sectionDistinctTarget} distinct paper_ids in this section when evidence allows`,
    qualityCriterion: [
      `• Citation diversity: avoid source dominance (no single paper should drive more than ${dominanceCap}% of citations in this section unless evidence is sparse)`,
      `• Full-paper diversity target: cite about ${sourceDiversityTarget.minPapers} distinct papers (${sourceDiversityTarget.percentage}% of usable sources) across the complete document`
    ].join('\n')
  }
}
