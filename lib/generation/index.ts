import { runWithCitationContext } from '@/lib/ai/tools/addCitation'
import { debug } from '@/lib/utils/logger'
import { sanitizeForLogs } from '@/lib/utils/sanitize'
import { mergeWithDefaults, getChunkLimit } from './config'
import { extractSections, extractAbstract } from './validators'
import { collectPapers } from './discovery'
import { 
  getRelevantChunks, 
  ensureBulkContentIngestion,
  ContentRetrievalError,
  NoRelevantContentError,
  ContentQualityError
} from './chunks'
import { persistGenerationResults } from './persistence'
import type { 
  EnhancedGenerationOptions, 
  GenerationResult, 
  CapturedToolCall,
  ProductionGenerationConfig,
  SectionKey
} from './types'
import { buildSectionContexts } from './helpers'
import type { GeneratedOutline, OutlineSection, PaperTypeKey } from '@/lib/prompts/types'

// Custom error for generation failures
class GenerationError extends Error {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message)
    this.name = 'GenerationError'
  }
}

export async function generateDraftWithRAG(
  options: EnhancedGenerationOptions
): Promise<GenerationResult> {
  const { projectId, userId, topic: rawTopic, config: rawConfig, onProgress } = options;

  const mergedConfig = mergeWithDefaults(rawConfig);
  
  return runWithCitationContext({ 
    projectId, 
    userId,
    citationStyle: 'apa' // Default citation style - can be made configurable later
  }, async () => {
    const topic = sanitizeForLogs(rawTopic);
    
    try {
      const config = mergedConfig;
      const log = (stage: 'searching' | 'analyzing' | 'writing' | 'citations' | 'complete' | 'failed', progress: number, message: string) => {
        onProgress?.({ stage, progress, message });
        debug(`${stage}: ${message}`);
      };

      debug('Starting enhanced paper generation', {
        projectId,
        topic: topic.substring(0, 100),
        libraryPaperCount: options.libraryPaperIds?.length || 0,
        useLibraryOnly: options.useLibraryOnly,
        paperSettings: config.paper_settings
      });

      // Step 1: Collect papers efficiently
      log('searching', 10, 'Gathering papers from library and search...');
      const allPapers = await collectPapers(options);

      if (allPapers.length === 0) {
        throw new GenerationError('No papers found for the given topic')
      }

      log('analyzing', 30, `Found ${allPapers.length} papers. Checking content availability...`);

      // Step 2: Ensure content is available for generation
      console.log(`📄 Ensuring content availability for ${allPapers.length} papers...`)
      await ensureBulkContentIngestion(allPapers);

      log('analyzing', 35, 'Retrieving content chunks...');

      // Step 3: Get relevant content chunks for RAG
      try {
        // SURGICAL FIX: Increase chunk limits for better content availability
        const CHUNKS_PER_PAPER = 10 // Increased from default 5
        const baseChunkLimit = Math.max(
          CHUNKS_PER_PAPER * allPapers.length, // Allow more chunks per paper
          getChunkLimit(
            config?.paper_settings?.length,
            config?.paper_settings?.paperType || 'researchArticle'
          )
        )
        
        console.log(`📊 Chunk retrieval: targeting ${baseChunkLimit} chunks (${CHUNKS_PER_PAPER} per paper × ${allPapers.length} papers)`)
        
        await getRelevantChunks(
          topic,
          allPapers.map(p => p.id),
          baseChunkLimit,
          allPapers
        );
      } catch (error) {
        if (error instanceof NoRelevantContentError) {
          throw new GenerationError(
            'Could not find enough relevant content in the selected papers. Please try adding more papers about this topic.',
            { originalError: error.message }
          );
        } else if (error instanceof ContentQualityError) {
          throw new GenerationError(
            'The available content is not relevant enough to generate a quality paper.',
            { originalError: error.message }
          );
        } else if (error instanceof ContentRetrievalError) {
          throw new GenerationError(
            'Failed to retrieve paper content. Please ensure papers are properly imported.',
            { originalError: error.message }
          );
        }
        throw error;
      }

      // ---------------- Modular Section Drafting ------------------
      log('writing', 40, 'Generating outline...');

      const { generateOutline } = await import('@/lib/prompts/generators')

      const outline = await generateOutline(
        config.paper_settings?.paperType || 'researchArticle',
        topic
      ) as { sections: OutlineSection[] }

      // Add missing properties to match GeneratedOutline type
      const completeOutline: GeneratedOutline = {
        ...outline,
        paperType: config.paper_settings?.paperType as PaperTypeKey || 'researchArticle',
        topic
      }

      console.log(`📋 Generated outline with ${outline.sections.length} sections:`, 
        outline.sections.map(s => `${s.sectionKey}: ${s.title} (${s.expectedWords} words)`))

      // SURGICAL FIX: Assign all discovered papers to each section since AI outline doesn't do paper assignment
      const allPaperIds = allPapers.map(p => p.id)
      console.log(`📋 Assigning ${allPaperIds.length} papers to all sections for content retrieval`)
      
      completeOutline.sections.forEach(section => {
        section.candidatePaperIds = allPaperIds // Assign all papers to each section
      })

      // Build section contexts for generation
      const sectionContexts = await buildSectionContexts(completeOutline, topic, allPapers)

      log('writing', 50, `🏭 PRODUCTION MODE: Drafting ${sectionContexts.length} sections with 4-stage quality pipeline...`)

      // Convert section contexts to production generator configs
      const productionConfigs: ProductionGenerationConfig[] = sectionContexts.map(sectionContext => {
        const onProgressCallback = (stage: string, progress: number, message: string) => {
          const baseProgress = 50 + ((sectionContexts.indexOf(sectionContext) / sectionContexts.length) * 30)
          const stageProgress = baseProgress + (progress / 100) * (30 / sectionContexts.length)
          onProgress?.({ 
            stage: 'writing', 
            progress: stageProgress, 
            message: `${sectionContext.title}: ${stage} - ${message}` 
          })
        }

        return {
          paperType: config.paper_settings?.paperType || 'researchArticle',
          section: sectionContext.sectionKey as SectionKey,
          topic,
          contextChunks: sectionContext.contextChunks.map(chunk => chunk.content),
          availablePapers: allPapers.filter(p => sectionContext.candidatePaperIds.includes(p.id)),
          expectedWords: sectionContext.expectedWords || 300,
          enablePlanning: true,
          enableReflection: true,
          enableMetrics: true,
          onProgress: onProgressCallback
        }
      })

      // Generate all sections using production pipeline
      const { generateMultipleSectionsProduction } = await import('./production-generator')
      const productionResults = await generateMultipleSectionsProduction(
        productionConfigs,
        (completed, total, currentSection) => {
          const overallProgress = 50 + (completed / total) * 30
          onProgress?.({
            stage: 'writing',
            progress: overallProgress,
            message: `Section ${completed + 1}/${total}: ${currentSection}`
          })
        }
      )

      // Validate generation results
      if (!productionResults || productionResults.length === 0) {
        throw new GenerationError('No content was generated')
      }

      // Extract and validate content from results
      const sectionContents = productionResults.map((result, index) => {
        const sectionKey = sectionContexts[index].sectionKey
        const content = result.content ?? result.writingResult?.content ?? 
                       (typeof result.writingResult === 'string' ? result.writingResult : null)

        // 🚨 ENHANCED ERROR HANDLING FOR EMPTY CONTENT
        if (!content || content.trim().length === 0) {
          console.error(`🚨 Empty content detected for section: ${sectionKey}`)
          console.error(`📊 Section Context:`, {
            sectionKey,
            expectedWords: sectionContexts[index].expectedWords,
            contextChunks: sectionContexts[index].contextChunks?.length || 0,
            candidatePapers: sectionContexts[index].candidatePaperIds?.length || 0
          })
          
          // Check if this is a tool-call interference issue
          const isToolCallIssue = result.content === '' && result.writingResult === null
          
          if (isToolCallIssue) {
            console.error(`💡 This appears to be a tool-call interference issue. The AI tried to use citation tools but failed to generate base content.`)
            console.error(`🔧 The unified generator includes retry logic without tools to handle this case.`)
          }
          
          throw new GenerationError(
            `Failed to generate content for section: ${sectionKey}. ` +
            `${isToolCallIssue ? 'Tool-call interference detected. ' : ''}` +
            `This may indicate content filtering, API issues, or insufficient context. ` +
            `Available context: ${sectionContexts[index].contextChunks?.length || 0} chunks from ` +
            `${sectionContexts[index].candidatePaperIds?.length || 0} papers. ` +
            `Please check your API key, review the source material, and try again.`
          )
        }

        // Validate content quality - reject very short content
        const wordCount = content.trim().split(/\s+/).length
        if (wordCount < 50) {
          console.error(`🚨 Content too short for section: ${sectionKey} (${wordCount} words)`)
          throw new GenerationError(
            `Generated content for section ${sectionKey} is too short (${wordCount} words). ` +
            `This indicates poor content quality. Please ensure sufficient source material and try again.`
          )
        }

        return {
          sectionKey,
          content: content.trim(),
          wordCount
        }
      })

      let content = sectionContents.map(sc => sc.content).join('\n\n')

      log('citations', 82, 'Generating bibliography...')

      // 🚀 IMMEDIATE BIBLIOGRAPHY GENERATION - no hydration needed!
      try {
        const { generateBibliography } = await import('@/lib/citations/immediate-bibliography')
        const bibliographyResult = await generateBibliography(
          projectId, 
          'apa' // Default citation style - can be made configurable later
        )
        
        // Append bibliography if citations exist
        if (bibliographyResult.count > 0) {
          content += '\n\n' + bibliographyResult.bibliography
          console.log(`✅ Bibliography generated: ${bibliographyResult.count} citations`)
        } else {
          console.log(`📝 No citations found - skipping bibliography`)
        }
        
      } catch (error) {
        console.error('⚠️ Bibliography generation failed, continuing without bibliography:', error)
        // Don't fail the entire generation if bibliography fails
      }

      // Convert production results to captured tool calls format
      const capturedToolCalls: CapturedToolCall[] = []
      
      // Extract citations from production results
      productionResults.forEach(result => {
        if (result.writingResult?.citations) {
          result.writingResult.citations.forEach(citation => {
            if ('toolCall' in citation && citation.toolCall) {
              const toolCall = citation.toolCall as CapturedToolCall
              if (toolCall.toolCallId && toolCall.toolName && toolCall.args && toolCall.result) {
                capturedToolCalls.push(toolCall)
              }
            }
          })
        }
      })
      
      console.log(`✅ Captured ${capturedToolCalls.length} citation tool calls from production generator`)

      log('citations', 85, 'Saving to database...')

      // Step 6: Persist to database
      const {
        citationsMap,
        citations,
        toolCallAnalytics
      } = await persistGenerationResults(
        projectId,
        content,
        allPapers,
        capturedToolCalls,
        0 // No additional citations added
      )

      // Calculate quality score based on various metrics
      const qualityScore = Math.min(100, Math.round(
        (citations.length * 5) + // Points for citations
        (content.length / 100) + // Points for length
        (capturedToolCalls.length * 3) // Points for tool usage
      ))
      
      onProgress?.({
        stage: 'complete',
        progress: 100,
        message: `🏭 Production paper completed! Quality Score: ${qualityScore}/100`
      })

      return {
        content,
        citations,
        citationsMap,
        wordCount: content.split(/\s+/).length,
        sources: allPapers,
        structure: {
          sections: extractSections(content),
          abstract: extractAbstract(content)
        },
        toolCallAnalytics,
        qualityScore
      }
    } catch (error) {
      console.error(`❌ Error generating paper:`, error)
      
      // Log failure with specific stage
      onProgress?.({
        stage: 'failed',
        progress: 0,
        message: error instanceof GenerationError ? 
          error.message : 
          'An unexpected error occurred during paper generation'
      })
      
      throw error
    }
  });
}

// Re-export types for convenience
export type {
  EnhancedGenerationOptions,
  GenerationResult,
  PaperChunk,
  CapturedToolCall,
  ToolCallAnalytics
} from './types' 