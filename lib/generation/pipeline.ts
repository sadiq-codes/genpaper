import 'server-only'
import { updateProjectContent, updateResearchProjectStatus } from '@/lib/db/research'
import { runWithCitationContext } from '@/lib/ai/tools/addCitation'
import { collectPapers } from '@/lib/generation/discovery'
import { generateOutline } from '@/lib/prompts/generators'
import { generateMultipleSectionsUnified } from '@/lib/generation/unified-generator'
import { ContextRetrievalService } from '@/lib/generation/rag-retrieval'
import { SectionReviewer } from '@/lib/quality/section-reviewer'
import { fourGramOverlapRatio } from '@/lib/utils/overlap'
import { EvidenceTracker } from '@/lib/services/evidence-tracker'
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
 * 3. RAG: ContextRetrievalService.buildContexts()
 * 4. Generation: generateMultipleSectionsUnified()
 * 5. Quality: comprehensive overlap check + SectionReviewer + evidence tracking
 */
export async function generatePaper(
  config: PipelineConfig,
  projectId: string,
  userId: string,
  onProgress?: ProgressCallback,
  baseUrl?: string
): Promise<PipelineResult> {
  const startTime = Date.now()
  
  onProgress?.('initialization', 0, 'Starting paper generation pipeline...')
  
  // Set project status to generating
  await updateResearchProjectStatus(projectId, 'generating' as PaperStatus)
  
  // Set up evidence tracking
  EvidenceTracker.setProject(projectId)

  try {
    // Step 1: Collect Papers (Search + Ingestion)
    onProgress?.('search', 10, 'Collecting and ingesting papers...', { 
      useLibraryOnly: config.useLibraryOnly,
      libraryPapers: config.libraryPaperIds?.length || 0
    })
    
    const discoveryOptions: EnhancedGenerationOptions = {
      projectId,
      userId,
      topic: config.topic,
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
      config.topic,
      allPaperIds
    )
    
    // Build properly typed outline
    const typedOutline: GeneratedOutline = {
      paperType: config.paperType,
      topic: config.topic,
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
    
    const sectionContexts = await ContextRetrievalService.buildContexts(
      typedOutline,
      config.topic,
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
        EvidenceTracker.trackBulkUsage(sectionContext.contextChunks, sectionContext.title, projectId)
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
      
      fullContent += result.content + '\n\n'
      allCitations.push(...result.citations)
      completedSections++
    }
    
    const avgQualityScore = totalQualityScore / results.length
    
    onProgress?.('saving', 95, 'Saving generated content...')
    
    // Create citations map from collected citations (no redundant processing)
    const citationsMap: Record<string, { paperId: string; citationText: string }> = {}
    allCitations.forEach((citation, index) => {
      citationsMap[`citation-${index}`] = citation
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
    // Update project status to failed
    await updateResearchProjectStatus(projectId, 'failed' as PaperStatus)
    throw error
  }
}


