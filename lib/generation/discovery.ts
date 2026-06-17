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

function hasPdfUrl(paper: { pdf_url?: string | null }): boolean {
  return typeof paper.pdf_url === 'string' && paper.pdf_url.trim().length > 0
}

function countPapersWithPdf<T extends { pdf_url?: string | null }>(papers: T[]): number {
  return papers.reduce((count, paper) => count + (hasPdfUrl(paper) ? 1 : 0), 0)
}
import type { PaperWithAuthors, PaperSource, OriginalResearchConfig } from '@/types/simplified'
import type { UnifiedSearchOptions } from '@/lib/services/search-orchestrator'
import { unifiedSearch } from '@/lib/search'
import { buildEnhancedSearchQueries } from '@/lib/search/query-rewrite'
import { quickRelevanceCheck } from '@/lib/search/semantic-rerank'
import { translateTopicForSearch, translateKeyFindings, type TranslationResult } from '@/lib/search/query-translate'

function getPaperRelevanceScore(paper: PaperWithAuthors): number {
  const metadata = (paper.metadata || {}) as Record<string, unknown>
  const combined = typeof metadata.combined_score === 'number' ? metadata.combined_score : undefined
  const relevance = typeof metadata.relevance_score === 'number' ? metadata.relevance_score : undefined
  return combined ?? relevance ?? 0
}

function getPaperSelectionScore(paper: PaperWithAuthors): number {
  const relevanceScore = getPaperRelevanceScore(paper)
  const citationScore = Math.min(paper.citation_count || 0, 1000) / 1000
  const influentialRaw = typeof paper.metadata?.influential_citation_count === 'number'
    ? paper.metadata.influential_citation_count
    : 0
  const influentialScore = Math.min(influentialRaw, 300) / 300
  const parsedYear = paper.publication_date ? new Date(paper.publication_date).getFullYear() : 2000
  const publicationYear = Number.isFinite(parsedYear) ? parsedYear : 2000
  const recencyScore = Math.max(0, Math.min(1, (publicationYear - 2000) / 26))
  const metadataCompletenessScore =
    (paper.doi ? 0.05 : 0) +
    (paper.venue ? 0.03 : 0)

  return (
    (relevanceScore * 0.45) +
    (citationScore * 0.25) +
    (influentialScore * 0.1) +
    (recencyScore * 0.1) +
    metadataCompletenessScore
  )
}

// Removed policy dependency - simplified ingestion logic

/**
 * Result of paper collection including translation info
 */
export interface CollectPapersResult {
  papers: PaperWithAuthors[]
  /** Translation info if topic was translated for search */
  translation: TranslationResult | null
}

// Main entry ────────────────────────────────────────────────
export async function collectPapers(
  options: EnhancedGenerationOptions
): Promise<CollectPapersResult> {
  const throwIfCancelled = () => {
    if (options.signal?.aborted) {
      throw new Error('Run was cancelled')
    }
  }

  const RECOMMENDED_MIN_PDF_PAPERS = 16
  const SEARCH_OVERFETCH_FACTOR = 2

  const { topic, libraryPaperIds = [], useLibraryOnly, config, userId: _userId, discipline, signal } = options
  
  console.log(`📋 Generation Request:`)
  console.log(`   🎯 Topic: "${topic}"`)
  console.log(`   📚 Pinned Library Papers: ${libraryPaperIds.length}`)
  console.log(`   🔒 Library Only Mode: ${useLibraryOnly}`)
  console.log(`   ⚙️ Target Limit: ${config?.limit || 10}`)
  
  // 1. pinned papers
  throwIfCancelled()
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

  const pinnedPaperObjects = pinnedPapers.map(lp => lp.paper as PaperWithAuthors)
  const pinnedIds = pinnedPapers.map(lp => lp.paper.id)
  const pinnedPdfCount = countPapersWithPdf(pinnedPaperObjects)
  const targetTotal = config?.limit || 90
  const remainingSlots = Math.max(0, targetTotal - pinnedPapers.length)
  const remainingPdfSlots = Math.max(0, targetTotal - pinnedPdfCount)
  
  console.log(`🔍 Search Parameters:`)
  console.log(`   📊 Target Total Papers: ${targetTotal}`)
  console.log(`   🎯 Remaining Search Slots: ${remainingSlots}`)
  console.log(`   📄 Remaining PDF-backed Slots: ${remainingPdfSlots}`)

  // Search for papers using external APIs
  let discoveredPapers: PaperWithAuthors[] = []
  
  // Track translation result for passing to pipeline
  let translationResult: TranslationResult | null = null
  
  if (!useLibraryOnly && remainingPdfSlots > 0) {
    throwIfCancelled()
    console.log(`🔍 Searching for papers via external APIs...`)
    
    // Translate non-English topics for academic API search
    translationResult = await translateTopicForSearch(topic)
    const searchTopic = translationResult.searchTopic
    
    // Get original research context if available
    const originalResearch = config?.original_research as OriginalResearchConfig | undefined
    const hasOriginalResearch = originalResearch?.has_original_research
    
    // Translate key findings if they're in a non-English language
    let searchKeyFindings = originalResearch?.key_findings
    if (translationResult.wasTranslated && searchKeyFindings) {
      searchKeyFindings = await translateKeyFindings(searchKeyFindings, translationResult.outputLanguage)
    }
    
    try {
      // Build enhanced search queries if user has original research
      // Use translated topic for search queries
      let searchQueries: string[] = [searchTopic]
      
      if (hasOriginalResearch && searchKeyFindings) {
        console.log(`🧪 Original research detected - building enhanced search queries...`)
        searchQueries = await buildEnhancedSearchQueries(searchTopic, {
          researchQuestion: originalResearch.research_question,
          keyFindings: searchKeyFindings,
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
        maxResults: Math.max(remainingSlots, remainingPdfSlots * SEARCH_OVERFETCH_FACTOR),
        minResults: Math.min(5, Math.max(1, remainingPdfSlots)),
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
        throwIfCancelled()
        const pdfBackedCount = countPapersWithPdf(allPapers)
        if (pdfBackedCount >= remainingPdfSlots || queryCursor >= searchQueries.length) break

        const take = QUERY_PHASE_SIZES[phaseIndex]
        const phaseQueries = searchQueries.slice(queryCursor, queryCursor + take)
        queryCursor += phaseQueries.length
        if (phaseQueries.length === 0) continue

        const pdfSlotsLeft = Math.max(0, remainingPdfSlots - pdfBackedCount)
        const slotsLeft = Math.max(0, pdfSlotsLeft * SEARCH_OVERFETCH_FACTOR)
        const perQueryMax = Math.max(5, Math.ceil(slotsLeft / phaseQueries.length) + 4)
        console.log(`🔍 Discovery phase ${phaseIndex + 1}: ${phaseQueries.length} query(ies), per-query cap ${perQueryMax}`)

        const phaseResults = await Promise.allSettled(
          phaseQueries.map(query => limit(async () => {
            if (signal?.aborted) {
              throw new Error('Run was cancelled')
            }
            const queryOptions = {
              ...searchOptions,
              maxResults: perQueryMax,
            }
            console.log(`🔎 Searching: "${query.slice(0, 60)}${query.length > 60 ? '...' : ''}"`)
            const searchResult = await unifiedSearch(query, queryOptions)
            return { query, searchResult }
          }))
        )

        for (const result of phaseResults) {
          throwIfCancelled()
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

        const phasePdfCount = countPapersWithPdf(allPapers)
        console.log(`   📚 Discovery phase ${phaseIndex + 1} yielded ${allPapers.length} unique papers (${phasePdfCount} with PDF links)`)
      }

      while (queryCursor < searchQueries.length && countPapersWithPdf(allPapers) < remainingPdfSlots) {
        throwIfCancelled()
        const query = searchQueries[queryCursor++]!
        const missingPdf = Math.max(0, remainingPdfSlots - countPapersWithPdf(allPapers))
        const perQueryMax = Math.max(10, Math.min(80, missingPdf * SEARCH_OVERFETCH_FACTOR + 10))
        console.log(`🔁 Catch-up discovery query (${queryCursor}/${searchQueries.length}), per-query cap ${perQueryMax}`)

        try {
          throwIfCancelled()
          const queryOptions = {
            ...searchOptions,
            maxResults: perQueryMax,
          }
          console.log(`🔎 Searching: "${query.slice(0, 60)}${query.length > 60 ? '...' : ''}"`)
          const searchResult = await unifiedSearch(query, queryOptions)

          if (searchResult.metadata.errors.length > 0) {
            console.warn(`   ⚠️ Query warnings for "${query.slice(0, 40)}${query.length > 40 ? '...' : ''}": ${searchResult.metadata.errors.join(', ')}`)
          }

          for (const paper of searchResult.papers as PaperWithAuthors[]) {
            if (!allPaperIds.has(paper.id)) {
              allPaperIds.add(paper.id)
              allPapers.push(paper)
            }
          }
        } catch (error) {
          if (signal?.aborted || (error instanceof Error && error.message === 'Run was cancelled')) {
            throw error
          }
          console.warn(`   ⚠️ Catch-up query failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      const finalPdfCount = countPapersWithPdf(allPapers)
      if (finalPdfCount >= remainingPdfSlots) {
        console.log(`   ✅ Reached target PDF-backed paper count (${finalPdfCount})`)
      }

      const topicFilteredPapers = allPapers.filter((paper) =>
        quickRelevanceCheck(topic, paper.title, paper.abstract, discipline)
      )
      if (topicFilteredPapers.length > 0) {
        const dropped = allPapers.length - topicFilteredPapers.length
        if (dropped > 0) {
          console.log(`🎯 Final topic filter: dropped ${dropped}/${allPapers.length} broad-match papers before selection`)
        }
      } else {
        console.warn('⚠️ Final topic filter removed all discovered papers; keeping broad-match discovery results as fallback')
      }

      const rankedPdfCandidates = (topicFilteredPapers.length > 0 ? topicFilteredPapers : allPapers)
        .filter(hasPdfUrl)
        .sort((a, b) => getPaperSelectionScore(b) - getPaperSelectionScore(a))
      discoveredPapers = rankedPdfCandidates.slice(0, remainingPdfSlots)
      console.log(`🎯 External search results: ${discoveredPapers.length} PDF-backed papers selected`)

    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.message === 'Run was cancelled')) {
        throw err
      }
      console.error('External search failed:', err)
      discoveredPapers = []
    }

    // Note: search results are metadata-registered here (no heavy PDF ingestion).
    // Full-text/chunk upgrades are handled by the pipeline readiness phase.
  }

  // Combine pinned and discovered papers

  // discoveredPapers now contains metadata-registered papers from database
  // (canonical IDs exist, but full-text may still be pending).
  const allPapers = [...pinnedPaperObjects, ...discoveredPapers]

  console.log(`📋 Total Papers Collected: ${allPapers.length}`)
  console.log(`   📌 From Library: ${pinnedPaperObjects.length}`)
  console.log(`   🔍 From Search (Metadata Registered): ${discoveredPapers.length}`)
  
  // Debug: Show final papers that will be used for generation
  if (discoveredPapers.length > 0) {
    console.log(`🔍 FINAL DISCOVERED PAPERS FOR GENERATION:`)
    discoveredPapers.forEach((paper, idx) => {
      console.log(`   ${idx + 1}. "${paper.title}" (ID: ${paper.id})`)
      console.log(`      📄 DOI: ${paper.doi || 'NONE'}`) 
      console.log(`      👥 Authors: ${paper.author_names?.join(', ') || 'Unknown'}`)
      console.log(`      📅 Year: ${paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'Unknown'}`)
    })
  }

  // Enforce PDF-only generation inputs.
  const finalPapers = allPapers.filter(hasPdfUrl)
  const papersWithoutPdf = allPapers.length - finalPapers.length

  console.log(`📊 Quality Filtering Results:`)
  console.log(`   ✅ PDF-backed Papers: ${finalPapers.length}`)
  if (papersWithoutPdf > 0) {
    console.log(`   🚫 Excluded (no pdf_url): ${papersWithoutPdf}`)
  }

  const recommendedMinimum = Math.min(targetTotal, RECOMMENDED_MIN_PDF_PAPERS)
  if (finalPapers.length === 0) {
    throw new Error(`No papers with PDF URLs were found for topic "${topic}". Refine the topic or add PDF-backed papers to your library.`)
  }
  if (finalPapers.length < recommendedMinimum) {
    console.warn(
      `⚠️ Only ${finalPapers.length} PDF-backed papers were found (recommended: ${recommendedMinimum}). Proceeding with available papers.`
    )
  }

  // 3. final coverage check ─────────────────────────────── 
  if (finalPapers.length > 0) {
      throwIfCancelled()
      console.log(`🚪 Checking if we should wait for better chunk coverage...`)
      
      const initialCoverage = await getCoverage(finalPapers.map(p => p.id))
      console.log(`   📊 Initial coverage: ${(initialCoverage * 100).toFixed(1)}%`)
      
      // Check if any papers have PDF URLs that could be processed
      const papersWithPdfs = finalPapers.filter(p => p.pdf_url && isLikelyDirectPdfUrl(p.pdf_url))
      
      // Coverage can be low here because discovery is metadata-first.
      // The readiness gate later upgrades a targeted subset to full-text.
      console.log(`   📊 Coverage at discovery stage: ${(initialCoverage * 100).toFixed(1)}%`)
      
      if (initialCoverage < 0.7) {
        console.warn(`⚠️ Content coverage is low (${(initialCoverage * 100).toFixed(1)}% < 70%). This may impact generation quality.`)
        if (papersWithPdfs.length === 0) {
          console.warn(`   💡 No PDFs were available for processing - content limited to abstracts`)
        } else {
          console.warn(`   💡 Full-text upgrades will be attempted in the readiness phase`)
        }
      } else {
        console.log(`   ✅ Good content coverage achieved - proceeding with generation`)
      }
    }

  throwIfCancelled()
  return {
    papers: finalPapers,
    translation: translationResult
  }
}



// ────────────────────────────────────────────────────────────
// Chunk coverage gating system
// ────────────────────────────────────────────────────────────

const MIN_CHUNKS_OK = 5 // Require at least 5 full-text chunks

/**
 * Get chunk coverage ratio for a set of papers using a SINGLE batch query.
 * @param paperIds Array of paper IDs to check
 * @returns Coverage ratio (0.0 to 1.0)
 */
async function getCoverage(paperIds: string[]): Promise<number> {
  if (paperIds.length === 0) return 1.0

  try {
    const sb = createServiceClient()
    
    // Single query to get all chunks for all papers at once
    const { data: chunks, error } = await sb
      .from('paper_chunks')
      .select('paper_id, content')
      .in('paper_id', paperIds)

    if (error) {
      console.error('getCoverage batch query failed:', error.message)
      return 0
    }

    // Count chunks per paper (only those with substantial content)
    const chunkCounts = new Map<string, number>()
    for (const chunk of chunks || []) {
      if (chunk.content && chunk.content.length >= 500) {
        chunkCounts.set(chunk.paper_id, (chunkCounts.get(chunk.paper_id) || 0) + 1)
      }
    }

    // Count papers that meet the threshold
    let papersWithFullText = 0
    for (const paperId of paperIds) {
      if ((chunkCounts.get(paperId) || 0) >= MIN_CHUNKS_OK) {
        papersWithFullText++
      }
    }

    const coverage = papersWithFullText / paperIds.length
    console.log(`📊 Coverage: ${papersWithFullText}/${paperIds.length} papers have ≥${MIN_CHUNKS_OK} chunks`)
    
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
  pollEveryMs = 5_000
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