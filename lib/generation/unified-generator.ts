import 'server-only'
import { streamText, type ToolCallPart } from 'ai'
import { ai } from '@/lib/ai/vercel-client'
import { buildUnifiedPrompt, checkTopicDrift, type SectionContext, type BuildPromptOptions } from '@/lib/prompts/unified/prompt-builder'
import { addCitation } from '@/lib/ai/tools/addCitation'
import type { PaperTypeKey, SectionKey } from '@/lib/prompts/types'
// Removed stream processor - using direct citation tools instead

// Caching removed - direct prompt building only

/**
 * Unified content generator using single skeleton template with contextual data
 * Replaces the multiple hard-coded prompt approach with data-driven generation
 * 
 * Features:
 * - Single template scales from sentence → section → paper
 * - Coherence through rolling summaries
 * - Automatic topic drift detection
 * - Sentence-level streaming
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
 * Extract citations from content
 */
function extractCitations(content: string): Array<{ paperId: string; citationText: string }> {
  const citationRegex = /\[CITE:([^\]]+)\]/g
  const citations: Array<{ paperId: string; citationText: string }> = []
  let match
  
  while ((match = citationRegex.exec(content)) !== null) {
    citations.push({
      paperId: match[1],
      citationText: match[0]
    })
  }
  
  return citations
}

/**
 * Calculate unified quality score
 */
function calculateUnifiedQualityScore(params: {
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
  
  return Math.round((lengthScore + citationScore + driftScore) / 3)
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

  progress('context', 10, 'Building generation context...')
  
  const promptData = await buildPromptData(context, options)
  
  progress('generation', 20, 'Starting content generation...')
  
  const result = await streamText({
    model: ai(options.model || 'gpt-4o'),
    system: promptData.system,
    prompt: promptData.user,
    tools: { addCitation },
    temperature: options.temperature || 0.4,
    maxTokens: options.maxTokens
  })

  // Simple streaming without complex citation processing
  const sentenceEnd = /([.!?])\s+(?=[A-Z])/;
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
  } catch {}
  
  progress('generation', 50, 'Content generated successfully', {
    word_count: fullContent.split(' ').length,
    token_count: tokensUsed
  })

  const citations = extractCitations(fullContent)
  let driftCheck: UnifiedGenerationResult['driftCheck']

  if (enableDriftDetection) {
    progress('drift_check', 55, 'Checking topic drift...')
    const originalTopic = `${context.paperType} about ${context.sectionKey}`
    const rawDriftCheck = await checkTopicDrift(originalTopic, fullContent)
    
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

  const qualityScore = calculateUnifiedQualityScore({
    content: fullContent,
    citations: citations,
    targetWords: options.targetWords || 300,
    driftSimilarity: driftCheck?.similarity || 1.0
  })

  progress('complete', 100, 'Generation finished')

  return {
    content: fullContent,
    citations: citations,
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

// Block-specific helpers removed during migration to document-level diff edits

/**
 * Batch processing - process multiple sections with unified approach
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

/**
 * Helper functions
 */

/**
 * Integration with existing generator for backward compatibility
 */
export async function replaceExistingGenerator(
  paperType: string,
  section: string,
  topic: string,
  paperIds: string[],
  contextChunks: string[]
): Promise<string> {
  
  // Convert to new format
  const context: SectionContext = {
    projectId: 'legacy-project',
    sectionId: 'legacy-section',
    paperType: paperType as PaperTypeKey,
    sectionKey: section as SectionKey,
    availablePapers: paperIds,
    contextChunks: contextChunks.map(c => ({ paper_id: 'unknown', content: c }))
  }

  const result = await generateWithUnifiedTemplate({
    context,
    options: { targetWords: 1000 }
  })

  return result.content
} 