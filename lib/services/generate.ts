import { 
  addProjectVersion, 
  addProjectCitation,
  updateResearchProjectStatus
} from '@/lib/db/research'
import { getUserLibraryPapers } from '@/lib/db/library'
import { searchOnlinePapers, selectRelevantPapers } from '@/lib/ai/search-papers'
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
      const searchResults = await searchOnlinePapers(
        topic,
        generationConfig?.search_parameters?.sources,
        generationConfig?.search_parameters?.limit
      )
      
      // Select most relevant papers
      const selectedPapers = await selectRelevantPapers(searchResults, topic, 10)
      papers = [...papers, ...selectedPapers]
    }

    if (papers.length === 0) {
      throw new Error('No papers found for the given topic')
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