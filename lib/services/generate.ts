import { 
  addProjectVersion, 
  addProjectCitation,
  updateResearchProjectStatus
} from '@/lib/db/research'
import { getUserLibraryPapers } from '@/lib/db/library'
import { enhancedSearch } from '@/lib/services/enhanced-search'
import { generateResearchPaper } from '@/lib/ai/generate-paper'
import type { 
  PaperWithAuthors,
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
    let papers: PaperWithAuthors[] = []

    // Get papers from library if specified
    if (libraryPaperIds && libraryPaperIds.length > 0) {
      const libraryPapers = await getUserLibraryPapers(userId)
      papers = libraryPapers
        .filter(lp => libraryPaperIds.includes(lp.paper_id))
        .map(lp => lp.paper as PaperWithAuthors)
    }

    // Search for additional papers if not library-only
    if (!useLibraryOnly) {
      const searchResult = await enhancedSearch(topic, {
        sources: generationConfig?.search_parameters?.sources as ("openalex" | "crossref" | "semantic_scholar" | "arxiv" | "core")[] | undefined,
        maxResults: generationConfig?.search_parameters?.limit || 10,
        useSemanticSearch: true,
        fallbackToKeyword: true,
        fallbackToAcademic: true,
        minResults: 5,
        combineResults: true
      })
      
      papers = [...papers, ...searchResult.papers]
    }

    if (papers.length === 0) {
      throw new Error(`No papers found for the topic "${topic}". Please add relevant papers to your library or check your database connection.`)
    }

    // Generate the research paper
    const result = await generateResearchPaper(
      topic,
      papers,
      {
        length: generationConfig?.paper_settings?.length || 'medium',
        style: generationConfig?.paper_settings?.style || 'academic',
        citationStyle: generationConfig?.paper_settings?.citationStyle || 'apa',
        includeMethodology: generationConfig?.paper_settings?.includeMethodology ?? true,
        includeFuture: true
      }
    )

    // Save the generated content as version 1
    const version = await addProjectVersion(projectId, result.content, 1)

    // Parallelize citation inserts
    await Promise.all(
      result.citations.map(citation =>
        addProjectCitation(
          projectId,
          version.version,
          citation.paperId,
          citation.citationText,
          citation.positionStart,
          citation.positionEnd,
          citation.pageRange
        )
      )
    )

    // Update project status to complete
    await updateResearchProjectStatus(projectId, 'complete', new Date().toISOString())

    return result

  } catch (error) {
    console.error('Error in generation pipeline:', error)
    await updateResearchProjectStatus(projectId, 'failed')
    throw error
  }
} 