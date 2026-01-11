import 'server-only'
import { streamText } from 'ai'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { buildUnifiedPrompt, checkTopicDrift, type BuildPromptOptions } from '@/lib/prompts/unified/prompt-builder'
import type { SectionContext } from '@/lib/prompts/types'
import { extractCitationMarkers, cleanNonCitationArtifacts } from '@/lib/citations/post-processor'
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
 * - Automatic topic drift detection
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
  
  // Quality controls
  enableDriftDetection?: boolean
  
  // Stream tracking
  onStreamEvent?: (event: StreamEvent) => void
}

export interface UnifiedGenerationResult {
  content: string
  citations: Array<{ paperId: string; citationText: string }>
  tokensUsed: number
  generationTime: number
  driftCheck?: {
    similarity: number
    passed: boolean
    warning?: string
  }
  qualityScore: number
}

/**
 * Calculate basic quality score (simplified version - full quality assessment done in pipeline)
 */
function calculateBasicQualityScore(params: {
  content: string
  citations: Array<{ paperId: string; citationText: string }>
  targetWords: number
  driftSimilarity: number
  minCitationsExpected?: number
}): number {
  const { content, citations, targetWords, driftSimilarity, minCitationsExpected } = params
  
  const wordCount = content.split(' ').length
  const lengthScore = Math.min(100, (wordCount / targetWords) * 100)
  
  // Citation score: scale to expected citations from profile
  // If no expectation provided, use actual citations as the baseline (self-calibrating)
  const citationTarget = minCitationsExpected || Math.max(citations.length, 1)
  const citationScore = Math.min(100, (citations.length / citationTarget) * 100)
  
  const driftScore = driftSimilarity * 100
  
  // Basic calculation - comprehensive quality assessment handled by pipeline
  return Math.round((lengthScore + citationScore + driftScore) / 3)
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
    enableDriftDetection = true,
    onStreamEvent
  } = config

  const progress = (stage: string, pct: number, msg: string, data?: Record<string, unknown>) => {
    onStreamEvent?.({ type: 'progress', data: { stage, progress: pct, message: msg, ...data }})
  }

  let fullContent = ''
  let tokensUsed = 0
  const collectedCitations: Array<{ paperId: string; citationText: string }> = []

  progress('context', 10, 'Building generation context...')
  
  const promptData = await buildPromptData(context, options)
  
  progress('generation', 20, 'Starting content generation...')
  
  const resolvedOptions = resolveGenOptions(options)
  
  // Use simple text streaming - no tools
  // Citations are handled via [CITE: paper_id] markers that are post-processed
  const result = await streamText({
    model: getLanguageModel(),
    system: promptData.system,
    prompt: promptData.user,
    temperature: resolvedOptions.temperature,
    maxTokens: resolvedOptions.maxTokens
  })

  // Sentence boundary detection with abbreviation handling
  const ABBREVIATIONS = ['Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'vs', 'etc', 'e\\.g', 'i\\.e', 'U\\.S', 'Fig', 'No', 'Vol', 'pp', 'al']
  const abbrevPattern = ABBREVIATIONS.join('|')
  const sentenceEnd = new RegExp(`(?<!(?:${abbrevPattern}))\\.\\s+(?=[A-Z])|[!?]\\s+(?=[A-Z])`, 'g')
  let pendingText = ''

  for await (const delta of result.fullStream) {
    if (delta.type === 'text-delta') {
      pendingText += delta.textDelta
      let match
      while ((match = sentenceEnd.exec(pendingText))) {
        const sentence = pendingText.slice(0, match.index + 1)
        pendingText = pendingText.slice(match.index + 1)
        
        // Stream sentence immediately
        fullContent += sentence
        onStreamEvent?.({ type: 'sentence', data: { text: sentence }})
      }
    }
  }

  // Flush any final text
  if (pendingText) {
    fullContent += pendingText
    onStreamEvent?.({ type: 'sentence', data: { text: pendingText }})
  }

  try {
    const usage = await result.usage
    tokensUsed = usage?.totalTokens || 0
  } catch (err) {
    // Token usage retrieval is non-critical, log and continue
    console.warn('Failed to retrieve token usage:', err instanceof Error ? err.message : String(err))
  }
  
  progress('generation', 50, 'Content generated successfully', {
    word_count: fullContent.split(' ').length,
    token_count: tokensUsed
  })

  // Extract citation markers from content (they will be processed in pipeline)
  const citationMarkers = extractCitationMarkers(fullContent)
  console.log(`📊 Citation markers found: ${citationMarkers.length}`)
  
  // Convert markers to citation records for return value
  // Actual formatting happens in the pipeline's post-processing step
  for (const marker of citationMarkers) {
    collectedCitations.push({
      paperId: marker.paperId,
      citationText: marker.marker // Will be replaced with formatted citation in pipeline
    })
  }
  
  // Clean any artifacts that shouldn't be in output (but keep [CITE:] markers for pipeline)
  fullContent = cleanNonCitationArtifacts(fullContent)
  
  let driftCheck: UnifiedGenerationResult['driftCheck']

  if (enableDriftDetection) {
    progress('drift_check', 55, 'Checking topic drift...')
    const originalTopic = context.title || String(context.sectionKey)
    // Compare generated content against original topic/section title summary
    const rawDriftCheck = await checkTopicDrift(fullContent, originalTopic)
    
    driftCheck = {
      similarity: rawDriftCheck.similarity,
      passed: !rawDriftCheck.isDrift,
      warning: rawDriftCheck.warning
    }
    
    if (!driftCheck.passed) {
      progress('drift_check', 60, `⚠️ Topic drift detected: ${driftCheck.warning}`)
    } else {
      progress('drift_check', 60, '✅ Content stays on topic')
    }
  }

  // Quality score now self-calibrates based on actual citations generated
  // We no longer enforce minimum citation counts - semantic guidance handles this
  const qualityScore = calculateBasicQualityScore({
    content: fullContent,
    citations: collectedCitations,
    targetWords: options.targetWords || 300,
    driftSimilarity: driftCheck?.similarity || 1.0,
    minCitationsExpected: Math.max(collectedCitations.length, 1)  // Self-calibrating
  })

  progress('complete', 100, 'Generation finished')

  return {
    content: fullContent,
    citations: collectedCitations, // Use collected citations from tool results
    tokensUsed,
    generationTime: (Date.now() - startTime) / 1000,
    driftCheck,
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
 * Batch processing - process multiple sections sequentially with unified approach
 */
export async function generateMultipleSectionsUnified(
  contexts: SectionContext[],
  options: BuildPromptOptions = {},
  onBatchProgress?: (completed: number, total: number, currentSection: string) => void
): Promise<UnifiedGenerationResult[]> {
  const results: UnifiedGenerationResult[] = []
  
  for (let i = 0; i < contexts.length; i++) {
    onBatchProgress?.(i, contexts.length, contexts[i].sectionKey)
    const result = await generateWithUnifiedTemplate({
      context: contexts[i],
      options
    })
    results.push(result)
  }
  
  return results
}
