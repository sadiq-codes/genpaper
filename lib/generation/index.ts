import { setCitationContext, clearCitationContext } from '@/lib/ai/tools/addCitation'
import { debug } from '@/lib/utils/logger'
import { mergeWithDefaults, getChunkLimit } from './config'
import { extractSections, extractAbstract } from './validators'
import { collectPapers } from './discovery'
import { ensureChunksForPapers, getRelevantChunks } from './chunks'
import { persistGenerationResults } from './persistence'
import type { EnhancedGenerationOptions, GenerationResult } from './types'
import type { SectionContext } from '@/lib/prompts/types'
import type { CSLItem } from '@/lib/utils/csl'

/**
 * Format citations in the content by replacing [CITE:key] tokens with formatted citations
 */
async function formatCitations(
  content: string, 
  citationsMap: Map<string, CSLItem>, 
  style: 'apa' | 'mla' = 'apa'
): Promise<string> {
  let formattedContent = content;
  const citationKeys = content.match(/\[CITE:([^\]]+)\]/g) || [];

  console.log(`🔗 Formatting ${citationKeys.length} citation placeholders...`);

  for (const placeholder of citationKeys) {
    const key = placeholder.replace('[CITE:', '').replace(']', '');
    const cslData = citationsMap.get(key);

    if (cslData) {
      // Format citation based on style
      const formattedCitation = formatCSLToStyle(cslData, style);
      formattedContent = formattedContent.replace(placeholder, formattedCitation);
      console.log(`✅ Formatted citation: ${placeholder} -> ${formattedCitation}`);
    } else {
      // If key not found, remove the placeholder
      formattedContent = formattedContent.replace(placeholder, '[CITATION_ERROR]');
      console.warn(`⚠️ Citation key not found: ${key}`);
    }
  }

  // Add a full "References" section at the end
  const referencesList = Array.from(citationsMap.values())
    .map(csl => formatCSLToReference(csl, style))
    .join('\n');
  
  if (referencesList) {
    formattedContent += '\n\n## References\n\n' + referencesList;
  }

  return formattedContent;
}

/**
 * Format CSL data to in-text citation
 */
function formatCSLToStyle(csl: CSLItem, style: 'apa' | 'mla'): string {
  const author = csl.author?.[0]?.family || 'Unknown';
  const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.';
  
  if (style === 'apa') {
    return `(${author}, ${year})`;
  } else {
    return `(${author} ${year})`;
  }
}

/**
 * Format CSL data to reference list entry
 */
function formatCSLToReference(csl: CSLItem, style: 'apa' | 'mla'): string {
  const author = csl.author?.[0]?.family || 'Unknown';
  const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.';
  const title = csl.title || 'Untitled';
  const journal = csl['container-title'] || '';
  const doi = csl.DOI ? `https://doi.org/${csl.DOI}` : '';
  
  if (style === 'apa') {
    return `${author} (${year}). ${title}. ${journal}. ${doi}`;
  } else {
    return `${author}. "${title}." ${journal}, ${year}. ${doi}`;
  }
}

export async function generateDraftWithRAG(
  options: EnhancedGenerationOptions
): Promise<GenerationResult> {
  const { projectId, userId, topic, config: rawConfig, onProgress } = options
  
  // Validate and merge config with defaults
  const config = mergeWithDefaults(rawConfig)
  
  debug.info('Starting enhanced paper generation', { 
    projectId, 
    topic: topic.substring(0, 100), 
    libraryPaperCount: options.libraryPaperIds?.length || 0,
    useLibraryOnly: options.useLibraryOnly,
    paperSettings: config.paper_settings 
  })
  
  type Stage = 'searching' | 'analyzing' | 'writing' | 'citations' | 'complete' | 'failed'
  const log = (stage: Stage, progress: number, message: string) => {
    onProgress?.({ stage, progress, message })
    debug.log(`${stage}: ${message}`)
  }

  // Set up citation context for addCitation tool
  setCitationContext({ projectId, userId })
  console.log(`🔗 Citation context set for project ${projectId}, user ${userId}`)

  // Track production quality metrics
  let productionQualityScore = 0

  try {
    // Step 1: Collect papers efficiently
    log('searching', 10, 'Gathering papers from library and search...')
    const allPapers = await collectPapers(options)

    log('analyzing', 30, `Found ${allPapers.length} papers. Retrieving content chunks...`)

    // Step 2: Get relevant content chunks for RAG
    await ensureChunksForPapers(allPapers)
    
    const chunkLimit = Math.max(
      50,
      getChunkLimit(
        config?.paper_settings?.length,
        config?.paper_settings?.paperType || 'researchArticle'
      )
    )
    const chunks = await getRelevantChunks(
      topic,
      allPapers.map(p => p.id),
      chunkLimit
    )

    // Abort early if RAG returned nothing – prevents placeholder paper IDs later
    const { assertChunksFound } = await import('./chunks')
    assertChunksFound(chunks, topic)

    // ---------------- Modular Section Drafting (Task 4) ------------------
    log('writing', 40, 'Generating outline...')

    const { generateOutline } = await import('@/lib/prompts/generators')

    const outline = await generateOutline(
      config.paper_settings?.paperType || 'researchArticle',
      topic,
      allPapers.map(p => p.id),
    )

    console.log(`📋 Generated outline with ${outline.sections.length} sections:`, 
      outline.sections.map(s => `${s.sectionKey}: ${s.title} (${s.expectedWords} words)`))

    // 3. Build section contexts for generation (optimized chunk retrieval)
    const sectionContexts: SectionContext[] = []
    
    // Cache chunks to avoid repetitive searches for the same papers
    const chunkCache = new Map<string, typeof chunks>()
    
    for (const section of outline.sections) {
      // Create a cache key based on the paper IDs for this section
      const cacheKey = section.candidatePaperIds.sort().join(',')
      
      let contextChunks = chunkCache.get(cacheKey)
      if (!contextChunks) {
        // Only search if we haven't cached results for this combination of papers
        contextChunks = await getRelevantChunks(
          topic,
          section.candidatePaperIds,
          Math.min(20, section.candidatePaperIds.length * 3)
        )
        chunkCache.set(cacheKey, contextChunks)
        console.log(`📄 Cached chunks for section "${section.title}" (${contextChunks.length} chunks)`)
      } else {
        console.log(`📄 Using cached chunks for section "${section.title}" (${contextChunks.length} chunks)`)
      }
      
      sectionContexts.push({
        sectionKey: section.sectionKey,
        title: section.title,
        candidatePaperIds: section.candidatePaperIds,
        contextChunks,
        expectedWords: section.expectedWords
      })
    }

    log('writing', 50, `🏭 PRODUCTION MODE: Drafting ${sectionContexts.length} sections with 4-stage quality pipeline...`)

    // 🏭 INTEGRATION: Use production generator for Quick Draft (4-stage quality pipeline)
    // This replaces the basic runner with planning, reflection, and quality metrics
    const { generateMultipleSectionsProduction } = await import('./production-generator')
    
    // Convert section contexts to production generator configs
    const productionConfigs = sectionContexts.map(sectionContext => ({
      paperType: config.paper_settings?.paperType || 'researchArticle',
      section: sectionContext.sectionKey,
      topic,
      contextChunks: sectionContext.contextChunks.map(chunk => chunk.content),
      availablePapers: sectionContext.candidatePaperIds,
      expectedWords: sectionContext.expectedWords || 300,
      requiredDepthCues: ['evidence', 'analysis', 'synthesis'], // Standard depth requirements
      enablePlanning: true,
      enableReflection: true,
      enableMetrics: true,
             onProgress: (stage: string, progress: number, message: string) => {
        const baseProgress = 50 + ((sectionContexts.indexOf(sectionContext) / sectionContexts.length) * 30)
        const stageProgress = baseProgress + (progress / 100) * (30 / sectionContexts.length)
        log('writing', stageProgress, `${sectionContext.title}: ${stage} - ${message}`)
      }
    }))

    // Generate all sections using production pipeline
    const productionResults = await generateMultipleSectionsProduction(
      productionConfigs,
      (completed, total, currentSection) => {
        const overallProgress = 50 + (completed / total) * 30
        log('writing', overallProgress, `Section ${completed + 1}/${total}: ${currentSection}`)
      }
    )

    // Combine all section content and extract tool calls
    const content = productionResults.map(result => result.content).join('\n\n')
    
    // Convert production results to captured tool calls format for compatibility
    const capturedToolCalls = productionResults.flatMap((result, index) => {
      const sectionContext = sectionContexts[index]
      
      // Extract citations from the production result and convert to tool call format
      const citations = result.writingResult?.citations || []
      return citations.map((citation, citationIndex) => ({
        toolCallId: `production-${index}-${citationIndex}`,
        toolName: 'addCitation',
        args: {
          title: citation.citationText || 'Generated Citation',
          authors: ['AI Generated'],
          reason: `Citation for ${sectionContext.title}`,
          section: sectionContext.sectionKey
        },
        result: {
          success: true,
          citationId: citation.paperId,
          citationKey: citation.paperId,
          replacement: `[CITE:${citation.paperId}]`,
          message: 'Citation added via production generator'
        },
        timestamp: new Date().toISOString(),
        validated: true
      }))
    })

    // Log production generation metrics
    const totalQualityScore = productionResults.reduce((sum, result) => sum + result.quality_score, 0) / productionResults.length
    const totalGenerationTime = productionResults.reduce((sum, result) => sum + result.generation_time_ms, 0)
    
    console.log(`🏭 Production generation completed:`, {
      sections: productionResults.length,
      averageQualityScore: Math.round(totalQualityScore),
      totalGenerationTime: `${totalGenerationTime}ms`,
      totalWordCount: content.split(/\s+/).length,
      planningEnabled: productionConfigs[0].enablePlanning,
      reflectionEnabled: productionConfigs[0].enableReflection,
      metricsEnabled: productionConfigs[0].enableMetrics
    })

    // Store quality score for final logging
    productionQualityScore = totalQualityScore

    console.log(`🔍 DEBUG: Generated content preview:`, content.substring(0, 500))
    console.log(`🔍 DEBUG: Content length: ${content.length} chars`)
    console.log(`🔍 DEBUG: Tool calls captured: ${capturedToolCalls.length}`)

    // Skip automatic evidence-based enrichment – use model-produced citations only
    const enhancedContent = content
    const addedCitationsCount = 0

    console.log(`🔍 DEBUG: Enhanced content preview:`, enhancedContent.substring(0, 500))

    log('citations', 85, 'Saving to database...')

    // Step 6: Persist to database
    const {
      citationsMap,
      citations,
      toolCallAnalytics
    } = await persistGenerationResults(
      projectId,
      enhancedContent,
      allPapers,
      capturedToolCalls,
      addedCitationsCount
    )
    
    // Step 7: Format citations in the final content
    log('citations', 90, 'Formatting citations...')
    const finalContent = await formatCitations(enhancedContent, citationsMap, 'apa')
    
    log('complete', 100, `🏭 Production paper completed! Quality Score: ${Math.round(productionQualityScore)}/100`)

    return {
      content: finalContent,
      citations,
      citationsMap,
      wordCount: finalContent.split(/\s+/).length,
      sources: allPapers,
      structure: {
        sections: extractSections(finalContent),
        abstract: extractAbstract(finalContent)
      },
      toolCallAnalytics
    }
  } catch (error) {
    console.error(`❌ Error generating paper:`, error)
    throw error
  } finally {
    // Always clear citation context
    clearCitationContext()
    console.log(`🔗 Citation context cleared`)
  }
}

// Re-export types for convenience
export type {
  EnhancedGenerationOptions,
  GenerationResult,
  PaperChunk,
  CapturedToolCall,
  ToolCallAnalytics
} from './types' 