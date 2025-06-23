import 'server-only'
import { streamText } from 'ai'
import { ai } from '@/lib/ai/vercel-client'
import { buildUnifiedPrompt, checkTopicDrift, type SectionContext, type BuildPromptOptions } from '@/lib/prompts/unified/prompt-builder'
import { runReflectionCycle, shouldUseReflection } from './reflection-system'
import { calculateContentMetrics, storeMetrics } from './metrics-system'
import { addCitation } from '@/lib/ai/tools/addCitation'
import { estimateTokenCount } from '@/lib/utils/text'

/**
 * Unified content generator using single skeleton template with contextual data
 * Replaces the multiple hard-coded prompt approach with data-driven generation
 * 
 * Features:
 * - Single template scales from sentence → block → section → paper
 * - Maintains coherence through rolling summaries
 * - Automatic topic drift detection
 * - All zoom levels supported (sentence, block, section)
 */

export interface UnifiedGenerationConfig {
  context: SectionContext
  options?: BuildPromptOptions
  
  // Quality controls
  enableReflection?: boolean
  enableDriftDetection?: boolean
  maxReflectionCycles?: number
  
  // Progress tracking
  onProgress?: (stage: string, progress: number, message: string, data?: any) => void
}

export interface UnifiedGenerationResult {
  content: string
  wordCount: number
  
  // Quality indicators
  driftCheck?: {
    isDrift: boolean
    similarity: number
    warning?: string
  }
  
  // Reflection results
  reflectionResult?: {
    final_content: string
    revisions_made: number
    final_quality_score: number
    improvement_log: string[]
  }
  
  // Performance metrics
  generation_time_ms: number
  model_used: string
  quality_score: number
  
  // Citations extracted
  citations: Array<{
    paperId: string
    citationText: string
    positionStart?: number
    positionEnd?: number
  }>
}

/**
 * Main unified generation function - works at any zoom level
 */
export async function generateWithUnifiedTemplate(
  config: UnifiedGenerationConfig
): Promise<UnifiedGenerationResult> {
  
  const startTime = Date.now()
  const {
    context,
    options = {},
    enableReflection = true,
    enableDriftDetection = true,
    maxReflectionCycles = 2,
    onProgress
  } = config

  const progress = (stage: string, pct: number, msg: string, data?: any) => {
    const safePct = stage === 'complete' ? 100 : Math.min(pct, 99)
    onProgress?.(stage, safePct, msg, data)
  }

  try {
    // Stage 1: Build contextual prompt from unified skeleton
    progress('prompt_building', 10, 'Building contextual prompt from unified template...')
    
    const promptData = await buildUnifiedPrompt(context, options)
    
    progress('prompt_building', 20, 'Unified prompt built successfully', {
      target_words: options.targetWords,
      is_rewrite: promptData.user.includes('Current Draft'),
      section_path: context.sectionId
    })

    // Stage 2: Generate content using unified template
    progress('generation', 30, 'Generating content...')
    
    const result = await streamText({
      model: ai('gpt-4o'),
      system: promptData.system,
      prompt: promptData.user,
      temperature: options.sentenceMode ? 0.1 : 0.3, // Lower temp for sentence edits
      maxTokens: options.sentenceMode ? 200 : 2500,
      tools: {
        addCitation: addCitation
      }
    })

    let content = ''
    let toolCalls: any[] = []
    for await (const delta of result.textStream) {
      content += delta
      if (delta.toolCall) {
        toolCalls.push(delta.toolCall)
      }
    }

    // Extract token usage from result (if available from SDK)
    let tokensUsed = estimateTokenCount(content) // fallback estimate
    try {
      const usage = await result.usage
      tokensUsed = usage?.totalTokens || tokensUsed
    } catch {
      // Usage not available, keep estimate
    }

    progress('generation', 50, 'Content generated successfully', {
      word_count: content.split(' ').length,
      character_count: content.length,
      tool_calls: toolCalls.length
    })

    // Extract citations from tool calls
    const citations = toolCalls
      .filter(tc => tc.name === 'addCitation')
      .map(tc => ({
        paperId: tc.result.citationId,
        citationText: tc.result.replacement,
        positionStart: tc.args.start_pos,
        positionEnd: tc.args.end_pos,
        toolCall: tc
      }))

    // Stage 3: Topic drift detection (if enabled)
    let driftCheck: UnifiedGenerationResult['driftCheck'] = undefined
    if (enableDriftDetection && !options.sentenceMode) {
      progress('drift_detection', 60, 'Checking for topic drift...')
      
      const projectData = await getProjectSummaryForDrift(context.projectId)
      driftCheck = await checkTopicDrift(content, projectData.previousSummary)
      
      progress('drift_detection', 65, `Drift check: ${driftCheck.isDrift ? 'Warning' : 'Pass'}`, {
        similarity: driftCheck.similarity,
        has_warning: !!driftCheck.warning
      })
    }

    // Stage 4: Reflection and improvement (if enabled)
    let finalContent = content
    let reflectionResult: UnifiedGenerationResult['reflectionResult'] = undefined
    
    if (enableReflection && !options.sentenceMode) {
      // Use adaptive reflection system
      const reflectionDecision = shouldUseReflection(content, context.sectionKey)
      
      if (reflectionDecision.useReflection) {
        progress('reflection', 70, `Running adaptive reflection cycle: ${reflectionDecision.reason}`)
        
        reflectionResult = await runReflectionCycle(
          finalContent,
          context.paperType,
          context.sectionKey,
          `${context.paperType} section`, // Topic approximation
          context.availablePapers,
          context.contextChunks.map(c => c.content),
          reflectionDecision.maxCycles // Use adaptive cycle count
        )
        
        finalContent = reflectionResult.final_content
        
        progress('reflection', 85, `Reflection complete: ${reflectionResult.revisions_made} revisions`, {
          quality_score: reflectionResult.final_quality_score,
          revisions: reflectionResult.revisions_made
        })
      } else {
        progress('reflection', 70, `Skipping reflection: ${reflectionDecision.reason}`)
      }
    }

    // Stage 5: Extract citations and calculate metrics
    progress('finalization', 90, 'Extracting citations and calculating metrics...')
    
    const generationTime = Date.now() - startTime
    
    // Calculate simple quality score
    const qualityScore = calculateUnifiedQualityScore({
      content: finalContent,
      citations,
      targetWords: options.targetWords || 800,
      driftSimilarity: driftCheck?.similarity || 1.0,
      reflectionScore: reflectionResult?.final_quality_score || 75
    })

    // Store metrics if this is a significant generation (not sentence-level)
    if (!options.sentenceMode) {
      const metrics = calculateContentMetrics(
        finalContent,
        `Section ${context.sectionKey}`, // Topic approximation
        context.availablePapers,
        context.contextChunks.map(c => c.content),
        [] // requiredDepthCues - would need to be passed in
      )
      
      const contentWordCount = finalContent.split(' ').length
      await storeMetrics(
        context.sectionId,
        context.paperType,
        context.sectionKey,
        `Section ${context.sectionKey}`,
        metrics,
        generationTime,
        'gpt-4o',
        'unified-v1',
        contentWordCount,
        tokensUsed
      )
    }

    progress('complete', 100, 'Generation completed successfully!')

    return {
      content: finalContent,
      wordCount: finalContent.split(' ').length,
      driftCheck,
      reflectionResult,
      generation_time_ms: generationTime,
      model_used: 'gpt-4o',
      quality_score: qualityScore,
      citations
    }

  } catch (error) {
    console.error('Unified generation failed:', error)
    
    const generationTime = Date.now() - startTime
    return {
      content: `Error in unified generation: ${error}`,
      wordCount: 0,
      generation_time_ms: generationTime,
      model_used: 'gpt-4o',
      quality_score: 0,
      citations: []
    }
  }
}

/**
 * Convenience functions for different zoom levels
 */

// Full section generation
export async function generateFullSection(
  context: SectionContext,
  targetWords: number = 1000,
  onProgress?: UnifiedGenerationConfig['onProgress']
): Promise<UnifiedGenerationResult> {
  
  return generateWithUnifiedTemplate({
    context,
    options: { targetWords },
    enableReflection: true,
    enableDriftDetection: true,
    onProgress
  })
}

// Block-level rewrite
export async function rewriteBlock(
  context: SectionContext & { blockId: string },
  onProgress?: UnifiedGenerationConfig['onProgress']
): Promise<UnifiedGenerationResult> {
  
  return generateWithUnifiedTemplate({
    context,
    options: { forceRewrite: true, targetWords: 300 },
    enableReflection: true,
    enableDriftDetection: true,
    onProgress
  })
}

// Sentence-level edit
export async function editSentence(
  context: SectionContext & { blockId: string },
  onProgress?: UnifiedGenerationConfig['onProgress']
): Promise<UnifiedGenerationResult> {
  
  return generateWithUnifiedTemplate({
    context,
    options: { 
      forceRewrite: true, 
      sentenceMode: true, 
      targetWords: 50 
    },
    enableReflection: false, // Skip reflection for sentence-level
    enableDriftDetection: false, // Skip drift check for sentence-level
    onProgress
  })
}

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
    const context = contexts[i]
    
    onBatchProgress?.(i, contexts.length, `${context.paperType}:${context.sectionKey}`)
    
    const result = await generateWithUnifiedTemplate({
      context,
      options,
      enableReflection: true,
      enableDriftDetection: true
    })
    
    results.push(result)
    
    // Brief pause between sections to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  onBatchProgress?.(contexts.length, contexts.length, 'Complete')
  
  return results
}

/**
 * Helper functions
 */

async function getProjectSummaryForDrift(projectId: string): Promise<{ previousSummary: string }> {
  // TODO: Implement actual project summary fetching from database
  // This would fetch the rolling summary of approved sections
  console.warn('TODO: Drift detection not fully implemented - getProjectSummaryForDrift is a placeholder')
  
  return {
    previousSummary: 'Project summary for drift detection not yet implemented. All similarity checks will return 1.0 (no drift detected).'
  }
}

function calculateUnifiedQualityScore(params: {
  content: string
  citations: any[]
  targetWords: number
  driftSimilarity: number
  reflectionScore: number
}): number {
  const { content, citations, targetWords, driftSimilarity, reflectionScore } = params
  
  const wordCount = content.split(' ').length
  const lengthScore = Math.min(100, (wordCount / targetWords) * 100)
  const citationScore = Math.min(100, citations.length * 10) // 10 points per citation, cap at 100
  const driftScore = driftSimilarity * 100
  
  // Weighted composite score
  const composite = (
    lengthScore * 0.2 +
    citationScore * 0.2 +
    driftScore * 0.2 +
    reflectionScore * 0.4
  )
  
  return Math.round(Math.max(0, Math.min(100, composite)))
}

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
  
  // Convert old parameters to new unified approach
  const context: SectionContext = {
    projectId: 'legacy-' + Date.now(), // Would need actual project ID
    sectionId: 'legacy-section-' + Date.now(),
    paperType: paperType as any,
    sectionKey: section as any,
    availablePapers: paperIds,
    contextChunks: contextChunks.map((content, i) => ({
      paper_id: paperIds[i] || `paper-${i}`,
      content
    }))
  }
  
  const result = await generateWithUnifiedTemplate({
    context,
    options: { targetWords: 1000 },
    enableReflection: true,
    enableDriftDetection: true
  })
  
  return result.content
} 