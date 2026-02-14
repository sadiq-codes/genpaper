import { createServiceClient } from '@/lib/supabase/service'
import { getPapersByIds as getLibraryPapersByIds } from '@/lib/db/library'
import type { EnhancedGenerationOptions } from './types'
import { isDirectPdfUrl, isLandingPageUrl } from '@/lib/config/pdf-domains'
import pLimit from 'p-limit'

// Helper function to check if URL is likely a direct PDF or open access article
// Uses centralized domain lists from lib/config/pdf-domains.ts
function isLikelyDirectPdfUrl(url: string): boolean {
  if (!url) return false
  
  // Check if it's a known landing page (using central config)
  if (isLandingPageUrl(url)) {
    return false
  }
  
  // Check if it's a direct PDF (using central config)
  return isDirectPdfUrl(url)
}
import type { PaperWithAuthors, PaperSource, OriginalResearchConfig } from '@/types/simplified'
import type { UnifiedSearchOptions } from '@/lib/services/search-orchestrator'
import { unifiedSearch } from '@/lib/search'
import { buildEnhancedSearchQueries } from '@/lib/search/query-rewrite'

// Removed policy dependency - simplified ingestion logic

// Main entry ────────────────────────────────────────────────
export async function collectPapers(
  options: EnhancedGenerationOptions
): Promise<PaperWithAuthors[]> {

  const { topic, libraryPaperIds = [], useLibraryOnly, config, userId: _userId, discipline } = options
  
  console.log(`📋 Generation Request:`)
  console.log(`   🎯 Topic: "${topic}"`)
  console.log(`   📚 Pinned Library Papers: ${libraryPaperIds.length}`)
  console.log(`   🔒 Library Only Mode: ${useLibraryOnly}`)
  console.log(`   ⚙️ Target Limit: ${config?.limit || 10}`)
  
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
  
  // Hard-stop if useLibraryOnly=true and no pinned papers found
  if (useLibraryOnly && pinnedPapers.length === 0) {
    throw new Error('No papers found in library. Cannot proceed with library-only mode when no papers are pinned.')
  }

  const pinnedIds = pinnedPapers.map(lp => lp.paper.id)
  const targetTotal = config?.limit || 90
  const remainingSlots = Math.max(0, targetTotal - pinnedPapers.length)
  
  console.log(`🔍 Search Parameters:`)
  console.log(`   📊 Target Total Papers: ${targetTotal}`)
  console.log(`   🎯 Remaining Search Slots: ${remainingSlots}`)

  // Search for papers using external APIs
  let discoveredPapers: PaperWithAuthors[] = []
  
  if (!useLibraryOnly && remainingSlots > 0) {
    console.log(`🔍 Searching for papers via external APIs...`)
    
    // Get original research context if available
    const originalResearch = config?.original_research as OriginalResearchConfig | undefined
    const hasOriginalResearch = originalResearch?.has_original_research
    
    try {
      // Build enhanced search queries if user has original research
      let searchQueries: string[] = [topic]
      
      if (hasOriginalResearch && originalResearch?.key_findings) {
        console.log(`🧪 Original research detected - building enhanced search queries...`)
        searchQueries = await buildEnhancedSearchQueries(topic, {
          researchQuestion: originalResearch.research_question,
          keyFindings: originalResearch.key_findings,
        }, discipline)
        console.log(`   📋 Generated ${searchQueries.length} search queries:`)
        searchQueries.forEach((q, i) => console.log(`      ${i + 1}. "${q.slice(0, 80)}${q.length > 80 ? '...' : ''}"`))
      }
      
      // Adjust recency weight and search window based on profile
      // If explicit searchYearRange is provided by the AI, use it directly
      // Otherwise, fall back to recencyProfile-based defaults
      const recencyProfile = options.recencyProfile
      const searchYearRange = options.searchYearRange
      let recencyWeight = 0.1  // default balanced
      let authorityWeight = 0.5
      let fromYear: number
      let toYear = new Date().getFullYear()
      
      // Use explicit AI-determined year range if available
      if (searchYearRange?.fromYear && searchYearRange?.toYear) {
        fromYear = searchYearRange.fromYear
        toYear = searchYearRange.toYear
        console.log(`📅 AI-determined search range: ${fromYear}-${toYear}`)
        console.log(`   📝 Rationale: ${searchYearRange.rationale}`)
        
        // Adjust weights based on the year range span
        const yearSpan = toYear - fromYear
        if (yearSpan <= 10) {
          // Narrow window = cutting-edge field, prioritize recency
          recencyWeight = 0.35
          authorityWeight = 0.3
        } else if (yearSpan >= 30) {
          // Wide window = foundational-heavy, prioritize authority
          recencyWeight = 0.05
          authorityWeight = 0.6
        }
        // Otherwise keep balanced weights
      } else if (recencyProfile === 'cutting-edge') {
        recencyWeight = 0.35
        authorityWeight = 0.3
        fromYear = new Date().getFullYear() - 10  // Last 10 years for fast-moving fields
        console.log(`📅 Recency profile: cutting-edge - prioritizing recent papers (from ${fromYear})`)
      } else if (recencyProfile === 'foundational-heavy') {
        recencyWeight = 0.05
        authorityWeight = 0.6
        fromYear = 1980  // Include older foundational works
        console.log(`📅 Recency profile: foundational-heavy - including older foundational papers (from ${fromYear})`)
      } else {
        fromYear = 2000  // Balanced - last ~25 years
        console.log(`📅 Recency profile: balanced - standard time window (from ${fromYear})`)
      }
      
      const searchOptions: UnifiedSearchOptions = {
        maxResults: remainingSlots,
        minResults: Math.min(5, remainingSlots),
        excludePaperIds: pinnedIds,
        fromYear,  // Now dynamic based on AI-determined year range or recency profile
        toYear,    // End year (usually current year, but AI can specify otherwise)
        localRegion: config?.localRegion,
        sources: (config?.sources as PaperSource[])
                  ?? ['europe_pmc', 'pubmed_central', 'openalex', 'core', 'arxiv', 'crossref', 'semantic_scholar'],
        semanticWeight: 0.4,
        authorityWeight,
        recencyWeight,
        discipline  // Pass discipline for API-level filtering
      }
      
      if (discipline) {
        console.log(`🎓 Discipline filter: ${discipline}`)
      }
      
      // Search with phased query caps to avoid source-overload storms.
      const allPaperIds = new Set<string>()
      const allPapers: PaperWithAuthors[] = []
      const QUERY_PHASE_SIZES = [1, 2, 3] // Remaining queries after these phases are skipped.
      const QUERY_PHASE_CONCURRENCY = 2
      const limit = pLimit(QUERY_PHASE_CONCURRENCY)
      let queryCursor = 0

      for (let phaseIndex = 0; phaseIndex < QUERY_PHASE_SIZES.length; phaseIndex++) {
        if (allPapers.length >= remainingSlots || queryCursor >= searchQueries.length) break

        const take = QUERY_PHASE_SIZES[phaseIndex]
        const phaseQueries = searchQueries.slice(queryCursor, queryCursor + take)
        queryCursor += phaseQueries.length
        if (phaseQueries.length === 0) continue

        const slotsLeft = Math.max(0, remainingSlots - allPapers.length)
        const perQueryMax = Math.max(5, Math.ceil(slotsLeft / phaseQueries.length) + 4)
        console.log(`🔍 Discovery phase ${phaseIndex + 1}: ${phaseQueries.length} query(ies), per-query cap ${perQueryMax}`)

        const phaseResults = await Promise.allSettled(
          phaseQueries.map(query => limit(async () => {
            const queryOptions = { ...searchOptions, maxResults: perQueryMax }
            console.log(`🔎 Searching: "${query.slice(0, 60)}${query.length > 60 ? '...' : ''}"`)
            const searchResult = await unifiedSearch(query, queryOptions)
            return { query, searchResult }
          }))
        )

        for (const result of phaseResults) {
          if (result.status === 'rejected') {
            console.warn(`   ⚠️ Query failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
            continue
          }

          const { query, searchResult } = result.value
          if (searchResult.metadata.errors.length > 0) {
            console.warn(`   ⚠️ Query warnings for "${query.slice(0, 40)}${query.length > 40 ? '...' : ''}": ${searchResult.metadata.errors.join(', ')}`)
          }

          for (const paper of searchResult.papers as PaperWithAuthors[]) {
            if (!allPaperIds.has(paper.id)) {
              allPaperIds.add(paper.id)
              allPapers.push(paper)
            }
          }
        }

        console.log(`   📚 Discovery phase ${phaseIndex + 1} yielded ${allPapers.length} unique papers so far`)
      }

      if (allPapers.length >= remainingSlots) {
        console.log(`   ✅ Reached target paper count (${allPapers.length})`)
      }
      
      discoveredPapers = allPapers.slice(0, remainingSlots)
      console.log(`🎯 External search results: ${discoveredPapers.length} unique papers found`)

    } catch (err) {
      console.error('External search failed:', err)
      discoveredPapers = []
    }

    // Note: unifiedSearch already performs ingestion via searchAndIngestPapers.
    // Avoid re-ingesting here to prevent duplicate writes and queueing.
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

  // 3. final coverage check ─────────────────────────────── 
  if (finalPapers.length > 0) {
      console.log(`🚪 Checking if we should wait for better chunk coverage...`)
      
      const initialCoverage = await getCoverage(finalPapers.map(p => p.id))
      console.log(`   📊 Initial coverage: ${(initialCoverage * 100).toFixed(1)}%`)
      
      // Check if any papers have PDF URLs that could be processed
      const papersWithPdfs = finalPapers.filter(p => p.pdf_url && isLikelyDirectPdfUrl(p.pdf_url))
      
      // Since PDF processing is now synchronous during ingestion, just log the final coverage
      console.log(`   📊 Final coverage check after ingestion: ${(initialCoverage * 100).toFixed(1)}%`)
      
      if (initialCoverage < 0.7) {
        console.warn(`⚠️ Content coverage is low (${(initialCoverage * 100).toFixed(1)}% < 70%). This may impact generation quality.`)
        if (papersWithPdfs.length === 0) {
          console.warn(`   💡 No PDFs were available for processing - content limited to abstracts`)
        } else {
          console.warn(`   💡 PDF processing was attempted but may have failed for some papers`)
        }
      } else {
        console.log(`   ✅ Good content coverage achieved - proceeding with generation`)
      }
    }

  return finalPapers
}



/** Count full-text chunks for a paper (excluding abstracts) */
async function getChunkCount(paperId: string): Promise<number> {
  try {
    // Use service client to bypass RLS - this runs in Inngest background jobs
    const sb = createServiceClient()
    
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
    const fullTextChunks = (chunks || []).filter((chunk: { content: string | null }) => 
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
    const MIN_CHUNKS_OK = 5 // Require at least 5 full-text chunks (lowered from 10 for better coverage)
    
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

// Removed library coverage optimization - simplified to direct external search

// Export helper functions for potential reuse
export { getCoverage, waitForChunkCoverage }