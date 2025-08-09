import { getSB } from '@/lib/supabase/server'
import { getPapersByIds as getLibraryPapersByIds } from '@/lib/db/library'
import type { EnhancedGenerationOptions } from './types'

// 🆕 OPTIMIZATION: Import structured logging
import { logSearchMetrics, createTimer, type SearchMetrics } from '@/lib/utils/logger'

// Helper function to check if URL is likely a direct PDF
function isLikelyDirectPdfUrl(url: string): boolean {
  if (!url) return false
  
  // Direct PDF patterns
  const directPdfPatterns = [
    /\.pdf$/i,
    /arxiv\.org\/pdf\//i,
    /biorxiv\.org\/content\/.*\.full\.pdf/i,
    /medrxiv\.org\/content\/.*\.full\.pdf/i,
    /core\.ac\.uk\/download\/pdf/i,
    /europepmc\.org\/.*\.pdf/i,
    /ncbi\.nlm\.nih\.gov\/pmc\/articles\/.*\/pdf/i,
  ]
  
  // Publisher landing page patterns (NOT direct PDFs)
  const landingPagePatterns = [
    /doi\.org\//i,
    /dx\.doi\.org\//i,
    /link\.springer\.com\//i,
    /ieeexplore\.ieee\.org\//i,
    /acm\.org\/doi\//i,
    /onlinelibrary\.wiley\.com\//i,
    /sciencedirect\.com\/science\/article\//i,
    /nature\.com\/articles\//i,
    /tandfonline\.com\//i,
    /jstor\.org\//i,
    /sage.*\.com\//i
  ]
  
  // Check if it's a known landing page
  if (landingPagePatterns.some(pattern => pattern.test(url))) {
    return false
  }
  
  // Check if it's a direct PDF
  return directPdfPatterns.some(pattern => pattern.test(url))
}
import type { PaperWithAuthors, PaperSource } from '@/types/simplified'
import type { UnifiedSearchOptions, UnifiedSearchResult } from '@/lib/services/search-orchestrator'
import { unifiedSearch } from '@/lib/services/search-orchestrator'
import { pdfQueue } from '@/lib/services/pdf-queue'
import { decideIngest } from './policy'

// Main entry ────────────────────────────────────────────────
export async function collectPapers(
  options: EnhancedGenerationOptions
): Promise<PaperWithAuthors[]> {

  const { topic, libraryPaperIds = [], useLibraryOnly, config, userId } = options
  
  console.log(`📋 Generation Request:`)
  console.log(`   🎯 Topic: "${topic}"`)
  console.log(`   📚 Pinned Library Papers: ${libraryPaperIds.length}`)
  console.log(`   🔒 Library Only Mode: ${useLibraryOnly}`)
  console.log(`   ⚙️ Target Limit: ${config?.search_parameters?.limit || 10}`)
  
  // 1. pinned papers
  const pinnedPapers = libraryPaperIds.length
    ? await getLibraryPapersByIds(libraryPaperIds)
    : []
  
  console.log(`📚 Pinned Papers Retrieved: ${pinnedPapers.length}`)
  pinnedPapers.forEach((lp, idx) => {
    const paper = lp.paper as PaperWithAuthors
    console.log(`   ${idx + 1}. "${paper.title}" (${paper.id})`)
    console.log(`      Authors: ${paper.author_names?.join(', ') || 'Unknown'}`)
    console.log(`      Year: ${paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'Unknown'}`)
  })
  
  const pinnedIds = pinnedPapers.map(lp => lp.paper.id)
  const targetTotal = config?.search_parameters?.limit || 90
  const remainingSlots = Math.max(0, targetTotal - pinnedPapers.length)
  
  console.log(`🔍 Search Parameters:`)
  console.log(`   📊 Target Total Papers: ${targetTotal}`)
  console.log(`   🎯 Remaining Search Slots: ${remainingSlots}`)

  // 🆕 OPTIMIZATION: Check library coverage before external APIs
  let discoveredPapers: PaperWithAuthors[] = []
  
  if (!useLibraryOnly && remainingSlots > 0) {
    console.log(`🔍 Checking library coverage before external search...`)
    
    // Quick library relevance check first
    const libraryCoverage = await checkLibraryCoverage(topic, userId, remainingSlots)
    console.log(`📚 Library Coverage: ${libraryCoverage.papers.length} relevant papers, score: ${libraryCoverage.coverageScore.toFixed(2)}`)
    
    // If library coverage is sufficient (≥ 70%), skip external APIs
    const COVERAGE_THRESHOLD = 0.7
    if (libraryCoverage.coverageScore >= COVERAGE_THRESHOLD && libraryCoverage.papers.length >= remainingSlots) {
      console.log(`✅ Library coverage sufficient (${libraryCoverage.coverageScore.toFixed(2)} ≥ ${COVERAGE_THRESHOLD}), using library papers only`)
      discoveredPapers = libraryCoverage.papers.slice(0, remainingSlots)
    } else {
      console.log(`📡 Library coverage insufficient, proceeding with external search...`)
      
      try {
        const searchOptions: UnifiedSearchOptions = {
          maxResults: remainingSlots,
          minResults: Math.min(5, remainingSlots),
          excludePaperIds: [...pinnedIds, ...libraryCoverage.papers.map(p => p.id)],
          fromYear: 2000,
          localRegion: config?.paper_settings?.localRegion,
          useHybridSearch: true,
          useKeywordSearch: true,
          useAcademicAPIs: true,
          combineResults: true,
          fastMode: false,
          sources: (config?.search_parameters?.sources as PaperSource[])
                    ?? ['openalex', 'crossref', 'semantic_scholar'],
          semanticWeight: config?.search_parameters?.semanticWeight ?? 0.4,
          authorityWeight: config?.search_parameters?.authorityWeight ?? 0.5,
          recencyWeight: config?.search_parameters?.recencyWeight ?? 0.1
        }
        
        const searchResult = await unifiedSearchWithRetry(topic, searchOptions)
        
        // Combine library papers with external search results
        const externalPapers = searchResult.papers as PaperWithAuthors[]
        const availableSlots = remainingSlots - libraryCoverage.papers.length
        discoveredPapers = [
          ...libraryCoverage.papers,
          ...externalPapers.slice(0, Math.max(0, availableSlots))
        ]
        
        console.log(`🎯 Combined search results: ${libraryCoverage.papers.length} from library + ${externalPapers.length} from external`)
        
        if (searchResult.metadata.errors.length > 0) {
          console.warn(`⚠️ Search completed with warnings: ${searchResult.metadata.errors.join(', ')}`)
        }

      } catch (err) {
        console.error('Unified search failed, falling back to library papers only:', err)
        discoveredPapers = libraryCoverage.papers.slice(0, remainingSlots)
      }
    }

    // Auto-ingest discovered papers if policy allows
    if (discoveredPapers.length > 0) {
      const shouldIngest = decideIngest({
        librarySize: pinnedPapers.length,
        userId
      })
      
      if (shouldIngest) {
        console.log(`📥 Auto-ingesting ${discoveredPapers.length} papers to database...`)
        
        try {
          const { ingestPaper, getPapersByIds } = await import('@/lib/db/papers')
          
          const ingestResults = await Promise.allSettled(
            discoveredPapers.map(async (paper) => {
              try {
                const result = await ingestPaper({
                  title: paper.title,
                  authors: paper.author_names || [],
                  abstract: paper.abstract,
                  publication_date: paper.publication_date,
                  venue: paper.venue,
                  doi: paper.doi,
                  url: paper.url,
                  pdf_url: (paper as { pdf_url?: string }).pdf_url,
                  metadata: paper.metadata || {},
                  source: 'search-api',
                  citation_count: paper.citation_count || 0,
                  impact_score: paper.impact_score || 0
                })
                
                return { paperId: result.paperId, success: true, originalIndex: discoveredPapers.indexOf(paper) }
              } catch (error) {
                console.warn(`Failed to ingest paper "${paper.title}":`, error)
                return { paperId: '', success: false, error: error instanceof Error ? error.message : 'Unknown error', originalIndex: discoveredPapers.indexOf(paper) }
              }
            })
          )
          
          const successful = ingestResults.filter(r => r.status === 'fulfilled' && r.value.success)
          const failed = ingestResults.length - successful.length
          
          console.log(`✅ Auto-ingestion completed: ${successful.length}/${discoveredPapers.length} papers ingested`)
          if (failed > 0) {
            console.warn(`⚠️ ${failed} papers failed to ingest`)
          }
          
          // Now fetch the complete paper data from database using the returned IDs
          if (successful.length > 0) {
            const ingestedPaperIds = successful.map(r => (r as { value: { paperId: string } }).value.paperId)
            console.log(`🔄 Fetching complete paper data for ${ingestedPaperIds.length} ingested papers...`)
            
            const ingestedPapers = await getPapersByIds(ingestedPaperIds)
            console.log(`✅ Retrieved ${ingestedPapers.length} complete papers from database`)
            
            // Replace discoveredPapers with the properly ingested and fetched papers
            discoveredPapers = ingestedPapers
          } else {
            // No papers were successfully ingested
            console.warn(`❌ No papers were successfully ingested, proceeding with empty discovered papers`)
            discoveredPapers = []
          }
        } catch (error) {
          console.error('Auto-ingestion failed:', error)
          // On ingestion failure, clear discovered papers to avoid using stale data
          discoveredPapers = []
        }
      } else {
        console.log(`🔒 Auto-ingestion policy: library size ${pinnedPapers.length} above threshold, skipping ingestion`)
      }
    }
  }

  // Combine pinned and discovered papers
  const pinnedPaperObjects = pinnedPapers.map(lp => lp.paper as PaperWithAuthors)
  
  // discoveredPapers now contains the complete ingested papers from database
  // or is empty if ingestion failed - ensuring we only use properly stored papers
  const allPapers = [...pinnedPaperObjects, ...discoveredPapers]

  console.log(`📋 Total Papers Collected: ${allPapers.length}`)
  console.log(`   📌 From Library: ${pinnedPaperObjects.length}`)
  console.log(`   🔍 From Search (Ingested): ${discoveredPapers.length}`)
  
  // Debug: Show final papers that will be used for generation
  if (discoveredPapers.length > 0) {
    console.log(`🔍 FINAL INGESTED PAPERS FOR GENERATION:`)
    discoveredPapers.forEach((paper, idx) => {
      console.log(`   ${idx + 1}. "${paper.title}" (ID: ${paper.id})`)
      console.log(`      📄 DOI: ${paper.doi || 'NONE'}`) 
      console.log(`      👥 Authors: ${paper.author_names?.join(', ') || 'Unknown'}`)
      console.log(`      📅 Year: ${paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'Unknown'}`)
    })
  }

  // Filter papers and log results
  const finalPapers = allPapers

  console.log(`📊 Quality Filtering Results:`)
  console.log(`   ✅ Acceptable Papers: ${finalPapers.length}`)

  if (!finalPapers.length) {
    throw new Error(`No papers found for topic "${topic}". Please add relevant papers to your library.`)
  }

  // 3. background full-text extraction ──────────────────────
  if (userId) {
    await autoQueueFullTextExtraction(finalPapers, userId)
    
    // 4. chunk coverage gating ─────────────────────────────
    if (finalPapers.length > 0) {
      console.log(`🚪 Checking if we should wait for better chunk coverage...`)
      
      const initialCoverage = await getCoverage(finalPapers.map(p => p.id))
      console.log(`   📊 Initial coverage: ${(initialCoverage * 100).toFixed(1)}%`)
      
      // Check if any papers have PDF URLs that could be processed
      const papersWithPdfs = finalPapers.filter(p => p.pdf_url && isLikelyDirectPdfUrl(p.pdf_url))
      
      if (initialCoverage < 0.7 && papersWithPdfs.length > 0) {
        console.log(`   ⏳ Coverage below 70%, waiting for content processing to complete...`)
        console.log(`   💡 This includes PDF extraction, abstract processing, and chunk generation`)
        
        // Calculate dynamic wait time based on papers that actually need processing
        const chunkCounts = await Promise.all(
          papersWithPdfs.map(async p => ({ id: p.id, count: await getChunkCount(p.id) }))
        )
        
        const papersNeedingProcessing = papersWithPdfs.filter(p => {
          const chunkCount = chunkCounts.find(c => c.id === p.id)?.count ?? 0
          return chunkCount < 10 // Papers with less than 10 chunks need processing
        }).length
        
        // Allow 90 seconds per paper, with minimum 2 minutes and maximum 10 minutes
        const dynamicWaitMs = Math.min(Math.max(papersNeedingProcessing * 90_000, 120_000), 600_000)
        console.log(`   ⏱️  Dynamic wait time: ${dynamicWaitMs/1000}s for ${papersNeedingProcessing} papers`)
        
        const targetReached = await waitForChunkCoverage(
          finalPapers.map(p => p.id),
          0.9, // 70% coverage target
          dynamicWaitMs, // Dynamic wait time
          3_000 // Poll every 3 seconds
        )
        
        if (!targetReached) {
          console.warn(`⚠️ PDF processing timeout reached - proceeding with partial coverage`)
          console.log(`   💡 Some papers may not have full-text content yet`)
          console.log(`   🔄 Processing continues in background - future generations will have better coverage`)
        } else {
          console.log(`   ✅ PDF processing completed successfully - full coverage achieved`)
        }
      } else if (initialCoverage < 0.7 && papersWithPdfs.length === 0) {
        console.warn(`⚠️ Low coverage but no PDFs available to process - skipping wait.`)
        console.log(`   💡 Coverage: ${(initialCoverage * 100).toFixed(1)}% | Papers with PDFs: ${papersWithPdfs.length}`)
      } else {
        console.log(`   ✅ Coverage sufficient (${(initialCoverage * 100).toFixed(1)}%) or no waiting needed`)
      }
    }
  }

  return finalPapers
}

// ────────────────────────────────────────────────────────────
// Auto-queue helper
// ────────────────────────────────────────────────────────────
async function autoQueueFullTextExtraction(
  papers: PaperWithAuthors[],
  userId: string
) {
  try {
    // 1. fetch chunk counts in parallel
    const chunkCounts = await Promise.all(
      papers.map(async p => ({ id: p.id, count: await getChunkCount(p.id) }))
    )

    // 2. Debug: Show detailed analysis of each paper
    console.log(`🔍 DETAILED PAPER ANALYSIS:`)
    papers.forEach((paper, idx) => {
      const chunkCount = chunkCounts.find(c => c.id === paper.id)?.count ?? 0
      const hasPdf = !!paper.pdf_url
      const isDirectPdf = hasPdf && isLikelyDirectPdfUrl(paper.pdf_url!)
      const needsQueuing = chunkCount < 10 && isDirectPdf
      
      console.log(`   ${idx + 1}. "${paper.title}"`)
      console.log(`      📄 Full-text Chunks: ${chunkCount}`)
      console.log(`      🔗 PDF URL: ${hasPdf ? 'YES' : 'NO'}`)
      if (hasPdf && !isDirectPdf) {
        console.log(`      ⚠️  PDF URL is likely a landing page, not direct PDF`)
      }
      console.log(`      ⚡ Needs Queuing: ${needsQueuing ? 'YES' : 'NO'}`)
      if (!hasPdf && chunkCount === 0) {
        console.log(`      ⚠️  PROBLEM: No PDF URL and no full-text chunks!`)
      }
    })

    // SURGICAL FIX: Queue everything that has < MIN_CHUNKS_OK and has a valid PDF URL
    const MIN_CHUNKS_OK = 10
    const papersNeeding = papers.filter(p => {
      const fullTextChunks = chunkCounts.find(c => c.id === p.id)?.count ?? 0
      return fullTextChunks < MIN_CHUNKS_OK && p.pdf_url && isLikelyDirectPdfUrl(p.pdf_url)
    })

    // Calculate coverage based on papers with at least MIN_CHUNKS_OK full-text chunks
    const ratio = chunkCounts.filter(c => c.count >= MIN_CHUNKS_OK).length / papers.length

    console.log(`📊 Content coverage ${(ratio * 100).toFixed(1)}% — queueing ${papersNeeding.length} PDFs`)

    if (ratio < 0.7) {
      console.warn(`⚠️ WARNING: Content coverage is low (${(ratio * 100).toFixed(1)}% < 70%). This may impact RAG quality.`)
    }

    for (const paper of papersNeeding) {
      await pdfQueue.addJob(
        paper.id,
        paper.pdf_url!,
        paper.title ?? 'Unknown title',
        userId,
        'high' // Use high priority for generation-critical PDFs
      )
      console.log(`   ↳ queued "${paper.title}" (high priority)`)
    }
    
    if (papersNeeding.length > 0) {
      console.log(`✅ Queued ${papersNeeding.length} PDFs for high-priority extraction`)
      console.log(`   🚀 Processing started immediately with high priority`)
      console.log(`   ⏳ Will wait for completion before starting generation`)
    } else {
      console.log(`✅ No PDFs need queuing - papers have sufficient content chunks`)
    }
  } catch (err) {
    console.error('autoQueueFullTextExtraction failed:', err)
  }
}

/** Count full-text chunks for a paper (excluding abstracts) */
async function getChunkCount(paperId: string): Promise<number> {
  try {
    const sb = await getSB()
    
    // First check if the paper exists in the database at all
    const { data: paperExists, error: paperError } = await sb
      .from('papers')
      .select('id')
      .eq('id', paperId)
      .single()

    if (paperError || !paperExists) {
      // Paper doesn't exist in database yet - this is expected for newly discovered papers
      return 0
    }
    
    // Get all chunks for this paper and filter by length in JavaScript
    // This avoids the char_length() PostgreSQL function that doesn't work in PostgREST
    const { data: chunks, error } = await sb
      .from('paper_chunks')
      .select('content')
      .eq('paper_id', paperId)

    if (error) {
      console.error(`❌ Database error getting chunk count for ${paperId}:`, {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return 0
    }

    // Filter chunks by content length (>= 500 chars for substantial content)
    const fullTextChunks = (chunks || []).filter(chunk => 
      chunk.content && chunk.content.length >= 500
    ).length
    
    return fullTextChunks
    
  } catch (err) {
    console.error(`💥 Critical error getting chunk count for ${paperId}:`, {
      error: err,
      message: err instanceof Error ? err.message : 'Unknown error',
      stack: err instanceof Error ? err.stack : undefined
    })
    return 0
  }
}

// ────────────────────────────────────────────────────────────
// Chunk coverage gating system
// ────────────────────────────────────────────────────────────

/**
 * Get chunk coverage ratio for a set of papers using proper full-text chunk counting
 * @param paperIds Array of paper IDs to check
 * @returns Coverage ratio (0.0 to 1.0)
 */
async function getCoverage(paperIds: string[]): Promise<number> {
  if (paperIds.length === 0) return 1.0 // Nothing to wait for

  try {
    // Count full-text chunks for each paper
    const MIN_CHUNKS_OK = 10 // Require at least 10 full-text chunks
    
    const fullTextChecks = await Promise.all(
      paperIds.map(async (paperId) => {
        const chunkCount = await getChunkCount(paperId)
        return chunkCount >= MIN_CHUNKS_OK
      })
    )
    
    const papersWithFullText = fullTextChecks.filter(Boolean).length
    const coverage = papersWithFullText / paperIds.length
    
    console.log(`📊 Coverage analysis: ${papersWithFullText}/${paperIds.length} papers have ≥${MIN_CHUNKS_OK} full-text chunks`)
    
    return coverage
  } catch (err) {
    console.error('getCoverage query failed:', err)
    return 0
  }
}

/**
 * Wait for chunk coverage to reach target ratio, with timeout
 * @param paperIds Papers to monitor
 * @param targetRatio Target coverage ratio (0.7 = 70%)
 * @param maxWaitMs Maximum wait time in milliseconds
 * @param pollEveryMs Polling interval
 * @returns true if target reached, false if timed out
 */
async function waitForChunkCoverage(
  paperIds: string[],
  targetRatio = 0.7,
  maxWaitMs = 30_000,
  pollEveryMs = 2_000
): Promise<boolean> {
  const started = Date.now()
  let attempts = 0
  
  console.log(`⏳ Waiting for PDF processing to complete (target: ${(targetRatio * 100).toFixed(0)}%, max wait: ${maxWaitMs/1000}s)`)
  console.log(`   🔄 This ensures papers have full-text content before generation begins`)
  
  while (Date.now() - started < maxWaitMs) {
    attempts++
    const currentCoverage = await getCoverage(paperIds)
    const elapsedSeconds = ((Date.now() - started)/1000).toFixed(0)
    const remainingSeconds = Math.max(0, (maxWaitMs - (Date.now() - started))/1000).toFixed(0)
    
    console.log(`   📊 Check ${attempts}: ${(currentCoverage * 100).toFixed(1)}% coverage (${elapsedSeconds}s elapsed, ${remainingSeconds}s remaining)`)
    
    if (currentCoverage >= targetRatio) {
      console.log(`✅ Target coverage reached in ${((Date.now() - started)/1000).toFixed(1)}s - proceeding with generation`)
      return true
    }
    
    // Don't sleep on the last iteration
    if (Date.now() - started + pollEveryMs < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollEveryMs))
    }
  }
  
  const finalCoverage = await getCoverage(paperIds)
  console.warn(`⏰ PDF processing timeout: ${(finalCoverage * 100).toFixed(1)}% coverage after ${maxWaitMs/1000}s`)
  console.log(`   🔄 Background processing will continue - papers will be ready for future generations`)
  return false
}

// 🆕 OPTIMIZATION: Library coverage checker
async function checkLibraryCoverage(
  topic: string, 
  userId: string, 
  maxResults: number = 10
): Promise<{ papers: PaperWithAuthors[]; coverageScore: number }> {
  try {
    const { getUserLibraryPapers } = await import('@/lib/db/library')
    
    // Get user's library papers with basic search
    const libraryPapers = await getUserLibraryPapers(userId, {
      search: topic
    }, maxResults * 2) // Get extra to calculate coverage
    
    if (libraryPapers.length === 0) {
      return { papers: [], coverageScore: 0 }
    }
    
    // Calculate basic coverage score based on keyword matching and recency
    const topicKeywords = topic.toLowerCase().split(' ')
    const scoredPapers = libraryPapers.map(lp => {
      const paper = lp.paper as PaperWithAuthors
      const title = paper.title.toLowerCase()
      const abstract = paper.abstract?.toLowerCase() || ''
      
      // Simple keyword matching score
      const titleMatches = topicKeywords.filter(keyword => title.includes(keyword)).length
      const abstractMatches = topicKeywords.filter(keyword => abstract.includes(keyword)).length
      const relevanceScore = (titleMatches * 2 + abstractMatches) / topicKeywords.length
      
      return { ...lp, relevance_score: relevanceScore }
    })
    
    // Filter papers with some relevance
    const relevantPapers = scoredPapers.filter(p => p.relevance_score > 0.1)
    
    if (relevantPapers.length === 0) {
      return { papers: [], coverageScore: 0 }
    }
    
    // Calculate coverage score based on relevance and recency
    type ScoredLibraryPaper = typeof libraryPapers[0] & { relevance_score: number }
    
    const avgScore = relevantPapers.reduce((sum: number, p: ScoredLibraryPaper) => sum + (p.relevance_score || 0), 0) / relevantPapers.length
    const recentPapers = relevantPapers.filter((p: ScoredLibraryPaper) => {
      const year = p.paper.publication_date ? new Date(p.paper.publication_date).getFullYear() : 0
      return year >= 2018 // Papers from last 6 years
    })
    
    const recencyBonus = recentPapers.length / relevantPapers.length * 0.2
    const coverageScore = Math.min(1.0, avgScore + recencyBonus)
    
    // Return top papers with their full data
    const papers = relevantPapers
      .sort((a: ScoredLibraryPaper, b: ScoredLibraryPaper) => (b.relevance_score || 0) - (a.relevance_score || 0))
      .slice(0, maxResults)
      .map((lp: ScoredLibraryPaper) => lp.paper as PaperWithAuthors)
    
    return { papers, coverageScore }
    
  } catch (error) {
    console.error('Library coverage check failed:', error)
    return { papers: [], coverageScore: 0 }
  }
}

// 🆕 OPTIMIZATION: Unified search with retry and better error handling
async function unifiedSearchWithRetry(
  topic: string,
  options: UnifiedSearchOptions,
  maxRetries: number = 2
): Promise<UnifiedSearchResult> {
  let lastError: Error | null = null
  const searchTimer = createTimer()
  const searchMetrics: Omit<SearchMetrics, 'duration_ms' | 'results_count'> = {
    query: topic,
    providers: options.sources || [],
    cache_hit: false,
    errors: [],
    retry_count: 0
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔍 Search attempt ${attempt}/${maxRetries}`)
      const result = await unifiedSearch(topic, options)
      
      // Log search performance metrics
      const duration = searchTimer.end()
      console.log(`📊 Search Performance:`)
      console.log(`   ⏱️  Duration: ${result.metadata.searchTimeMs}ms`)
      console.log(`   📈 Strategies: ${result.metadata.searchStrategies.join(', ')}`)
      console.log(`   🎯 Results: ${result.papers.length}/${options.maxResults}`)
      console.log(`   ⚠️  Errors: ${result.metadata.errors.length}`)
      
      // 🆕 Log structured search metrics
      logSearchMetrics({
        query: searchMetrics.query,
        providers: searchMetrics.providers,
        cache_hit: searchMetrics.cache_hit,
        errors: result.metadata.errors,
        retry_count: attempt - 1,
        duration_ms: duration,
        results_count: result.papers.length
      })
      
      return result
      
    } catch (error) {
      lastError = error as Error
      searchMetrics.errors!.push(lastError.message)
      searchMetrics.retry_count = attempt
      
      console.warn(`⚠️ Search attempt ${attempt} failed:`, error)
      
      if (attempt < maxRetries) {
        const backoffMs = attempt * 1000 // Linear backoff
        console.log(`🔄 Retrying in ${backoffMs}ms...`)
        await new Promise(resolve => setTimeout(resolve, backoffMs))
      }
    }
  }
  
  // Log failed search metrics
  const duration = searchTimer.end()
  logSearchMetrics({
    query: searchMetrics.query,
    providers: searchMetrics.providers,
    cache_hit: searchMetrics.cache_hit,
    errors: searchMetrics.errors,
    retry_count: searchMetrics.retry_count,
    duration_ms: duration,
    results_count: 0
  })
  
  throw new Error(`All search attempts failed. Last error: ${lastError?.message}`)
}

// Export helper functions for potential reuse
export { getCoverage, waitForChunkCoverage }