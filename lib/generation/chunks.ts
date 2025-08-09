// Re-export functions from centralized modules
export {
  getContentStatus,
  checkContentAvailability,
  ensureBulkContentIngestion,
  ContentRetrievalError,
  NoRelevantContentError,
  ContentQualityError
} from '@/lib/content'

export {
  getRelevantChunks,
  assertChunksFound
} from './rag-retrieval'

// Keep citation-specific functionality in this file
import { searchPaperChunks } from '@/lib/db/papers'
import { ContextRetrievalService } from '@/lib/generation/context-retrieval-service'
import { isRetrievalServiceEnabled } from '@/lib/config/feature-flags'
import type { PaperWithAuthors, GenerationConfig } from '@/types/simplified'
import type { PaperWithEvidence } from './types'
import { 
  getMinCitationCoverage, 
  getMinCitationFloor, 
  getEvidenceSnippetLength,
  GENERATION_DEFAULTS,
} from './config'
import { debug } from '@/lib/utils/logger'
import type { GeneratedOutline, OutlineSection } from '@/lib/prompts/types'
import { createHash } from 'crypto'

interface PaperChunk {
  id: string
  paper_id: string
  content: string
  metadata: Record<string, unknown>
  score: number
}

// Helper function to create deterministic chunk IDs
function createDeterministicChunkId(paperId: string, content: string, index?: number): string {
  const contentHash = createHash('sha256')
    .update(content.substring(0, 100)) // Use first 100 chars for hash
    .digest('hex')
    .substring(0, 8) // Take first 8 chars of hash
  
  return index !== undefined 
    ? `chunk-${paperId}-${index}-${contentHash}`
    : `chunk-${paperId}-${contentHash}`
}

export async function addEvidenceBasedCitations(
  content: string,
  papers: PaperWithAuthors[],
  originalChunks: PaperChunk[],
  config: GenerationConfig,
  outline: GeneratedOutline,
  referencesByPaper?: Record<string, import("@/lib/services/academic-apis").PaperReference[]>,
  preCitedPaperIds?: Set<string>
): Promise<{ enhancedContent: string; addedCitationsCount: number }> {
  // Extract existing citations from content
  const existingCitations = content.match(/\[CITE:\s*([^\]]+)\]/gi) || []
  const citedPaperIds = new Set<string>(preCitedPaperIds ? [...preCitedPaperIds] : [])
  existingCitations.forEach(c => {
    const id = c.replace(/\[CITE:\s*([^\]]+)\]/, '$1')
    if (id) citedPaperIds.add(id)
  })
  
  console.log(`📊 Cited papers: ${citedPaperIds.size}/${papers.length}`)
  console.log(`📊 Citation coverage: ${Math.round((citedPaperIds.size / papers.length) * 100)}%`)
  
  // Determine minimum citation coverage target (configurable)
  const coverageTarget = getMinCitationCoverage(config?.paper_settings)
  const minCitationFloor = getMinCitationFloor(config?.paper_settings)
  const minCitations = Math.max(minCitationFloor, Math.floor(papers.length * coverageTarget))
  const currentCitations = citedPaperIds.size
  
  // Check if we have author-year citations (indicating tool citations are working)
  const authorYearCitations = content.match(/\([A-Za-z][^)]*,\s*\d{4}\)/g) || []
  const hasToolCitations = authorYearCitations.length > 0
  
  console.log(`📊 Citation analysis:`)
  console.log(`   - [CITE:...] tokens: ${currentCitations}`)
  console.log(`   - Author-year citations: ${authorYearCitations.length}`)
  console.log(`   - Tool citations working: ${hasToolCitations}`)
  
  // If tool citations are working, be much less aggressive with evidence enrichment
  const adjustedMinCitations = hasToolCitations 
    ? Math.max(2, Math.floor(minCitations * 0.5)) // Reduce target by 50% when tools work
    : minCitations
  
  console.log(`📊 Citation targets: original=${minCitations}, adjusted=${adjustedMinCitations}`)
  
  let enhancedContent = content
  let addedEvidenceCitations = 0
  let chunks: PaperChunk[] = [...originalChunks] // local mutable copy
  
  if (currentCitations < adjustedMinCitations) {
    // If we have no chunks at all, try a best-effort fallback search
    if (chunks.length === 0) {
      try {
        console.log('🔄 No RAG chunks available – performing blind chunk search for evidence')
        const fallbackRaw = isRetrievalServiceEnabled()
          ? (await ContextRetrievalService.retrieve({
              query: papers[0]?.title ?? '',
              paperIds: papers.map(p => p.id),
              k: 40,
              minScore: GENERATION_DEFAULTS.CHUNK_MIN_SCORE_FALLBACK
            })).chunks
          : await searchPaperChunks(papers[0]?.title ?? '', {
              paperIds: papers.map(p => p.id),
              limit: 40,
              minScore: GENERATION_DEFAULTS.CHUNK_MIN_SCORE_FALLBACK
            })
        const fallbackChunks = fallbackRaw.map(result => ({
          id: createDeterministicChunkId(result.paper_id, result.content),
          paper_id: result.paper_id,
          content: result.content,
          metadata: { source: 'chunk_search' },
          score: result.score
        }))
        chunks = fallbackChunks
      } catch (e) {
        console.warn('⚠️ Fallback chunk search failed:', e)
      }
    }

    console.log(`📈 Adding evidence-based citations (${currentCitations} < ${adjustedMinCitations} target)`)
    
    // Identify uncited papers that have evidence in chunks  
    const uncitedPapers = papers.filter(paper => !citedPaperIds.has(paper.id))
    
    // Pre-index chunks by paper for performance
    const chunksByPaper = new Map<string, PaperChunk[]>()
    chunks.forEach(chunk => {
      if (!chunksByPaper.has(chunk.paper_id)) {
        chunksByPaper.set(chunk.paper_id, [])
      }
      chunksByPaper.get(chunk.paper_id)!.push(chunk)
    })
    
    const uncitedWithEvidence: PaperWithEvidence[] = uncitedPapers
      .map(paper => {
        // Find the highest-scoring chunk for this paper
        const paperChunks = chunksByPaper.get(paper.id) || []
        const bestChunk = paperChunks.length > 0 
          ? paperChunks.reduce((best, current) => 
              (current.score || 0) > (best.score || 0) ? current : best
            )
          : null
        
        return { paper, chunk: bestChunk }
      })
      .filter(item => item.chunk !== null) // Only include papers with evidence
      .slice(0, adjustedMinCitations - currentCitations) // Limit to needed citations
    
    console.log(`📋 Uncited papers with evidence available: ${uncitedWithEvidence.length}`)
    
    // NOTE: Evidence-based citation injection disabled - citations should come from addCitation tool
    // The addCitation tool in the prompt system handles all citation placement
    console.log(`📋 Skipping evidence-based citation injection - relying on addCitation tool`)
    console.log(`📋 Available papers for AI citation tool: ${uncitedWithEvidence.length}`)
    
    // Log available evidence for debugging
    uncitedWithEvidence.slice(0, 5).forEach(({ paper, chunk }, index) => {
      const title = paper.title.length > 50 ? paper.title.substring(0, 50) + "..." : paper.title
      const scoreText = typeof chunk?.score === 'number' ? chunk.score.toFixed(3) : 'n/a'
           console.log(`   ${index + 1}. "${title}" (score: ${scoreText})`)
    })
    
    console.log(`✅ Skipped evidence-based citation injection (${addedEvidenceCitations} citations added)`)
    
    // Warn about papers without evidence
    const papersWithoutEvidence = uncitedPapers.filter(paper => 
      !chunksByPaper.has(paper.id) || chunksByPaper.get(paper.id)!.length === 0
    )
    
    if (papersWithoutEvidence.length > 0) {
      console.warn(`⚠️ Papers without evidence (skipped): ${papersWithoutEvidence.length}`)
      papersWithoutEvidence.forEach(paper => {
        const title = paper.title.length > 50 ? paper.title.substring(0, 50) + "..." : paper.title
        console.warn(`   - "${title}" by ${paper.author_names?.[0] || "Unknown"}`)
      })
    }
    
  } else {
    console.log(`✅ Citation coverage adequate (${currentCitations}/${adjustedMinCitations})`)
  }

  // Secondary citations from reference lists
  if (referencesByPaper && currentCitations + addedEvidenceCitations < adjustedMinCitations) {
    const needed = adjustedMinCitations - (currentCitations + addedEvidenceCitations)
    let added = 0
    for (const refs of Object.values(referencesByPaper)) {
      for (const ref of refs) {
        if (added >= needed) break
        // Build simple author-year inline citation
        const author = ref.authors?.[0] || 'Unknown'
        const authorLast = author.includes(',') ? author.split(',')[0] : author.split(' ').pop() || author
        const year = ref.year || 'n.d.'
        const inline = `(${authorLast}, ${year})`
        if (enhancedContent.includes(inline)) continue // already present
        enhancedContent += `\n${inline}`
        addedEvidenceCitations++
        added++
      }
      if (added >= needed) break
    }
  }

  return {
    enhancedContent,
    addedCitationsCount: addedEvidenceCitations
  }
} 