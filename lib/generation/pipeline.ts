import 'server-only'
import { updateProjectContent, updateResearchProjectStatus } from '@/lib/db/research'
import { runWithCitationContext } from '@/lib/ai/tools/addCitation'
import { collectPapers } from '@/lib/generation/discovery'
import { generateOutline } from '@/lib/prompts/generators'
import { generateMultipleSectionsUnified } from '@/lib/generation/unified-generator'
import { GenerationContextService } from '@/lib/rag/generation-context'
import { SectionReviewer } from '@/lib/quality/section-reviewer'
import { fourGramOverlapRatio } from '@/lib/utils/overlap'
import { EvidenceTracker } from '@/lib/services/evidence-tracker'
import { sanitizeTopic } from '@/lib/utils/prompt-safety'
import { classifyError, CancellationError } from '@/lib/generation/errors'
import type { PaperStatus } from '@/types/simplified'
import type { GeneratedOutline, SectionContext, PaperTypeKey } from '@/lib/prompts/types'
import type { EnhancedGenerationOptions } from '@/lib/generation/types'

/**
 * Minimal configuration object for paper generation
 */
export interface PipelineConfig {
  // Required
  topic: string
  paperType: PaperTypeKey
  length: 'short' | 'medium' | 'long'
  
  // Optional
  useLibraryOnly?: boolean
  libraryPaperIds?: string[]
  sources?: string[]
  temperature?: number
  maxTokens?: number
}

/**
 * Pipeline result containing generated content and metrics
 */
export interface PipelineResult {
  content: string
  outline: GeneratedOutline
  sections: SectionContext[]
  citations: Record<string, { paperId: string; citationText: string }>
  metrics: {
    papersUsed: number
    sectionsGenerated: number
    totalWords: number
    qualityScore: number
    generationTime: number
  }
}

/**
 * Progress callback interface for streaming updates
 */
export interface ProgressCallback {
  (stage: string, progress: number, message: string, data?: Record<string, unknown>): void
}

/**
 * Main orchestrator function - handles the complete paper generation pipeline
 * 
 * ARCHITECTURAL RESPONSIBILITIES:
 * - Pipeline: Orchestration, quality assessment, evidence tracking, overlap detection, project management
 * - Unified Generator: Core content generation, streaming, basic quality metrics
 * 
 * This is the single entry point that replaces the complex route logic with
 * a clean, testable pipeline that follows the 5-layer architecture:
 * 1. Search: collectPapers()
 * 2. Ingestion: ensureBulkContentIngestion() (handled within collectPapers)
 * 3. RAG: GenerationContextService.buildContexts()
 * 4. Generation: generateMultipleSectionsUnified()
 * 5. Quality: comprehensive overlap check + SectionReviewer + evidence tracking
 */
export async function generatePaper(
  config: PipelineConfig,
  projectId: string,
  userId: string,
  onProgress?: ProgressCallback,
  baseUrl?: string,
  signal?: AbortSignal
): Promise<PipelineResult> {
  const startTime = Date.now()
  
  // Check for cancellation at pipeline start
  if (signal?.aborted) {
    throw new CancellationError('Pipeline cancelled before start')
  }
  
  onProgress?.('initialization', 0, 'Starting paper generation pipeline...')
  
  // Sanitize user input to prevent prompt injection
  const sanitizedTopic = sanitizeTopic(config.topic)
  if (sanitizedTopic !== config.topic) {
    console.warn('Topic was sanitized for safety:', { original: config.topic.slice(0, 100), sanitized: sanitizedTopic.slice(0, 100) })
  }
  
  // Set project status to generating
  await updateResearchProjectStatus(projectId, 'generating' as PaperStatus)
  
  // Set up evidence tracking with database persistence
  EvidenceTracker.setProject(projectId)
  await EvidenceTracker.loadFromDatabase(projectId)

  try {
    // Step 1: Collect Papers (Search + Ingestion)
    onProgress?.('search', 10, 'Collecting and ingesting papers...', { 
      useLibraryOnly: config.useLibraryOnly,
      libraryPapers: config.libraryPaperIds?.length || 0
    })
    
    const discoveryOptions: EnhancedGenerationOptions = {
      projectId,
      userId,
      topic: sanitizedTopic,
      paperType: config.paperType,
      libraryPaperIds: config.libraryPaperIds || [],
      sourceIds: config.libraryPaperIds || [],
      useLibraryOnly: config.useLibraryOnly || false,
      config: {
        temperature: config.temperature || 0.2,
        max_tokens: config.maxTokens || 16000,
        sources: config.sources || ['arxiv', 'openalex', 'crossref', 'semantic_scholar'],
        limit: 25,
        library_papers_used: config.libraryPaperIds || [],
        length: config.length,
        paperType: config.paperType,
        useLibraryOnly: config.useLibraryOnly || false,
        localRegion: undefined
      }
    }

    const allPapers = await collectPapers(discoveryOptions)
    
    if (allPapers.length === 0) {
      throw new Error('No papers found for the given topic')
    }
    
    onProgress?.('search', 20, 'Papers collected successfully', {
      papersFound: allPapers.length
    })

    // Step 2: Generate Outline
    onProgress?.('outline', 25, 'Generating paper outline...')
    
    const allPaperIds = allPapers.map(p => p.id)
    const rawOutline = await generateOutline(
      config.paperType,
      sanitizedTopic,
      allPaperIds
    )
    
    // Build properly typed outline
    const typedOutline: GeneratedOutline = {
      paperType: config.paperType,
      topic: sanitizedTopic,
      sections: rawOutline.sections.map(section => ({
        ...section,
        sectionKey: section.sectionKey as any // Type assertion for flexibility
      })),
      localRegion: undefined
    }
    
    onProgress?.('outline', 30, 'Outline generated with paper assignments', {
      sectionsPlanned: typedOutline.sections.length
    })

    // Step 3: Build Section Contexts (RAG)
    onProgress?.('context', 35, 'Building section contexts...')
    
    const sectionContexts = await GenerationContextService.buildContexts(
      typedOutline,
      sanitizedTopic,
      allPapers
    )
    
    onProgress?.('context', 40, 'Section contexts prepared', {
      sectionsWithContext: sectionContexts.length
    })

    // Step 4: Generate Content
    onProgress?.('generation', 45, 'Starting unified content generation...')
    
    let completedSections = 0
    let fullContent = ''
    const allCitations: Array<{ paperId: string; citationText: string }> = []
    
    // Compute safe per-section token allocation
    const totalMaxTokens = config.maxTokens || 16000
    const sectionCount = Math.max(1, sectionContexts.length)
    const perSectionTokens = Math.max(1000, Math.floor(totalMaxTokens / sectionCount))

    // Generate all sections using unified template within citation context
    const results = await runWithCitationContext({
      projectId,
      userId,
      citationStyle: 'apa',
      baseUrl: baseUrl || 'http://localhost:3000'
    }, async () => {
      const outlineTreeText = typedOutline.sections.map(s => `• ${s.title}`).join('\n')
      return await generateMultipleSectionsUnified(
        sectionContexts,
        {
          temperature: config.temperature || 0.2,
          maxTokens: perSectionTokens,
          outlineTree: outlineTreeText
        },
        (completed, total, currentSection) => {
          const progress = Math.round((completed / total) * 40) + 45 // 45-85%
          onProgress?.('generation', progress, `Generating ${currentSection} (${completed}/${total})`)
        }
      )
    })

    // Step 5: Quality Checks and Assembly
    onProgress?.('quality', 85, 'Running quality checks...')
    
    let totalQualityScore = 0
    let qualityIssues: string[] = []
    const OVERLAP_THRESHOLD = 0.22
    
    for (let i = 0; i < results.length; i++) {
      let result = results[i]
      const sectionContext = sectionContexts[i]
      
      // Check cross-section overlap and rewrite if necessary
      const overlap = fourGramOverlapRatio(result.content, fullContent)
      if (fullContent && overlap > OVERLAP_THRESHOLD) {
        console.log(`⚠️ High overlap detected in ${sectionContext.title} (ratio=${overlap.toFixed(2)}). Triggering rewrite.`)
        try {
          const prevSummary = `Avoid repeating earlier content; focus only on new insights for ${sectionContext.title}.`
          const { generateWithUnifiedTemplate } = await import('@/lib/generation/unified-generator')
          result = await runWithCitationContext({
            projectId,
            userId,
            citationStyle: 'apa',
            baseUrl: baseUrl || 'http://localhost:3000'
          }, async () => {
            return await generateWithUnifiedTemplate({
              context: sectionContext,
              options: {
                temperature: config.temperature || 0.2,
                maxTokens: perSectionTokens,
                forceRewrite: true,
                rewriteText: result.content,
                previousSectionsSummary: prevSummary,
                outlineTree: typedOutline.sections.map(s => `• ${s.title}`).join('\n')
              }
            })
          })
        } catch (rewriteError) {
          console.warn(`Rewrite failed for ${sectionContext.title}:`, rewriteError)
        }
      }
      
      // Track evidence usage for cross-section memory (centralized here to avoid duplication)
      if (sectionContext.contextChunks && sectionContext.contextChunks.length > 0) {
        EvidenceTracker.trackBulkUsageSync(sectionContext.contextChunks, sectionContext.title, projectId)
      }
      
      // Comprehensive section quality review (pipeline-level assessment)
      try {
        const review = await SectionReviewer.reviewSection(
          sectionContext.sectionKey,
          result.content,
          result.citations,
          sectionContext.contextChunks || [],
          sectionContext.expectedWords || 300
        )
        
        totalQualityScore += review.score
        if (!review.passed) {
          qualityIssues.push(`${sectionContext.title}: ${review.issues.join(', ')}`)
        }
      } catch (error) {
        console.warn(`Quality review failed for ${sectionContext.title}:`, error)
        // Use a default score if review fails
        totalQualityScore += 75
      }
      
      // Hallucination detection - verify claims are grounded in evidence
      try {
        const { quickHallucinationCheck } = await import('@/lib/quality/hallucination-detector')
        const hallucinationCheck = await quickHallucinationCheck(
          result.content,
          sectionContext.contextChunks || []
        )
        
        if (!hallucinationCheck.passed) {
          console.warn(`⚠️ Hallucination warning in ${sectionContext.title}: ${((1 - hallucinationCheck.score) * 100).toFixed(0)}% of claims may be ungrounded`)
          qualityIssues.push(`${sectionContext.title}: ${((1 - hallucinationCheck.score) * 100).toFixed(0)}% potentially ungrounded claims`)
          // Reduce quality score based on hallucination score
          totalQualityScore -= (1 - hallucinationCheck.score) * 15
        }
      } catch (error) {
        // Don't fail on hallucination check errors - it's an enhancement
        console.warn(`Hallucination check failed for ${sectionContext.title}:`, error)
      }
      
      fullContent += result.content + '\n\n'
      allCitations.push(...result.citations)
      completedSections++
    }
    
    const avgQualityScore = totalQualityScore / results.length
    
    onProgress?.('saving', 95, 'Saving generated content...')
    
    // Create citations map with deterministic keys (paperId + hash for uniqueness)
    const citationsMap: Record<string, { paperId: string; citationText: string }> = {}
    allCitations.forEach((citation) => {
      // Create deterministic key from paperId and citation text
      const textHash = citation.citationText.slice(0, 20).replace(/\W/g, '').toLowerCase()
      const key = `${citation.paperId.slice(0, 8)}-${textHash || 'cite'}`
      // Handle duplicates by appending count
      let finalKey = key
      let counter = 1
      while (citationsMap[finalKey]) {
        finalKey = `${key}-${counter}`
        counter++
      }
      citationsMap[finalKey] = citation
    })
    
    await updateProjectContent(projectId, fullContent.trim(), citationsMap)
    
    onProgress?.('complete', 100, 'Paper generation completed successfully', {
      totalWords: fullContent.split(' ').length,
      qualityScore: avgQualityScore
    })

    return {
      content: fullContent.trim(),
      outline: typedOutline,
      sections: sectionContexts,
      citations: citationsMap,
      metrics: {
        papersUsed: allPapers.length,
        sectionsGenerated: completedSections,
        totalWords: fullContent.split(' ').length,
        qualityScore: avgQualityScore,
        generationTime: (Date.now() - startTime) / 1000
      }
    }

  } catch (error) {
    console.error('Pipeline error:', error)
    
    // Clean up evidence tracker (use sync to avoid nested async issues)
    EvidenceTracker.clearLedgerSync(projectId)
    
    // Classify error for better reporting
    const classified = classifyError(error)
    console.error(`Pipeline failed with ${classified.category} error:`, classified.userMessage)
    
    // Update project status to failed
    await updateResearchProjectStatus(projectId, 'failed' as PaperStatus)
    
    // Re-throw the classified error for better handling upstream
    throw classified
  }
}


