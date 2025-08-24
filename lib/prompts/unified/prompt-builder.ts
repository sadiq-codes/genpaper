import 'server-only'
import type { SectionContext } from '../types'
import { PromptService, type PromptData, type TemplateOptions, type BuiltPrompt } from '@/lib/prompts/prompt-service'

/**
 * Unified prompt builder that assembles contextual PromptData and delegates
 * template loading + rendering to PromptService (pure builder under the hood).
 */

export type UnifiedPromptData = PromptData

export interface BuildPromptOptions extends TemplateOptions {
  targetWords?: number
  forceRewrite?: boolean
  sentenceMode?: boolean // For sentence-level edits
  // Refinements
  rewriteText?: string
  previousSectionsSummary?: string
  outlineTree?: string
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
  // Project-level metadata (defaults until service integration)
  const projectData = await getProjectData()

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

  // Pre-calculate distinct papers for calibration
  const distinctPapers = new Set(workingChunks.map(c => (c as any).paper_id)).size

  // Calibrate citations to evidence diversity (prevent padding when evidence is limited)
  const dynamicTarget = Math.ceil(distinctPapers * 0.4) // 40% of distinct sources
  const minCitations = Math.max(
    2, // Lower floor when distinct sources < 4
    Math.min(distinctPapers, dynamicTarget) // Don't exceed available sources
  )

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

  // Light sampling if upstream dedup is good (>90% unique), otherwise apply full dedupe
  let distinctChunks: typeof freshChunks = []
  
  if (upstreamDedupQuality > 0.9) {
    // Light sampling - trust upstream deduplication
    console.log(`   - Using light sampling (upstream dedup is effective)`)
    const MAX_SNIPPETS = 8
    const perPaper = new Map<string, number>()
    const MAX_PER_PAPER = 2
    
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
    const MAX_SNIPPETS = 8
    const MAX_PER_PAPER = 2
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
  const sectionPurpose = await buildSectionPurpose(context.title || String(context.sectionKey))
  const exclusions = await buildExclusions(previousSummary)
  const usedEvidenceLedger = await buildUsedEvidenceLedger()
  const { requiredPoints, qualityCriteria } = await buildPlanningData(context.title || String(context.sectionKey))

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
    minCitations,
    isRewrite: Boolean(currentText) || Boolean(options.forceRewrite),
    currentText: currentText || undefined,
    evidenceSnippets,
    usedEvidenceLedger
  }
}

// Template loading is fully handled by PromptService

/**
 * Build already covered claims list from previous sections
 */
async function buildAlreadyCoveredList(): Promise<string> {
  // TODO: Replace with ProjectService.getApprovedClaims(projectId)
  const approvedSections = [] as Array<{ title: string; keyPoints?: string[] }>
  if (!approvedSections.length) {
    return ''
  }

  const coveredItems: string[] = []
  for (const section of approvedSections) {
    if (section.keyPoints?.length) {
      coveredItems.push(...section.keyPoints.map(point => `• ${section.title}: ${point}`))
    }
  }

  return coveredItems.slice(0, 10).join('\n') // Limit to top 10 items
}

/**
 * Build section purpose guidance using quality criteria generation
 */
async function buildSectionPurpose(sectionTitle: string): Promise<string> {
  try {
    // Import generators for quality criteria generation
    const { generateQualityCriteria } = await import('@/lib/prompts/generators')
    
    // Generate discipline-specific quality criteria
    const qualityCriteria = await generateQualityCriteria(
      'Research Paper', // TODO: Get actual topic from context
      sectionTitle,
      'researchArticle' // TODO: Get actual paper type from context  
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
async function buildPlanningData(sectionTitle: string): Promise<{
  requiredPoints: string
  qualityCriteria: string
}> {
  try {
    // Import planning functionality from generators.ts
    const { generateQualityCriteria } = await import('@/lib/prompts/generators')
    
    // Generate quality criteria for this section
    const criteria = await generateQualityCriteria(
      'Research Paper', // TODO: Get actual topic from context
      sectionTitle,
      'researchArticle' // TODO: Get actual paper type from context
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
 * Get project metadata (title, objectives)
 */
async function getProjectData(): Promise<{ title: string; objectives: string }> {
  // TODO: Wire via a service (e.g., ProjectService) — for now, return meaningful defaults
  const project = null as unknown as { title?: string; description?: string; metadata?: any } | null
  if (!project) {
    // Return meaningful defaults instead of empty strings to provide context
    return {
      title: 'Research Paper',
      objectives: 'Conduct systematic investigation and analysis of the research topic with evidence-based conclusions.'
    }
  }
  
  // Extract objectives from description or metadata
  const objectives = project.metadata?.objectives || 
    project.description?.substring(0, 200) + '...' ||
    'Systematic investigation and analysis of the research topic.'
  
  return {
    title: project.title || 'Research Paper',
    objectives
  }
}

/**
 * Build a text representation of the document outline tree
 */
async function buildOutlineTree(): Promise<string> {
  // TODO: This should be passed via context instead of hardcoded
  // For now, return a more generic structure until outline is passed properly
  return `• Introduction
• Literature Review  
• Methodology
• Results and Findings
• Discussion
• Conclusion`
}

/**
 * Get summaries of all approved sections before the current one
 */
async function buildPreviousSectionsSummary(currentSectionKey?: string): Promise<string> {
  // TODO: Replace with ProjectService.getApprovedSections(projectId)
  // For now, check if we have any completed sections from evidence tracker
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
async function buildSectionPath(currentSectionTitle: string): Promise<string> {
  // TODO: Replace with ProjectService.getSection(sectionId)
  const section = { title: currentSectionTitle } as { title: string }
  const path = [section.title]
  
  // Walk up the parent chain
  // Parent chain omitted without DB access
  
  return path.join(' → ')
}

/**
 * Get current text for rewrite operations
 */
async function getCurrentText(): Promise<string | null> {
  // TODO: Replace with ProjectService.getSectionContent(sectionId)
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
 */
export async function checkTopicDrift(
  newContent: string,
  previousSummary: string,
  threshold: number = 0.65
): Promise<{ isDrift: boolean; similarity: number; warning?: string }> {
  
  // Placeholder for embedding-based similarity check
  // In production, this would use pgvector or OpenAI embeddings
  
  const similarity = calculateSimpleTextSimilarity(newContent, previousSummary)
  const isDrift = similarity < threshold
  
  return {
    isDrift,
    similarity,
    warning: isDrift ? 
      `Possible topic drift detected (similarity: ${similarity.toFixed(2)}). Consider revising to maintain coherence with previous sections.` :
      undefined
  }
}

/**
 * Simple text similarity calculation (placeholder for embedding similarity)
 */
function calculateSimpleTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  
  const intersection = new Set([...words1].filter(x => words2.has(x)))
  const union = new Set([...words1, ...words2])
  
  return union.size > 0 ? intersection.size / union.size : 0
}

/**
 * Clear template cache (for development/testing)
 */
// No template cache in this module anymore

// Removed unused getProjectSummaryForDrift placeholder to satisfy linter
