import { ContextRetrievalService } from '@/lib/generation/context-retrieval-service'
import { getPapersByIds } from '@/lib/db/library'
import type { PaperWithAuthors } from '@/types/simplified'
import { getContentStatus, ensureBulkContentIngestion } from '@/lib/content'
import { createDeterministicChunkId } from '@/lib/utils/deterministic-id'

interface PaperChunk {
  id: string
  paper_id: string
  content: string
  metadata: Record<string, unknown>
  score: number
  paper?: PaperWithAuthors
}

import { 
  ContentRetrievalError, 
  NoRelevantContentError, 
  ContentQualityError 
} from '@/lib/content/errors'



/**
 * Get relevant chunks for RAG generation
 */
export async function getRelevantChunks(
  topic: string,
  paperIds: string[],
  chunkLimit: number,
  allPapers: PaperWithAuthors[]
): Promise<PaperChunk[]> {
  if (!topic || topic.trim().length < 10) {
    throw new ContentRetrievalError('Topic must be at least 10 characters long')
  }

  if (!paperIds.length) {
    throw new ContentRetrievalError('No papers provided for content retrieval')
  }

  console.log(`📄 Searching for relevant content chunks...`)
  console.log(`   🎯 Query: "${topic}"`)
  console.log(`   📋 Paper IDs: [${paperIds.join(', ')}]`)
  console.log(`   📊 Chunk Limit: ${chunkLimit}`)
  
  // Get content status for all papers first
  const statusMap = await getContentStatus(paperIds)
  const papersWithContent = paperIds.filter(id => {
    const status = statusMap.get(id)
    return status?.hasContent && (status.chunkCount > 0 || status.contentType === 'abstract')
  })
  
  if (papersWithContent.length === 0) {
    console.warn(`⚠️ No papers have any content available. Triggering content ingestion...`)
    const libraryPapers = await getPapersByIds(paperIds)
    
    // Validate paper retrieval
    if (!libraryPapers.length) {
      throw new ContentRetrievalError('Failed to retrieve papers from library')
    }
    
    const papers = libraryPapers.map(lp => ({
      ...lp.paper,
      authors: lp.paper.authors || [],
      author_names: lp.paper.authors?.map(a => a.name) || []
    } as PaperWithAuthors))
    
    // Try to ingest content
    await ensureBulkContentIngestion(papers)
    
    // Verify ingestion success
    const retryStatus = await getContentStatus(paperIds)
    const papersWithContentAfterIngestion = paperIds.filter(id => {
      const status = retryStatus.get(id)
      return status?.hasContent && (status.chunkCount > 0 || status.contentType === 'abstract')
    })
    
    if (papersWithContentAfterIngestion.length === 0) {
      throw new ContentRetrievalError('Failed to ingest content for any papers', {
        attempted: papers.length,
        paperIds
      })
    }
    
    papersWithContent.push(...papersWithContentAfterIngestion)
  }
  
  console.log(`📊 Content availability: ${papersWithContent.length}/${paperIds.length} papers have content`)
  
  // DEBUG: Log the paper IDs being used for chunk filtering
  console.log(`🔍 CHUNK FILTER: Looking for chunks belonging to these ${paperIds.length} paper IDs:`)
  paperIds.forEach((id, idx) => {
    console.log(`   ${idx + 1}. ${id}`)
  })
  
  // Multi-stage retrieval with relaxed thresholds optimized for abstract content
  const attempts = [
    { minScore: 0.5, label: 'high-precision', paperIds: papersWithContent },
    { minScore: 0.3, label: 'balanced', paperIds: papersWithContent },
    { minScore: 0.2, label: 'high-recall', paperIds: papersWithContent },
    { minScore: 0.15, label: 'ultra-recall', paperIds: papersWithContent } // Ultra-low threshold for abstracts
  ]

  let allChunks: PaperChunk[] = []
  let firstError: unknown = null
  let bestScores: number[] = []

  for (const attempt of attempts) {
    try {
      console.log(`📄 Chunk search attempt (${attempt.label}) with minScore=${attempt.minScore}`)
      
      const searchResultsRaw = (await ContextRetrievalService.retrieve({ 
        query: topic, 
        paperIds: attempt.paperIds, 
        k: chunkLimit * 2, 
        minScore: attempt.minScore 
      })).chunks

      const searchResults = searchResultsRaw.map((result, idx) => ({
        id: createDeterministicChunkId(result.paper_id, result.content, idx),
        paper_id: result.paper_id,
        content: result.content,
        metadata: { 
          source: 'chunk_search', 
          score: typeof result.score === 'number' ? result.score : 0,
          searchStage: attempt.label
        },
        score: typeof result.score === 'number' ? result.score : 0,
        paper: allPapers.find(p => p.id === result.paper_id)
      }))
      
      if (searchResults.length > 0) {
        // Validate content quality
        const scores: number[] = searchResults.map(r => r.score)
        const avgScore = scores.reduce((a: number, b: number) => a + b, 0) / scores.length
        const minScore = Math.min(...scores)
        const maxScore = Math.max(...scores)
        
        console.log(`📊 Score distribution:`)
        console.log(`   - Average: ${avgScore.toFixed(3)}`)
        console.log(`   - Range: ${minScore.toFixed(3)} - ${maxScore.toFixed(3)}`)
      
        // Track best scores seen for error reporting
        if (scores.length > bestScores.length || Math.max(...scores) > Math.max(...bestScores)) {
          bestScores = scores
        }
        
        // Validate chunk content (relaxed thresholds)
        let validChunks = searchResults.filter(chunk => {
          const content = chunk.content.trim()
          return content.length >= 30 && // Relaxed minimum content length
                 content.split(/\s+/).length >= 5 && // Relaxed minimum word count
                 !/^[\d\s.,-]+$/.test(content) // Not just numbers and punctuation
        })

        // Safety: if all fail relaxed validation, keep top few anyway to avoid hard fallback
        if (validChunks.length === 0) {
          console.warn(`⚠️ All chunks failed quality validation in ${attempt.label} attempt (relaxed). Using top raw chunks as fallback.`)
          validChunks = searchResults.slice(0, Math.min(10, searchResults.length))
        }

        allChunks = validChunks
        console.log(`✅ Found ${validChunks.length} valid chunks in ${attempt.label} attempt`)
        
        // DEBUG: Visualize ID mismatch between chunks and requested paper IDs
        console.log('🔍 CHUNK SEARCH RESULTS:')
        console.log(`   📄 Found ${validChunks.length} chunks with paper IDs:`)
        validChunks.forEach((chunk, idx) => {
          console.log(`      ${idx + 1}. Chunk from paper: ${chunk.paper_id}`)
          console.log(`         Content preview: "${chunk.content.substring(0, 100)}..."`)
        })
        console.log(`   🎯 Expected paper IDs for this project (${paperIds.length} total):`)
        paperIds.forEach((id, idx) => {
          console.log(`      ${idx + 1}. ${id}`)
        })
        
        // Show exact matches/mismatches
        const foundIds = new Set(validChunks.map(c => c.paper_id))
        const expectedIds = new Set(paperIds)
        const matches = paperIds.filter(id => foundIds.has(id))
        const missingInChunks = paperIds.filter(id => !foundIds.has(id))
        const extraInChunks = validChunks.map(c => c.paper_id).filter(id => !expectedIds.has(id))
        
        console.log(`   ✅ Matching IDs (${matches.length}): [${matches.join(', ')}]`)
        console.log(`   ❌ Expected but not found in chunks (${missingInChunks.length}): [${missingInChunks.join(', ')}]`)
        console.log(`   ⚠️  Found in chunks but not expected (${extraInChunks.length}): [${extraInChunks.join(', ')}]`)
        
        break
      }
      
    } catch (error) {
      console.warn(`⚠️ Search attempt failed (${attempt.label}):`, error)
      if (!firstError) firstError = error
    }
  }

  // If no chunks are found after all attempts, use abstracts as a fallback
  if (allChunks.length === 0) {
    console.warn(
      '⚠️ No relevant chunks found. Using paper abstracts as fallback context.'
    )
    const abstractChunks = allPapers
      .filter(p => p.abstract && p.abstract.trim().length >= 100) // Ensure abstract has meaningful content
      .slice(0, 10) // Limit to top 10 abstracts
      .map(p => ({
        id: `abstract-${p.id}`,
        paper_id: p.id,
        content: `Title: ${p.title}\n\nAbstract: ${p.abstract}`, // Keep it clean
        metadata: { source: 'abstract-fallback' },
        score: 0.5, // Assign a default score for abstracts
      }))

    if (abstractChunks.length === 0) {
      console.error('❌ No chunks found and no abstracts available.')
      throw new NoRelevantContentError(
        'Could not find any relevant content or abstracts for the selected papers.'
      )
    }
    
    console.log(`✅ Using ${abstractChunks.length} abstracts as fallback context.`)
    return abstractChunks
  }

  // Final check to ensure some chunks were found
  assertChunksFound(allChunks, topic, paperIds)

  // Validate final content quality (relaxed for abstract-based content)
  const avgScore = allChunks.reduce((sum, chunk) => sum + chunk.score, 0) / allChunks.length
  if (avgScore < 0.08) { // Further lowered threshold to avoid false negatives with abstract-heavy corpora
    throw new ContentQualityError(
      `Content relevance scores too low for reliable generation (avg: ${avgScore.toFixed(3)})`,
      { scores: allChunks.map(c => c.score) }
    )
  }

  // SURGICAL FIX: Fallback booster - split abstracts into bite-sized chunks when < 30 chunks
  if (allChunks.length < 30) {
    console.warn('⚠️ Too few chunks; falling back to abstracts for additional context.')
    
    const abstractChunks: PaperChunk[] = []
    
    for (const paper of allPapers) {
      if (!paper.abstract || paper.abstract.trim().length < 100) continue
      
      // Split long abstracts into paragraphs/sentences for better vector retrieval
      const abstract = paper.abstract.trim()
      
      if (abstract.length > 800) {
        // Split very long abstracts by sentences
        const sentences = abstract.split(/[.!?]+/).filter(s => s.trim().length > 50)
        sentences.forEach((sentence, idx) => {
          if (sentence.trim().length > 50) {
            abstractChunks.push({
              id: `abstract-split-${paper.id}-${idx}`,
              paper_id: paper.id,
              content: `Title: ${paper.title}\n\nAbstract (Part ${idx + 1}): ${sentence.trim()}.`,
              metadata: { source: 'abstract-split', part: idx + 1 },
              score: 0.4,
              paper
            })
          }
        })
      } else {
        // Regular abstract chunk
        abstractChunks.push({
          id: `abstract-fallback-${paper.id}`,
          paper_id: paper.id,
          content: `Title: ${paper.title}\n\nAbstract: ${abstract}`,
          metadata: { source: 'abstract-fallback' },
          score: 0.4,
          paper
        })
      }
    }
    
    // Add abstracts for papers not already represented in chunks
    const existingPaperIds = new Set(allChunks.map(c => c.paper_id))
    const newAbstractChunks = abstractChunks.filter(c => !existingPaperIds.has(c.paper_id))
    
    allChunks.push(...newAbstractChunks)
    console.log(`📄 Added ${newAbstractChunks.length} abstract chunks for additional context`)
  }

  // Balance chunks across papers with higher limits
  const CHUNKS_PER_PAPER = 10 // Increased from 5 to allow more content per paper
  const perPaperCap = Math.max(CHUNKS_PER_PAPER, Math.ceil(chunkLimit / Math.max(1, papersWithContent.length)))
  const balanced = balanceChunks(allChunks, perPaperCap, chunkLimit)
  
  // Final validation of balanced chunks
  if (balanced.length < Math.min(3, chunkLimit)) {
    throw new ContentQualityError(
      `Insufficient content after balancing (${balanced.length} chunks)`,
      { scores: balanced.map(c => c.score) }
    )
  }
  
  console.log(`📄 Final balanced chunks: ${balanced.length} (max ${perPaperCap} per paper)`)
  return balanced
}

/**
 * Helper function to balance chunks across papers
 */
function balanceChunks(chunks: PaperChunk[], perPaperCap: number, totalLimit: number): PaperChunk[] {
  const balanced: PaperChunk[] = []
  const paperCounts = new Map<string, number>()
  const seen = new Set<string>()
  
  // First pass: Take top chunks from each paper up to cap
  for (const chunk of chunks) {
    if (balanced.length >= totalLimit) break
    
    const count = paperCounts.get(chunk.paper_id) || 0
    if (count >= perPaperCap) continue
    if (seen.has(chunk.content)) continue
    
    balanced.push(chunk)
    seen.add(chunk.content)
    paperCounts.set(chunk.paper_id, count + 1)
  }

  // Second pass: Fill remaining slots if needed
  if (balanced.length < totalLimit) {
    for (const chunk of chunks) {
      if (balanced.length >= totalLimit) break
      if (seen.has(chunk.content)) continue
      
      balanced.push(chunk)
      seen.add(chunk.content)
    }
  }

  return balanced
}

/**
 * Fail fast helper when chunks remain empty after adaptive attempts
 */
export function assertChunksFound(chunks: PaperChunk[], topic: string, paperIds: string[]): void {
  if (chunks.length === 0) {
    const errorContext = `topic: "${topic}", paperIds: [${paperIds.slice(0, 5).join(', ')}${paperIds.length > 5 ? '...' : ''}]`
    throw new Error(
      `RAG failed: no content chunks found for ${errorContext}. ` +
      `Ensure papers are ingested with chunks or disable paperId filtering.`
    )
  }
}
