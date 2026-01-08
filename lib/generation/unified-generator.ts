import 'server-only'
import { streamText, type ToolCallPart } from 'ai'
import { ai } from '@/lib/ai/vercel-client'
import { buildUnifiedPrompt, checkTopicDrift, type BuildPromptOptions } from '@/lib/prompts/unified/prompt-builder'
import type { SectionContext } from '@/lib/prompts/types'
import { addCitation } from '@/lib/ai/tools/addCitation'
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
  | { type: 'citation'; data: ToolCallPart }
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
}): number {
  const { content, citations, targetWords, driftSimilarity } = params
  
  const wordCount = content.split(' ').length
  const lengthScore = Math.min(100, (wordCount / targetWords) * 100)
  const citationScore = Math.min(100, citations.length * 20) // 5 citations = 100%
  const driftScore = driftSimilarity * 100
  
  // Basic calculation - comprehensive quality assessment handled by pipeline
  return Math.round((lengthScore + citationScore + driftScore) / 3)
}

// Helper to resolve generation options with defaults
function resolveGenOptions(options: BuildPromptOptions): Required<Pick<BuildPromptOptions, 'model' | 'temperature' | 'maxTokens'>> & BuildPromptOptions {
  return {
    ...options,
    model: options.model || 'gpt-4o',
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
  const result = await streamText({
    model: ai(resolvedOptions.model),
    system: promptData.system,
    prompt: promptData.user,
    tools: { addCitation },
    temperature: resolvedOptions.temperature,
    maxTokens: resolvedOptions.maxTokens
  })

  // Sentence boundary detection with abbreviation handling
  // Uses negative lookbehind to avoid breaking on common abbreviations
  // Matches: period/exclaim/question + space(s) + capital letter
  // Excludes: Dr., Mr., Mrs., Ms., Prof., vs., etc., e.g., i.e., U.S., Fig., No.
  const ABBREVIATIONS = ['Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'vs', 'etc', 'e\\.g', 'i\\.e', 'U\\.S', 'Fig', 'No', 'Vol', 'pp', 'al']
  const abbrevPattern = ABBREVIATIONS.join('|')
  const sentenceEnd = new RegExp(`(?<!(?:${abbrevPattern}))\\.\\s+(?=[A-Z])|[!?]\\s+(?=[A-Z])`, 'g')
  let pendingText = '';

  for await (const delta of result.fullStream) {
    if (delta.type === 'text-delta') {
      pendingText += delta.textDelta
      let match;
      while ((match = sentenceEnd.exec(pendingText))) {
        const sentence = pendingText.slice(0, match.index + 1)
        pendingText = pendingText.slice(match.index + 1)
        
        // Stream sentence immediately
        fullContent += sentence
        onStreamEvent?.({ type: 'sentence', data: { text: sentence }})
      }
    } else if (delta.type === 'tool-call' && delta.toolName === 'addCitation') {
        // Flush any remaining text before citation
        if (pendingText) {
            fullContent += pendingText
            onStreamEvent?.({ type: 'sentence', data: { text: pendingText }})
            pendingText = ''
        }
        onStreamEvent?.({ type: 'citation', data: delta })
    } else if ((delta as any).type === 'tool-result' && (delta as any).toolName === 'addCitation') {
        // Collect citation record from tool result AND append formatted citation
        try {
          const payload: any = (delta as any).result ?? (delta as any).toolResult ?? (delta as any)
          const paperId = payload?.paper_id
          const formatted = payload?.formatted_citation || payload?.formatted || payload?.data?.formatted_citation
          
          // Collect citation record for return value
          if (paperId && typeof paperId === 'string') {
            collectedCitations.push({
              paperId: paperId,
              citationText: formatted || `[${paperId}]`
            })
          }
          
          // Append formatted citation to content
          if (typeof formatted === 'string' && formatted.trim().length > 0) {
            // Insert a space if needed before citation
            const spacer = fullContent.endsWith(' ') || formatted.startsWith(' ') ? '' : ' '
            fullContent += spacer + formatted
            onStreamEvent?.({ type: 'sentence', data: { text: spacer + formatted }})
          }
        } catch (error) {
          console.warn('Error processing citation tool result:', error)
          // Continue processing without breaking stream
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

  // Use collected citations from tool results instead of text extraction
  console.log(`📊 Citations collected from tools: ${collectedCitations.length}`)
  
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

  const qualityScore = calculateBasicQualityScore({
    content: fullContent,
    citations: collectedCitations,
    targetWords: options.targetWords || 300,
    driftSimilarity: driftCheck?.similarity || 1.0
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
      targetWords,
      model: 'gpt-4-turbo-preview'
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
