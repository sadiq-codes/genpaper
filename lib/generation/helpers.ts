import type { SectionContext } from '@/lib/prompts/types'
import type { GeneratedOutline } from '@/lib/prompts/types'
import type { PaperChunk } from './types'
import { getRelevantChunks } from './rag-retrieval'
import type { PaperWithAuthors } from '@/types/simplified'

/**
 * Builds the context for each section of the paper, including retrieving relevant
 * chunks of text from source documents.
 * @param outline - The generated outline of the paper.
 * @param topic - The main topic of the paper.
 * @param allPapers - All discovered papers for the project.
 * @returns An array of section contexts, ready for the generation pipeline.
 */
export async function buildSectionContexts(
  outline: GeneratedOutline,
  topic: string,
  allPapers: PaperWithAuthors[] = []
): Promise<SectionContext[]> {
  const sectionContexts: SectionContext[] = []
  const chunkCache = new Map<string, PaperChunk[]>()

  for (const section of outline.sections) {
    const ids = Array.isArray(section.candidatePaperIds) ? section.candidatePaperIds : []
    const cacheKey = ids.slice().sort().join(',')
    let contextChunks = chunkCache.get(cacheKey)

    if (!contextChunks) {
      try {
        contextChunks = await getRelevantChunks(
          topic,
          ids,
          Math.min(20, ids.length * 3),
          allPapers
        )
        chunkCache.set(cacheKey, contextChunks)
        console.log(`📄 Cached chunks for section "${section.title}" (${contextChunks.length} chunks)`)
      } catch (error) {
        console.warn(`⚠️ No relevant chunks found for section "${section.title}": ${error}`)
        console.warn(`⚠️ This section may have limited content quality due to lack of relevant source material`)
        contextChunks = []
        chunkCache.set(cacheKey, contextChunks)
      }
    } else {
      console.log(`📄 Using cached chunks for section "${section.title}" (${contextChunks.length} chunks)`)
    }

    sectionContexts.push({
      sectionKey: section.sectionKey,
      title: section.title,
      candidatePaperIds: ids,
      contextChunks,
      expectedWords: section.expectedWords,
    })
  }

  return sectionContexts
} 