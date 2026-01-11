import 'server-only'
import type { SectionContext } from '../types'
import { PromptService, type PromptData, type TemplateOptions, type BuiltPrompt } from '@/lib/prompts/prompt-service'
import { jaccardSimilarity } from '@/lib/utils/fuzzy-matching'

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
  paperType?: string // e.g., 'researchArticle', 'literatureReview'
  topic?: string
  // Original research context (for empirical papers)
  originalResearch?: OriginalResearchContext
  // Paper profile guidance (contextual intelligence from profile generation)
  profileGuidance?: string
  // Note: minSourcesRequired removed - we now use semantic citation guidance instead of quantitative enforcement
}

/**
 * Main function: builds the unified prompt with contextual data
 */
export async function buildUnifiedPrompt(
  context: SectionContext,
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
 */
async function generatePromptData(
  context: SectionContext,
  options: BuildPromptOptions
): Promise<UnifiedPromptData> {
  // Project-level metadata (from options or defaults)
  const projectData = getProjectData(options)

  // Document structure and prior coherence (defaults until service integration)
  const outlineTree = options.outlineTree || await buildOutlineTree()
  const previousSummary = options.previousSectionsSummary || await buildPreviousSectionsSummary(context.title || String(context.sectionKey))

  // Section path uses provided title when available
  const sectionPath = await buildSectionPath(context.title || String(context.sectionKey))

  // Current text (for rewrites) - default none
  const currentText = options.rewriteText ?? await getCurrentText()

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
    const paperId = (chunk as any).paper_id
    const content: string = (chunk as any).content || ''
    
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
      const paperId = (chunk as any).paper_id
      const content: string = (chunk as any).content || ''
      
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

  // Filter out already-used evidence from cross-section memory
  const { EvidenceTracker } = await import('@/lib/services/evidence-tracker')
  const freshChunks = EvidenceTracker.filterUnusedEvidence(workingChunks)
  
  console.log(`📊 Evidence filtering: ${workingChunks.length} total → ${freshChunks.length} unused chunks`)
  console.log(`📊 Deduplication metrics:`)
  console.log(`   - Cross-section filter removed: ${workingChunks.length - freshChunks.length} chunks`)
  
  // Check if chunks are already well-deduplicated upstream (from rag-retrieval.ts)
  const uniqueContentHashes = new Set<string>()
  for (const chunk of freshChunks) {
    const content: string = (chunk as any).content || ''
    if (content.trim().length >= 30) {
      const hash = content.slice(0, 80).toLowerCase().replace(/\s+/g, ' ') + 
                   content.slice(-80).toLowerCase().replace(/\s+/g, ' ')
      uniqueContentHashes.add(hash)
    }
  }
  
  const upstreamDedupQuality = uniqueContentHashes.size / Math.max(1, freshChunks.length)
  console.log(`   - Upstream dedup quality: ${(upstreamDedupQuality * 100).toFixed(1)}% unique`)

  // Calculate evidence limits for prompt size management
  // We provide diverse evidence to the LLM; it decides semantically when to cite
  // Upper bound: 35 snippets to balance prompt size with source diversity
  const MAX_SNIPPETS = Math.min(35, Math.max(totalDistinctPapers, freshChunks.length))
  
  // MAX_PER_PAPER: limit chunks per paper to encourage source diversity
  // 2 chunks per paper is a good balance - enough context without over-representing any source
  const MAX_PER_PAPER = 2
  
  console.log(`📊 Evidence limits: MAX_SNIPPETS=${MAX_SNIPPETS}, MAX_PER_PAPER=${MAX_PER_PAPER}`)

  // Light sampling if upstream dedup is good (>90% unique), otherwise apply full dedupe
  let distinctChunks: typeof freshChunks = []
  
  if (upstreamDedupQuality > 0.9) {
    // Light sampling - trust upstream deduplication
    console.log(`   - Using light sampling (upstream dedup is effective)`)
    const perPaper = new Map<string, number>()
    
    for (const chunk of freshChunks) {
      const pid = (chunk as any).paper_id || 'unknown'
      const count = perPaper.get(pid) || 0
      if (count >= MAX_PER_PAPER) continue
      
      distinctChunks.push(chunk)
      perPaper.set(pid, count + 1)
      if (distinctChunks.length >= MAX_SNIPPETS) break
    }
  } else {
    // Full deduplication needed
    console.log(`   - Applying full prompt-level deduplication`)
    const seen = new Set<string>()
    const perPaper = new Map<string, number>()

    for (const chunk of freshChunks) {
      const pid = (chunk as any).paper_id || 'unknown'
      const content: string = (chunk as any).content || ''
      if (!content || content.trim().length < 30) continue
      const key = `${pid}::${content.slice(0, 80).toLowerCase().replace(/\s+/g, ' ')}::${content.slice(-80).toLowerCase().replace(/\s+/g, ' ')}`
      if (seen.has(key)) continue
      const count = perPaper.get(pid) || 0
      if (count >= MAX_PER_PAPER) continue
      distinctChunks.push(chunk)
      seen.add(key)
      perPaper.set(pid, count + 1)
      if (distinctChunks.length >= MAX_SNIPPETS) break
    }
  }

  // JSON-format evidence for the template
  const evidenceSnippets = PromptService.formatEvidenceSnippets(distinctChunks)

  // Target words: calibrate to available facts (prevent padding)
  const baseWords = options.targetWords ?? (options.sentenceMode ? 50 : (context.expectedWords ?? 300))
  const extraDistinctChunks = Math.max(0, distinctChunks.length - distinctPapers)
  const dynamicWords = Math.min(450, 120 * distinctPapers + 40 * extraDistinctChunks)
  const targetWords = options.targetWords ? baseWords : Math.min(baseWords, dynamicWords)

  // Build new contextual data for repetition reduction
  const alreadyCovered = await buildAlreadyCoveredList()
  const topic = options.topic || projectData.title
  const paperType = options.paperType || 'researchArticle'
  const sectionPurpose = await buildSectionPurpose(context.title || String(context.sectionKey), topic, paperType)
  const exclusions = await buildExclusions(previousSummary)
  const usedEvidenceLedger = await buildUsedEvidenceLedger()
  const { requiredPoints, qualityCriteria } = await buildPlanningData(context.title || String(context.sectionKey), topic, paperType)

  // Original research context (if provided)
  const originalResearch = options.originalResearch

  return {
    paperTitle: projectData.title,
    paperObjectives: projectData.objectives,
    outlineTree,
    previousSectionsSummary: previousSummary,
    alreadyCovered,
    sectionPath,
    sectionPurpose,
    exclusions,
    requiredPoints,
    qualityCriteria,
    targetWords,
    // minCitations removed - using semantic citation guidance instead of quantitative enforcement
    isRewrite: Boolean(currentText) || Boolean(options.forceRewrite),
    currentText: currentText || undefined,
    evidenceSnippets,
    usedEvidenceLedger,
    // Original research fields for empirical papers
    hasOriginalResearch: originalResearch?.hasOriginalResearch || false,
    researchQuestion: originalResearch?.researchQuestion,
    keyFindings: originalResearch?.keyFindings,
    // Paper profile guidance (contextual intelligence)
    profileGuidance: options.profileGuidance || undefined
  }
}

// Template loading is fully handled by PromptService

/**
 * Build already covered claims list from previous sections
 * Returns empty string when no project service is available.
 * Note: This is a placeholder - full implementation requires project service integration.
 */
async function buildAlreadyCoveredList(): Promise<string> {
  // Returns empty string - callers should provide this via options when available
  return ''
}

/**
 * Build section purpose guidance using quality criteria generation
 */
async function buildSectionPurpose(sectionTitle: string, topic: string, paperType: string): Promise<string> {
  try {
    // Import generators for quality criteria generation
    const { generateQualityCriteria } = await import('@/lib/prompts/generators')
    
    // Generate discipline-specific quality criteria
    const qualityCriteria = await generateQualityCriteria(
      topic,
      sectionTitle,
      paperType as any
    )
    
    // Convert criteria to purpose statement
    const purposeStatements = qualityCriteria.map(criterion => 
      `Ensure ${criterion.toLowerCase()}`
    ).join('; ')
    
    return `${purposeStatements}; avoid repetition of previous sections`
    
  } catch (error) {
    console.warn('Failed to generate section purpose with quality criteria:', error)
    
    // Fallback to static mapping
    const sectionPurposeMap: Record<string, string> = {
      'introduction': 'Establish context and research questions; do not repeat background covered in abstract',
      'methods': 'Report procedures only; no background or results discussion', 
      'results': 'Present findings only; no interpretation or methods restatement',
      'discussion': 'Interpret results and implications; avoid restating methods or results',
      'conclusion': 'Synthesize key contributions; do not repeat detailed findings',
      'literature-review': 'Critically analyze sources; avoid listing without synthesis'
    }

    const normalizedKey = sectionTitle.toLowerCase().replace(/[^a-z]/g, '-')
    return sectionPurposeMap[normalizedKey] || `Focus on ${sectionTitle} content only; avoid repetition of previous sections`
  }
}

/**
 * Build exclusions based on what was already covered
 */
async function buildExclusions(previousSummary: string): Promise<string> {
  if (!previousSummary) {
    return ''
  }

  const exclusions: string[] = []
  
  // Extract common background elements that shouldn't be repeated
  if (previousSummary.includes('background') || previousSummary.includes('context')) {
    exclusions.push('background context already established')
  }
  if (previousSummary.includes('definition') || previousSummary.includes('defined')) {
    exclusions.push('term definitions already provided')  
  }
  if (previousSummary.includes('literature') || previousSummary.includes('review')) {
    exclusions.push('literature survey already completed')
  }
  if (previousSummary.includes('motivation') || previousSummary.includes('rationale')) {
    exclusions.push('research motivation already explained')
  }

  return exclusions.map(ex => `• ${ex}`).join('\n')
}

/**
 * Build cross-section used evidence ledger  
 */
async function buildUsedEvidenceLedger(): Promise<string> {
  const { EvidenceTracker } = await import('@/lib/services/evidence-tracker')
  return EvidenceTracker.getFormattedLedger()
}

/**
 * Build planning data (required points and quality criteria) using section planning
 */
async function buildPlanningData(sectionTitle: string, topic: string, paperType: string): Promise<{
  requiredPoints: string
  qualityCriteria: string
}> {
  try {
    // Import planning functionality from generators.ts
    const { generateQualityCriteria } = await import('@/lib/prompts/generators')
    
    // Generate quality criteria for this section
    const criteria = await generateQualityCriteria(
      topic,
      sectionTitle,
      paperType as any
    )
    
    // Format for template display
    const qualityCriteria = criteria.map(c => `• ${c}`).join('\n')
    
    // Generate required points (simplified for now)
    const requiredPoints = `• Address all ${sectionTitle} objectives\n• Integrate evidence from provided sources\n• Maintain logical flow with document structure`
    
    return {
      requiredPoints,
      qualityCriteria
    }
    
  } catch (error) {
    console.warn('Failed to generate planning data:', error)
    return {
      requiredPoints: '',
      qualityCriteria: ''
    }
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
 * Uses EvidenceTracker to infer section progress when project service is unavailable.
 * Callers can provide summaries via options.previousSectionsSummary for richer context.
 */
async function buildPreviousSectionsSummary(currentSectionKey?: string): Promise<string> {
  // Use EvidenceTracker to infer section progress from evidence usage
  const { EvidenceTracker } = await import('@/lib/services/evidence-tracker')
  const stats = EvidenceTracker.getUsageStats()
  
  if (Object.keys(stats.sectionUsage).length === 0) {
    return 'No previous sections approved yet.'
  }
  
  // Build basic summaries from evidence usage stats
  const summaries: string[] = []
  for (const [sectionTitle, chunkCount] of Object.entries(stats.sectionUsage)) {
    // Skip the current section if it's being processed
    if (currentSectionKey && sectionTitle.toLowerCase().includes(currentSectionKey.toLowerCase())) {
      continue
    }
    
    // Generate basic summary based on evidence usage
    const summary = generateBasicSectionSummary(sectionTitle, chunkCount)
    summaries.push(`**${sectionTitle}:** ${summary}`)
  }
  
  return summaries.length > 0 ? summaries.join('\n\n') : 'No previous sections approved yet.'
}

/**
 * Generate a basic section summary based on title and evidence usage
 */
function generateBasicSectionSummary(sectionTitle: string, chunkCount: number): string {
  const titleLower = sectionTitle.toLowerCase()
  
  if (titleLower.includes('introduction')) {
    return `Established context and research questions using ${chunkCount} sources. Background and motivation covered.`
  } else if (titleLower.includes('method')) {
    return `Detailed research methodology and procedures using ${chunkCount} sources. Methods and approaches defined.`
  } else if (titleLower.includes('result')) {
    return `Presented findings and outcomes using ${chunkCount} sources. Key results and data reported.`
  } else if (titleLower.includes('discussion')) {
    return `Interpreted results and implications using ${chunkCount} sources. Analysis and interpretation provided.`
  } else if (titleLower.includes('literature') || titleLower.includes('review')) {
    return `Reviewed relevant literature using ${chunkCount} sources. Prior work and gaps identified.`
  } else if (titleLower.includes('conclusion')) {
    return `Synthesized key contributions using ${chunkCount} sources. Final conclusions and future work discussed.`
  } else {
    return `Covered ${sectionTitle} content using ${chunkCount} sources from evidence base.`
  }
}

/**
 * Build section path (e.g., "Methods → Data Collection → Survey Design")
 */
/**
 * Build section path for navigation context.
 * Returns just the current section title as fallback.
 * Full hierarchical path requires project service integration.
 */
async function buildSectionPath(currentSectionTitle: string): Promise<string> {
  return currentSectionTitle
}

/**
 * Get current text for rewrite operations.
 * Returns null as fallback - callers should provide via options.rewriteText.
 */
async function getCurrentText(): Promise<string | null> {
  return null
}

/**
 * Get expected word count for a section
 */
// getExpectedWords removed; targetWords now comes from options/context

/**
 * Generate a 35-word summary of section content
 */
async function _generateSectionSummary(content: string): Promise<string> {
  // Simple extractive summary for now
  // In production, this would use AI summarization
  
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20)
  if (sentences.length === 0) return 'Content summary not available.'
  
  // Take first sentence and truncate to ~35 words
  const firstSentence = sentences[0].trim()
  const words = firstSentence.split(' ')
  
  if (words.length <= 35) {
    return firstSentence + '.'
  } else {
    return words.slice(0, 35).join(' ') + '...'
  }
}

/**
 * Check for topic drift using embedding similarity
 * Uses semantic embeddings for accurate drift detection
 */
export async function checkTopicDrift(
  newContent: string,
  previousSummary: string,
  threshold: number = 0.65
): Promise<{ isDrift: boolean; similarity: number; warning?: string }> {
  
  // Skip check if either text is too short
  if (newContent.length < 50 || previousSummary.length < 50) {
    return { isDrift: false, similarity: 1.0 }
  }
  
  try {
    // Use embedding-based similarity for accurate drift detection
    const { generateEmbeddings } = await import('@/lib/utils/embedding')
    const { cosineSimilarity } = await import('@/lib/rag/base-retrieval')
    
    // Generate embeddings for both texts
    const [newEmbedding, prevEmbedding] = await generateEmbeddings([
      newContent.slice(0, 2000), // Limit to avoid token issues
      previousSummary.slice(0, 2000)
    ])
    
    // Calculate cosine similarity
    const similarity = cosineSimilarity(newEmbedding, prevEmbedding)
    const isDrift = similarity < threshold
    
    return {
      isDrift,
      similarity,
      warning: isDrift ? 
        `Topic drift detected (semantic similarity: ${similarity.toFixed(2)}). The new content may not align well with previous sections.` :
        undefined
    }
  } catch (error) {
    // Fallback to simple Jaccard if embeddings fail
    console.warn('Embedding-based drift check failed, using fallback:', error)
    const similarity = jaccardSimilarity(newContent, previousSummary, { minWordLength: 3, minUnionSize: 1 })
    const isDrift = similarity < threshold
    
    return {
      isDrift,
      similarity,
      warning: isDrift ? 
        `Possible topic drift detected (similarity: ${similarity.toFixed(2)}).` :
        undefined
    }
  }
}

/**
 * Clear template cache (for development/testing)
 */
// No template cache in this module anymore

// Removed unused getProjectSummaryForDrift placeholder to satisfy linter
