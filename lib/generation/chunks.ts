import { searchPaperChunks } from '@/lib/db/papers'
import { getSB } from '@/lib/supabase/server'
import { ingestPaperWithChunks } from '@/lib/db/papers'
import type { PaperWithAuthors, GenerationConfig } from '@/types/simplified'
import type { PaperChunk, PaperWithEvidence } from './types'
import { 
  getMinCitationCoverage, 
  getMinCitationFloor, 
  getEvidenceSnippetLength,
  GENERATION_DEFAULTS,
} from './config'
import { debug } from '@/lib/utils/logger'
import type { GeneratedOutline, OutlineSection } from '@/lib/prompts/types'

export async function ensureChunksForPapers(papers: PaperWithAuthors[]): Promise<void> {
  // Check if papers have chunks, create them if missing (for papers added via Library Manager)
  const papersNeedingChunks = []
  const supabase = await getSB()
  
  for (const paper of papers) {
    const { data: existingChunks, error } = await supabase
      .from('paper_chunks')
      .select('id')
      .eq('paper_id', paper.id)
      .limit(1)
    
    if (error || !existingChunks || existingChunks.length === 0) {
      papersNeedingChunks.push(paper)
    }
  }
  
  if (papersNeedingChunks.length === 0) {
    console.log('✅ All papers already have chunks')
    return
  }
  
  console.log(`📄 ${papersNeedingChunks.length} papers need chunk processing for generation`)
  
  // Process each paper that needs chunks
  for (const paper of papersNeedingChunks) {
    try {
      console.log(`📄 Processing chunks for: ${paper.title}`)
      
             // Check if paper has PDF content or full text
       let contentToChunk = ''
       
       // First, try to get stored PDF content (from tiered extraction)
       try {
         const { getPDFContent } = await import('@/lib/services/pdf-downloader')
         const pdfContent = await getPDFContent(paper.id)
         if (pdfContent && pdfContent.length > 100) {
           console.log(`📄 Using stored PDF content for: ${paper.title} (${pdfContent.length} chars)`)
           contentToChunk = pdfContent
         } else {
           console.log(`📄 No stored PDF content found for: ${paper.title}`)
         }
       } catch (pdfError) {
         console.warn(`⚠️ Failed to get PDF content for ${paper.title}:`, pdfError)
       }
       
       // Fallback to abstract if no PDF content
       if (!contentToChunk && paper.abstract) {
         console.log(`📄 Using abstract as content for: ${paper.title}`)
         contentToChunk = paper.abstract
       }
      
      // If we have content, perform full ingestion with chunks
      if (contentToChunk) {
        // Split content into chunks
        const chunks = splitIntoChunks(contentToChunk)
        
        // Convert paper to PaperDTO format for ingestion
        const paperDTO = {
          title: paper.title,
          abstract: paper.abstract,
          publication_date: paper.publication_date,
          venue: paper.venue,
          doi: paper.doi,
          url: paper.url,
          pdf_url: paper.pdf_url,
          metadata: paper.metadata || {},
          source: 'generation_processing',
          citation_count: paper.citation_count || 0,
          impact_score: paper.impact_score || 0,
          authors: paper.author_names || []
        }
        
        // Perform full ingestion with chunks
        await ingestPaperWithChunks(paperDTO, chunks)
        console.log(`✅ Chunks created for: ${paper.title} (${chunks.length} chunks)`)
      } else {
        console.warn(`⚠️ No content available for chunking: ${paper.title}`)
      }
    } catch (error) {
      console.error(`❌ Failed to create chunks for ${paper.title}:`, error)
    }
  }
  
  console.log(`✅ Chunk processing completed for ${papersNeedingChunks.length} papers`)
}

// Helper function to split content into chunks
function splitIntoChunks(content: string, maxChunkSize: number = 8000, overlapSize: number = 200): string[] {
  const chunks: string[] = []
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0)
  
  let currentChunk = ''
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim()
    if (!trimmedSentence) continue
    
    const potentialChunk = currentChunk + (currentChunk ? '. ' : '') + trimmedSentence
    
    if (potentialChunk.length <= maxChunkSize) {
      currentChunk = potentialChunk
    } else {
      // Current chunk is full, save it and start new one
      if (currentChunk) {
        chunks.push(currentChunk + '.')
        
        // Start new chunk with overlap
        const words = currentChunk.split(' ')
        const overlapWords = words.slice(-Math.floor(overlapSize / 6)) // Rough word count estimate
        currentChunk = overlapWords.join(' ') + '. ' + trimmedSentence
      } else {
        // Single sentence is too long, split it
        currentChunk = trimmedSentence
      }
    }
  }
  
  // Add final chunk
  if (currentChunk) {
    chunks.push(currentChunk + '.')
  }
  
  return chunks.filter(chunk => chunk.trim().length > 100) // Filter out very short chunks
}

export async function getRelevantChunks(
  topic: string, 
  paperIds: string[], 
  chunkLimit: number
): Promise<PaperChunk[]> {
  console.log(`📄 Searching for relevant content chunks...`)
  console.log(`   🎯 Query: "${topic}"`)
  console.log(`   📋 Paper IDs: [${paperIds.join(', ')}]`)
  console.log(`   📊 Chunk Limit: ${chunkLimit}`)
  console.log(`   🎯 Min Score: 0.3`)
  
  // --- Adaptive multi-pass retrieval ------------------------------------
  const attempts: Array<{ minScore?: number; label: string }> = [
    { minScore: GENERATION_DEFAULTS.CHUNK_MIN_SCORE_INITIAL, label: 'initial' },
    { minScore: GENERATION_DEFAULTS.CHUNK_MIN_SCORE_FALLBACK, label: 'fallback-low-score' },
    { minScore: undefined, label: 'fallback-no-score' }
  ]

  let allChunks: PaperChunk[] = []
  let firstError: unknown = null

  for (const attempt of attempts) {
    console.log(`📄 Chunk search attempt (${attempt.label}) with minScore=${attempt.minScore ?? 'none'}`)
    const attemptChunks = await searchPaperChunks(topic, {
      // Pass paperIds only on the first attempt—later passes drop the filter in case
      // the ingestion layer stored chunks under a different deterministic UUID.
      paperIds: attempt.label === 'initial' ? paperIds : undefined,
      limit: chunkLimit,
      minScore: attempt.minScore
    }).catch((error: unknown) => {
      console.warn(`⚠️ Content chunks search failed on ${attempt.label}:`, error)
      if (!firstError) firstError = error
      return []
    })

    if (attemptChunks.length > 0) {
      allChunks = attemptChunks
      break
    }
  }

  if (allChunks.length === 0 && firstError) {
    throw firstError
  }
  console.log(`📄 Content Chunks Retrieved: ${allChunks.length}`)
  if (process.env.NODE_ENV === 'development') {
    allChunks.forEach((chunk, idx) => {
      console.log(`   ${idx + 1}. Paper: ${chunk.paper_id}`)
      console.log(`      Content: "${chunk.content?.substring(0, 100) || 'N/A'}..."`)
      console.log(`      Score: ${chunk.score || 'N/A'}`)
    })
  }

  // 🔀 Balance chunks across papers so one long paper does not dominate context
  // Compute a dynamic per-paper cap: at least 2, otherwise proportional to total limit
  const perPaperCap = Math.max(2, Math.floor(chunkLimit / Math.max(1, paperIds.length)))
  const balanced: PaperChunk[] = []
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  for (const chunk of allChunks) {
    if (balanced.length >= chunkLimit) break
    const current = counts.get(chunk.paper_id) || 0
    if (current >= perPaperCap) continue
    balanced.push(chunk)
    seen.add(chunk.content)
    counts.set(chunk.paper_id, current + 1)
  }

  if (balanced.length < chunkLimit) {
    // If we did not reach the desired limit (e.g., few unique papers), fill with remaining chunks
    for (const chunk of allChunks) {
      if (balanced.length >= chunkLimit) break
      if (seen.has(chunk.content)) continue
      balanced.push(chunk)
      seen.add(chunk.content)
    }
  }

  console.log(`📄 Balanced Chunks (perPaperCap = ${perPaperCap}): ${balanced.length}`)
  return balanced
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
  
  // 🔥 NEW: Check if we have author-year citations (indicating tool citations are working)
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
        const fallbackChunks = await searchPaperChunks(papers[0]?.title ?? '', {
          paperIds: papers.map(p => p.id),
          limit: 40,
          minScore: GENERATION_DEFAULTS.CHUNK_MIN_SCORE_FALLBACK
        })
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
    
    // Add evidence-based citations by directly creating [CITE:paper.id] tokens
    for (const { paper, chunk } of uncitedWithEvidence) {
      try {
        // Allow up to 3 citations per paper across the document
        const existingMatches = enhancedContent.match(new RegExp(`\\[CITE:\\s*${paper.id}\\]`, 'ig')) || []
        if (existingMatches.length >= 3) {
          console.log(`⚠️ Citation limit reached for paper ${paper.id} (3)`)
          continue
        }
        
        const authors = paper.author_names?.length ? paper.author_names[0] : "Unknown"
        const year = paper.publication_date ? new Date(paper.publication_date).getFullYear() : undefined
        
        // Improve evidence summary quality - clean and truncate properly  
        const rawContent = chunk!.content || ''
        const cleanedContent = rawContent
          .replace(/\s+/g, ' ') // Normalize whitespace
          .replace(/[<>]/g, '') // Remove HTML-like tags
          .trim()
        
        const maxLength = getEvidenceSnippetLength(config?.paper_settings)
        let evidenceSummary = cleanedContent.slice(0, maxLength)
        
        // Avoid cutting mid-word
        if (cleanedContent.length > maxLength) {
          const lastSpace = evidenceSummary.lastIndexOf(' ')
          const wordBoundaryThreshold = maxLength * GENERATION_DEFAULTS.EVIDENCE_WORD_BOUNDARY_THRESHOLD
          if (lastSpace > wordBoundaryThreshold) { // Only truncate at word boundary if reasonable
            evidenceSummary = evidenceSummary.slice(0, lastSpace)
          }
          evidenceSummary += '…'
        }
        
        // Create evidence-based sentence with direct paper citation
        const evidenceText = `\n\n${evidenceSummary} (${authors}, ${year || 'n.d.'}) [CITE:${paper.id}].`
        
        // Use the exact section title from the outline to find the insertion point
        const litReviewSection = outline.sections.find((s: OutlineSection) => s.sectionKey === 'literatureReview');
        const litReviewHeading = litReviewSection ? litReviewSection.title : "Literature Review";
        const litReviewRegex = new RegExp(`(#+\\s*${litReviewHeading}\\s*[\\r\\n]+)([\\s\\S]*?)(?=\\n#+|$)`, 'i');
        
        const match = enhancedContent.match(litReviewRegex)
        
        if (match && match[2]) {
          const sectionContent = match[2];
          const insertionPoint = match.index! + match[1].length + sectionContent.length;
          enhancedContent = enhancedContent.slice(0, insertionPoint) + 
                           evidenceText + 
                           enhancedContent.slice(insertionPoint)
        } else {
          // Fallback: append to end with a clear heading
          enhancedContent += `\n\n## Literature Review\n${evidenceText}`
        }
        
        // Update cited papers set for subsequent duplicate checks
        citedPaperIds.add(paper.id)
        addedEvidenceCitations++
        
        const title = paper.title.length > 50 ? paper.title.substring(0, 50) + "..." : paper.title
        const scoreText = typeof chunk?.score === 'number' ? chunk.score.toFixed(3) : 'n/a'
        debug.log(`📌 Added evidence-based citation: "${title}" (score: ${scoreText})`)
        
      } catch (error) {
        console.error(`Error adding evidence-based citation for ${paper.id}:`, error)
      }
    }
    
    console.log(`✅ Added ${addedEvidenceCitations} evidence-based citations`)
    
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

  // ---------- Secondary citations from reference lists ----------
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

// Fail fast helper when chunks remain empty after adaptive attempts
export function assertChunksFound(chunks: PaperChunk[], context: string): void {
  if (chunks.length === 0) {
    throw new Error(
      `RAG failed: no content chunks found for ${context}. ` +
      `Ensure papers are ingested with chunks or disable paperId filtering.`
    )
  }
} 