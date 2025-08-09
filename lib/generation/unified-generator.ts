import 'server-only'
import { streamText, type ToolCallPart } from 'ai'
import { ai } from '@/lib/ai/vercel-client'
import { buildUnifiedPrompt, checkTopicDrift, type SectionContext, type BuildPromptOptions } from '@/lib/prompts/unified/prompt-builder'
import { addCitation } from '@/lib/ai/tools/addCitation'
import type { PaperTypeKey, SectionKey } from '@/lib/prompts/types'
import { createCitationStreamProcessor } from '@/lib/generation/stream-processor'

// 🆕 OPTIMIZATION: Context caching system
interface CachedSectionContext {
  key: string
  context: string
  paperSetHash: string
  timestamp: number
  ttl: number
}

// Simple in-memory cache for section contexts
const contextCache = new Map<string, CachedSectionContext>()
const CONTEXT_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

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

/**
 * 🆕 Generate cache key for section context - can be removed or simplified if not used
 */
function generateContextCacheKey(context: SectionContext, options: BuildPromptOptions): string {
  const paperSetHash = context.availablePapers.sort().join('-')
  const optionsHash = JSON.stringify(options)
  return `${context.paperType}-${context.sectionKey}-${paperSetHash}-${optionsHash}`
}

/**
 * 🆕 Get cached context or build new one - can be removed or simplified if not used
 */
async function getCachedOrBuildContext(
  context: SectionContext, 
  options: BuildPromptOptions,
  enableCaching: boolean = true
): Promise<{ promptData: { system: string, user: string }; cacheHit: boolean; cacheKey?: string }> {
  
  if (!enableCaching) {
    const { system, user } = await buildUnifiedPrompt(context, options)
    return { promptData: { system, user }, cacheHit: false }
  }
  
  const cacheKey = generateContextCacheKey(context, options)
  const cached = contextCache.get(cacheKey)
  
  // Check if cached context is still valid
  if (cached && (Date.now() - cached.timestamp) < cached.ttl) {
    console.log(`🎯 Context cache hit for key: ${cacheKey}`)
    return { 
      promptData: { system: cached.context, user: cached.context }, 
      cacheHit: true, 
      cacheKey 
    }
  }
  
  // Build new context and cache it
  console.log(`🔄 Building new context for key: ${cacheKey}`)
  const { system, user } = await buildUnifiedPrompt(context, options)
  
  // Cache the built context
  contextCache.set(cacheKey, {
    key: cacheKey,
    context: system + '\n---\n' + user,
    paperSetHash: context.availablePapers.join('-'),
    timestamp: Date.now(),
    ttl: CONTEXT_CACHE_TTL
  })
  
  return { promptData: { system, user }, cacheHit: false, cacheKey }
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
  
  const { promptData } = await getCachedOrBuildContext(context, options, false) // Caching disabled for now
  
  progress('generation', 20, 'Starting content generation...')
  
  const result = await streamText({
    model: ai(options.model || 'gpt-4o'),
    system: promptData.system,
    prompt: promptData.user,
    tools: { addCitation },
    temperature: options.temperature || 0.4,
    maxTokens: options.maxTokens
  })

  // Initialize citation stream processor for better batching
  const citationProcessor = createCitationStreamProcessor({
    projectId: context.projectId,
    batchSize: 5,
    sentenceBufferSize: 2,
    flushTimeoutMs: 1500
  })

  const sentenceEnd = /([.!?])\s+(?=[A-Z])/;
  let pendingText = '';

  for await (const delta of result.fullStream) {
    if (delta.type === 'text-delta') {
      pendingText += delta.textDelta
      let match;
      while ((match = sentenceEnd.exec(pendingText))) {
        const sentence = pendingText.slice(0, match.index + 1)
        pendingText = pendingText.slice(match.index + 1)
        
        // Process sentence through citation stream processor
        const processed = await citationProcessor.processChunk(sentence)
        if (processed.text) {
          fullContent += processed.text
          onStreamEvent?.({ type: 'sentence', data: { text: processed.text }})
        }
      }
    } else if (delta.type === 'tool-call' && delta.toolName === 'addCitation') {
        // flush any remaining text before citation
        if (pendingText) {
            const processed = await citationProcessor.processChunk(pendingText)
            if (processed.text) {
              fullContent += processed.text
              onStreamEvent?.({ type: 'sentence', data: { text: processed.text }})
            }
            pendingText = ''
        }
        onStreamEvent?.({ type: 'citation', data: delta })
    }
  }

  // flush any final text and remaining citations
  if (pendingText) {
      const processed = await citationProcessor.processChunk(pendingText)
      if (processed.text) {
        fullContent += processed.text
        onStreamEvent?.({ type: 'sentence', data: { text: processed.text }})
      }
  }

  // Final flush to resolve any remaining placeholders
  const finalFlush = await citationProcessor.flush()
  if (finalFlush.text) {
    fullContent += finalFlush.text
    onStreamEvent?.({ type: 'sentence', data: { text: finalFlush.text }})
  }

  // Clean up processor
  citationProcessor.clear()

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