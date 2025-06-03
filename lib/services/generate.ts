import { 
  updateResearchProjectStatus
} from '@/lib/db/research'
import { generateDraftWithRAG } from '@/lib/ai/enhanced-generation'
import type { 
  GenerationConfig
} from '@/types/simplified'

export interface PaperGenerationParams {
  projectId: string
  userId: string
  topic: string
  libraryPaperIds?: string[]
  useLibraryOnly?: boolean
  generationConfig?: GenerationConfig
}

export async function generatePaperPipeline(params: PaperGenerationParams) {
  const { projectId, userId, topic, libraryPaperIds, useLibraryOnly, generationConfig } = params
  
  try {
    // Update project status to generating
    await updateResearchProjectStatus(projectId, 'generating')

    // Generate the research paper using enhanced RAG generation
    // The enhanced version handles paper discovery, database operations, and citations internally
    const result = await generateDraftWithRAG({
      projectId,
      userId,
      topic,
      libraryPaperIds,
      useLibraryOnly,
      config: {
        length: generationConfig?.paper_settings?.length || 'medium',
        style: generationConfig?.paper_settings?.style || 'academic',
        citationStyle: generationConfig?.paper_settings?.citationStyle || 'apa',
        includeMethodology: generationConfig?.paper_settings?.includeMethodology ?? true,
        includeFuture: true,
        search_parameters: generationConfig?.search_parameters,
        paper_settings: generationConfig?.paper_settings,
        model: 'gpt-4o',
        temperature: generationConfig?.temperature || 0.3,
        max_tokens: generationConfig?.max_tokens || 8000
      },
      onProgress: (progress) => {
        console.log(`Generation progress: ${progress.stage} - ${progress.progress}% - ${progress.message}`)
      }
    })

    return result

  } catch (error) {
    console.error('Error in generation pipeline:', error)
    await updateResearchProjectStatus(projectId, 'failed')
    throw error
  }
} 