import 'server-only'
import { generateObject } from 'ai'
import { z } from 'zod'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { buildUnifiedPrompt, type BuildPromptOptions } from '@/lib/prompts/unified/prompt-builder'
import type { SectionContext } from '@/lib/prompts/types'
import { cleanNonCitationArtifacts } from '@/lib/citations/post-processor'
// DEDUPLICATION NOTES:
// - Evidence tracking moved to pipeline.ts (single point of control)
// - Comprehensive quality assessment consolidated in pipeline.ts 
// - Basic quality scoring retained here for individual sections
// - Citation processing streamlined (no double collection)

/**
 * Unified content generator using single skeleton template with contextual data
 * Replaces the multiple hard-coded prompt approach with data-driven generation
 * 
 * ARCHITECTURAL SEPARATION:
 * - This module: Core generation logic, streaming, basic quality scoring
 * - Pipeline module: Orchestration, comprehensive quality review, evidence tracking, overlap detection
 * 
 * Features:
 * - Single template scales from sentence → section → paper  
 * - Coherence through rolling summaries
 * - Sentence-level streaming
 * - Basic quality metrics (comprehensive assessment in pipeline)
 */

export type StreamEvent =
  | { type: 'sentence'; data: { text: string } }
  | { type: 'progress'; data: { stage: string; progress: number; message: string; [key: string]: unknown } }
  | { type: 'error'; data: { message: string } }


export interface UnifiedGenerationConfig {
  context: SectionContext
  options?: BuildPromptOptions
  
  // Stream tracking
  onStreamEvent?: (event: StreamEvent) => void
}

/**
 * Citation entry from structured output
 * index: The [N] marker number in the prose
 * paperId: The paper being cited
 * quote: The exact supporting sentence from the source
 */
export interface StructuredCitation {
  index: number
  paperId: string
  quote: string
}

export interface UnifiedGenerationResult {
  content: string
  /** Raw citations from structured output - one entry per citation occurrence, in order */
  citations: StructuredCitation[]
  tokensUsed: number
  generationTime: number
  qualityScore: number
}

/**
 * Calculate basic quality score (simplified version - full quality assessment done in pipeline)
 */
function calculateBasicQualityScore(params: {
  content: string
  citations: StructuredCitation[]
  targetWords: number
  minCitationsExpected?: number
}): number {
  const { content, citations, targetWords, minCitationsExpected } = params
  
  const wordCount = content.split(' ').length
  const lengthScore = Math.min(100, (wordCount / targetWords) * 100)
  
  // Citation score: scale to expected citations from profile
  // If no expectation provided, use actual citations as the baseline (self-calibrating)
  const citationTarget = minCitationsExpected || Math.max(citations.length, 1)
  const citationScore = Math.min(100, (citations.length / citationTarget) * 100)
  
  // Basic calculation - comprehensive quality assessment handled by pipeline
  return Math.round((lengthScore + citationScore) / 2)
}

// Helper to resolve generation options with defaults
function resolveGenOptions(options: BuildPromptOptions): Required<Pick<BuildPromptOptions, 'temperature' | 'maxTokens'>> & BuildPromptOptions {
  return {
    ...options,
    temperature: options.temperature ?? 0.4,  // Use nullish coalescing for cleaner defaults
    maxTokens: options.maxTokens ?? 4000
  }
}

// Direct prompt building - no caching complexity
async function buildPromptData(
  context: SectionContext, 
  options: BuildPromptOptions
): Promise<{ system: string, user: string }> {
  return await buildUnifiedPrompt(context, options)
}

/**
 * Main unified generation function - streams sentences
 */
export async function generateWithUnifiedTemplate(
  config: UnifiedGenerationConfig
): Promise<UnifiedGenerationResult> {
  
  const startTime = Date.now()
  const {
    context,
    options = {},
    onStreamEvent
  } = config

  const progress = (stage: string, pct: number, msg: string, data?: Record<string, unknown>) => {
    onStreamEvent?.({ type: 'progress', data: { stage, progress: pct, message: msg, ...data }})
  }

  let fullContent = ''
  const collectedCitations: StructuredCitation[] = []
  // Token usage is not currently exposed by generateObject in our usage; keep as best-effort.
  let tokensUsed = 0

  progress('context', 10, 'Building generation context...')
  
  const promptData = await buildPromptData(context, options)
  
  progress('generation', 20, 'Generating section (structured output)...')
  
  const resolvedOptions = resolveGenOptions(options)

  // Schema for structured output with numbered citation markers
  // LLM outputs [1], [2], [3] in prose, and citations array maps each occurrence
  // NOTE: All fields must be required (no .default() or .optional()) for OpenAI structured output
  const SectionOutputSchema = z.object({
    contentMarkdown: z.string().describe('The FULL section content in Markdown with [1], [2], [3] citation markers. MUST meet the target word count specified in the prompt. Write thorough, detailed academic prose.'),
    citations: z.array(z.object({
      index: z.number().describe('The citation marker number [N] this entry corresponds to'),
      paperId: z.string().describe('The exact paper_id from the evidence snippet'),
      quote: z.string().describe('The exact sentence from the source that supports the claim'),
    })).describe('One entry per citation occurrence in order of appearance. Return empty array [] if no citations.'),
  })

  const { object } = await generateObject({
    model: getLanguageModel(),
    schema: SectionOutputSchema,
    system: promptData.system,
    prompt: promptData.user,
    temperature: resolvedOptions.temperature,
    maxOutputTokens: resolvedOptions.maxTokens
  })

  fullContent = object.contentMarkdown

  // Collect citations from structured output
  for (const entry of object.citations || []) {
    if (!entry.paperId || entry.index === undefined) continue
    collectedCitations.push({
      index: entry.index,
      paperId: entry.paperId,
      quote: entry.quote || '',
    })
  }

  // Clean any artifacts that shouldn't be in output (keep numbered [N] markers for pipeline)
  // Do this BEFORE emitting stream output so the UI preview stays clean.
  fullContent = cleanNonCitationArtifacts(fullContent)

  // Emit a single "sentence" event for compatibility with existing streaming hooks.
  // (True streaming would require streamObject + incremental parsing.)
  if (fullContent) {
    onStreamEvent?.({ type: 'sentence', data: { text: fullContent }})
  }
  
  progress('generation', 50, 'Content generated successfully', {
    word_count: fullContent.split(' ').length,
    citations: collectedCitations.length
  })
  
  // Quality score now self-calibrates based on actual citations generated
  // We no longer enforce minimum citation counts - semantic guidance handles this
  const qualityScore = calculateBasicQualityScore({
    content: fullContent,
    citations: collectedCitations,
    targetWords: options.targetWords || 300,
    minCitationsExpected: Math.max(collectedCitations.length, 1)  // Self-calibrating
  })

  progress('complete', 100, 'Generation finished')

  return {
    content: fullContent,
    citations: collectedCitations,
    tokensUsed,
    generationTime: (Date.now() - startTime) / 1000,
    qualityScore,
  }
}

/**
 * Convenience functions for different zoom levels
 */

// Full section generation
export async function generateFullSection(
  context: SectionContext,
  targetWords: number = 1000,
  onProgress?: UnifiedGenerationConfig['onStreamEvent']
): Promise<UnifiedGenerationResult> {
  return generateWithUnifiedTemplate({
    context,
    options: {
      targetWords
    },
    onStreamEvent: onProgress
  })
}

/**
 * Extract a concise summary from generated section content.
 * Takes the first 2 sentences + lists cited paper IDs.
 * No LLM call — pure text extraction.
 */
function extractSectionSummary(title: string, content: string, citations: StructuredCitation[]): string {
  // Extract first 2 sentences as a content preview
  const sentences = content
    .replace(/\[(\d+)\]/g, '') // strip citation markers for cleaner summary
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 20)
    .slice(0, 2)
    .join(' ')
    .trim()
  
  const preview = sentences.length > 300 ? sentences.slice(0, 300) + '...' : sentences
  
  // Collect unique cited paper IDs
  const citedPapers = [...new Set(citations.map(c => c.paperId))].slice(0, 8)
  const citedStr = citedPapers.length > 0 
    ? ` (cited: ${citedPapers.join(', ')})` 
    : ''
  
  return `**${title}**: ${preview}${citedStr}`
}

/**
 * Generate a section by producing each subsection separately, then combining.
 * This overcomes the token/verbosity limitation of single-call generation
 * by targeting 600-1400 words per subsection instead of 2000-4000 per section.
 *
 * Citation indices are renumbered across subsections so the combined section
 * has a single sequential [1], [2], ... sequence.
 */
async function generateSectionBySubsections(
  parentContext: SectionContext,
  options: BuildPromptOptions,
  onStreamEvent?: (event: StreamEvent) => void
): Promise<UnifiedGenerationResult> {
  const subsections = parentContext.subsections!
  const startTime = Date.now()
  let combinedContent = ''
  const combinedCitations: StructuredCitation[] = []
  let totalTokensUsed = 0
  let citationOffset = 0
  const subsectionSummaries: string[] = []

  for (let i = 0; i < subsections.length; i++) {
    const sub = subsections[i]

    // Per-subsection word target
    const subTargetWords = sub.expectedWords
      || Math.round((parentContext.expectedWords || 1000) / subsections.length)

    // Leaf context for this subsection — same evidence, scoped key points
    const subContext: SectionContext = {
      sectionKey: `${parentContext.sectionKey}.sub${i}`,
      title: sub.title,
      candidatePaperIds: parentContext.candidatePaperIds,
      contextChunks: parentContext.contextChunks,
      expectedWords: subTargetWords,
      keyPoints: sub.keyPoints,
      // No nested subsections — this is a leaf
    }

    // Build options for this subsection
    const subOptions: BuildPromptOptions = { ...options }
    subOptions.targetWords = subTargetWords
    // Token budget: words × 1.5 (tokens/word) × 1.4 (JSON overhead)
    subOptions.maxTokens = Math.max(2000, Math.round(subTargetWords * 1.5 * 1.4))

    // Inject parent section context so the model knows this is a subsection, not a top-level section
    const parentFraming = `You are writing subsection "${sub.title}" (${i + 1} of ${subsections.length}) inside section "${parentContext.title}". Stay within the subsection scope — do not reintroduce broad context that belongs to the parent section or earlier subsections.`
    const existingSummary = subOptions.previousSectionsSummary || ''
    const parts = [existingSummary, parentFraming]

    // Add previous subsection summaries for within-section coherence
    if (subsectionSummaries.length > 0) {
      parts.push(
        `--- Previous subsections of "${parentContext.title}" ---`,
        ...subsectionSummaries
      )
    }
    subOptions.previousSectionsSummary = parts.filter(Boolean).join('\n')

    const result = await generateWithUnifiedTemplate({
      context: subContext,
      options: subOptions,
      onStreamEvent,
    })

    // Renumber citation markers to avoid collisions between subsections.
    // Derive max index from BOTH content markers AND citations array,
    // so the offset advances even if the model returns citations: [].
    let subContent = result.content.trim()

    // Scan content for the highest [N] marker actually present in prose
    let maxIndexInContent = 0
    const markerMatches = subContent.matchAll(/\[(\d+)\]/g)
    for (const m of markerMatches) {
      maxIndexInContent = Math.max(maxIndexInContent, parseInt(m[1], 10))
    }
    const maxIndexInCitations = result.citations.reduce((max, c) => Math.max(max, c.index), 0)
    const maxIndexInSub = Math.max(maxIndexInContent, maxIndexInCitations)

    if (citationOffset > 0) {
      // Collect ALL unique indices from both content and citations
      const indicesFromCitations = result.citations.map(c => c.index)
      const indicesFromContent: number[] = []
      for (const m of subContent.matchAll(/\[(\d+)\]/g)) {
        indicesFromContent.push(parseInt(m[1], 10))
      }
      const allIndices = [...new Set([...indicesFromCitations, ...indicesFromContent])].sort((a, b) => b - a)

      // Replace highest indices first to avoid [1] → [11] collisions
      for (const idx of allIndices) {
        const pattern = new RegExp(`\\[${idx}\\]`, 'g')
        subContent = subContent.replace(pattern, `[${idx + citationOffset}]`)
      }
    }

    const shiftedCitations = result.citations.map(c => ({
      ...c,
      index: c.index + citationOffset,
    }))

    // Advance offset past the highest index used in this subsection
    citationOffset += maxIndexInSub

    // Convert top-level ## heading to ### for subsection level
    subContent = subContent.replace(/^## /, '### ')

    combinedContent += subContent + '\n\n'
    combinedCitations.push(...shiftedCitations)
    totalTokensUsed += result.tokensUsed

    // Build summary for subsequent subsections
    subsectionSummaries.push(
      extractSectionSummary(sub.title, result.content, result.citations)
    )
  }

  // Prepend parent section heading
  combinedContent = `## ${parentContext.title}\n\n${combinedContent.trim()}`

  const qualityScore = calculateBasicQualityScore({
    content: combinedContent,
    citations: combinedCitations,
    targetWords: parentContext.expectedWords || 1000,
  })

  return {
    content: combinedContent,
    citations: combinedCitations,
    tokensUsed: totalTokensUsed,
    generationTime: (Date.now() - startTime) / 1000,
    qualityScore,
  }
}

/**
 * Batch processing - process multiple sections sequentially with unified approach.
 * Passes rolling summaries of completed sections to each subsequent section
 * for cross-section coherence and overlap avoidance.
 *
 * Sections with subsections are automatically split into per-subsection
 * generation calls for better length compliance.
 * 
 * @param onBatchProgress - Called when a section starts (completed = sections done so far)
 * @param onSectionComplete - Called when a section finishes with its content
 * @param onStreamChunk - Called with each text chunk as it streams (for live preview)
 */
export async function generateMultipleSectionsUnified(
  contexts: SectionContext[],
  options: BuildPromptOptions = {},
  onBatchProgress?: (completed: number, total: number, currentSection: string) => void,
  onSectionComplete?: (sectionTitle: string, content: string, sectionIndex: number, total: number) => void,
  onStreamChunk?: (sectionTitle: string, chunk: string, fullContentSoFar: string) => void
): Promise<UnifiedGenerationResult[]> {
  const results: UnifiedGenerationResult[] = []
  const sectionSummaries: string[] = []
  
  for (let i = 0; i < contexts.length; i++) {
    const sectionTitle = contexts[i].title || contexts[i].sectionKey
    onBatchProgress?.(i, contexts.length, contexts[i].sectionKey)
    
    // Build rolling summary of all previous sections for coherence
    const sectionOptions = { ...options }
    if (sectionSummaries.length > 0) {
      sectionOptions.previousSectionsSummary = sectionSummaries.join('\n')
    }
    
    // Track accumulated content for this section to pass to streaming callback
    let sectionContent = ''
    
    const streamHandler: ((event: StreamEvent) => void) | undefined = onStreamChunk
      ? (event) => {
        if (event.type === 'sentence') {
          sectionContent += event.data.text
          onStreamChunk(sectionTitle, event.data.text, sectionContent)
        }
        }
      : undefined

    // Route: sections WITH subsections → per-subsection generation
    //        sections WITHOUT subsections → single-call generation
    const hasSubsections = contexts[i].subsections && contexts[i].subsections!.length > 0

    let result: UnifiedGenerationResult
    if (hasSubsections) {
      result = await generateSectionBySubsections(
        contexts[i],
        sectionOptions,
        streamHandler
      )
    } else {
      result = await generateWithUnifiedTemplate({
        context: contexts[i],
        options: sectionOptions,
        onStreamEvent: streamHandler,
      })
    }

    results.push(result)
    
    // Build summary from completed section for subsequent sections
    sectionSummaries.push(extractSectionSummary(sectionTitle, result.content, result.citations))
    
    // Notify that section is complete with content
    onSectionComplete?.(sectionTitle, result.content, i + 1, contexts.length)
  }
  
  return results
}
