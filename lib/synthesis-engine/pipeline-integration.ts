/**
 * Pipeline Integration for Synthesis Engine
 * 
 * Provides functions to integrate the hybrid synthesis engine with
 * the existing generation pipeline.
 * 
 * Key integration points:
 * 1. extractThemesHybrid() - Extracts findings and analyzes patterns
 * 2. enrichAndBuildContexts() - Enriches outline sections with synthesis data
 * 
 * @module lib/synthesis-engine/pipeline-integration
 */

import 'server-only'
import pLimit from 'p-limit'
import { 
  getExtractionsService, 
  getPapersNeedingExtractionService
} from '@/lib/extraction/db-service'
import { analyzeFindings, type FindingWithPaper, type AnalysisResult } from '@/lib/analysis/cross-document'
import { ensurePaperContentReadyById } from '@/lib/services/paper-content-service'
import { enrichOutlineSections, type EnrichedSectionContext } from './outline-enricher'
import { buildConstraintsFromProfile } from './constraint-builder'
import type { StructuralConstraints } from './types'
import type { PaperProfile } from '@/lib/generation/paper-profile-types'
import type { PaperWithAuthors } from '@/types/simplified'
import type { GeneratedOutline } from '@/lib/prompts/types'
import { info, warn } from '@/lib/utils/logger'
import { MIN_FULL_TEXT_CHARS } from '@/lib/generation/paper-type-config'

// =============================================================================
// Types
// =============================================================================

export interface HybridThemeExtractionResult {
  analysisResult: AnalysisResult
  extractionStats: {
    papersProcessed: number
    papersExtracted: number
    papersFromCache: number
    totalFindings: number
    extractionTimeMs: number
  }
  // NEW: Pre-built structural constraints for plan builder
  structuralConstraints?: StructuralConstraints
}

// =============================================================================
// Main Integration Functions
// =============================================================================

/**
 * Extract themes using the hybrid approach
 * 
 * This replaces extractThemes() with:
 * 1. Extract structured findings from each paper
 * 2. Analyze findings across papers
 */
export async function extractThemesHybrid(
  papers: PaperWithAuthors[],
  topic: string,
  profile: PaperProfile,
  onProgress?: (message: string, details?: any) => void
): Promise<HybridThemeExtractionResult> {
  const startTime = Date.now()
  const paperIds = papers.map(p => p.id)
  
  onProgress?.('Reviewing sources...', { paperCount: papers.length })
  
  // Step 1: Check which papers need extraction
  const needsExtraction = await getPapersNeedingExtractionService(paperIds)
  const cachedPaperIds = paperIds.filter(id => !needsExtraction.includes(id))
  
  onProgress?.('Reviewing sources...', {
    cached: cachedPaperIds.length,
    needsExtraction: needsExtraction.length
  })
  
  // Step 2: Get cached extractions
  const cachedExtractions = await getExtractionsService(cachedPaperIds)
  
  // Step 3: Extract papers that need it (progressive, full-text only)
  const CONCURRENCY = 3
  const newExtractions: Map<string, any> = new Map()
  
  // Progressive extraction configuration (guardrailed early stopping)
  const PROGRESSIVE_CONFIG = {
    initialBatch: 20,
    incrementSize: 10,
    maxRounds: 4,
    coverageFloor: 20,
    stabilityPatternDelta: 2,
    stabilityContradictionDelta: 1,
    diversityMaxDominance: 0.3,
    failOpenCoverageThreshold: 0.4
  } as const

  const MIN_FULL_TEXT_LENGTH = MIN_FULL_TEXT_CHARS

  const stopwords = new Set([
    'the','and','or','of','to','in','for','on','with','by','at','from','as','an','a','is','are','was','were',
    'be','been','being','this','that','these','those','it','its','into','using','use','used','via','across'
  ])

  const normalizeText = (s: string) =>
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const tokenize = (s: string) =>
    normalizeText(s)
      .split(' ')
      .filter(t => t.length >= 4 && !stopwords.has(t))

  const isThemeCovered = (theme: string, haystack: string) => {
    const themeTokens = tokenize(theme)
    if (themeTokens.length === 0) return true
    const hay = normalizeText(haystack)
    // Require at least 2 meaningful tokens (or all if fewer)
    const required = Math.min(2, themeTokens.length)
    let hits = 0
    for (const t of themeTokens) {
      if (hay.includes(t)) hits++
      if (hits >= required) return true
    }
    return false
  }

  const getPaperRelevanceScore = (paper: PaperWithAuthors) => {
    const metaScore = typeof paper.metadata?.relevance_score === 'number' ? paper.metadata.relevance_score : undefined
    const directScore = typeof (paper as any).relevance_score === 'number' ? (paper as any).relevance_score : undefined
    return metaScore ?? directScore ?? 0
  }

  const getPaperYear = (paper: PaperWithAuthors) => {
    try {
      return paper.publication_date ? new Date(paper.publication_date).getFullYear() : undefined
    } catch {
      return undefined
    }
  }

  const getPdfContent = (paper: PaperWithAuthors) => ((paper as any).pdf_content as string) || ''

  const hasUsableFullText = (paper: PaperWithAuthors) => {
    const pdfContent = getPdfContent(paper)
    return pdfContent.length >= MIN_FULL_TEXT_LENGTH
  }

  const buildAllFindings = (): FindingWithPaper[] => {
    const allFindings: FindingWithPaper[] = []

    for (const [paperId, extraction] of cachedExtractions) {
      for (const finding of extraction.findings) {
        allFindings.push({
          ...finding,
          paperId,
          paperTitle: extraction.metadata.title,
          paperYear: extraction.metadata.year,
          paperDomain: extraction.metadata.domain
        })
      }
    }

    for (const [paperId, extraction] of newExtractions) {
      for (const finding of extraction.findings) {
        allFindings.push({
          ...finding,
          paperId,
          paperTitle: extraction.metadata.title,
          paperYear: extraction.metadata.year,
          paperDomain: extraction.metadata.domain
        })
      }
    }

    return allFindings
  }

  const computeSupportDominance = (analysis: AnalysisResult) => {
    const paperCounts = new Map<string, number>()
    let totalSupports = 0

    for (const p of analysis.patterns || []) {
      for (const sup of p.support?.papers || []) {
        const id = sup.paperId
        if (!id) continue
        paperCounts.set(id, (paperCounts.get(id) || 0) + 1)
        totalSupports++
      }
    }

    for (const c of analysis.contradictions || []) {
      for (const side of c.sides || []) {
        for (const sup of side.papers || []) {
          const id = sup.paperId
          if (!id) continue
          paperCounts.set(id, (paperCounts.get(id) || 0) + 1)
          totalSupports++
        }
      }
    }

    // Gaps only include "suggestedBy" paper IDs (not quotes), but still useful for diversity signals
    for (const g of analysis.gaps || []) {
      for (const id of g.suggestedBy || []) {
        if (!id) continue
        paperCounts.set(id, (paperCounts.get(id) || 0) + 1)
        totalSupports++
      }
    }

    let maxPaperCount = 0
    for (const v of paperCounts.values()) maxPaperCount = Math.max(maxPaperCount, v)
    const dominanceRatio = totalSupports > 0 ? maxPaperCount / totalSupports : 0
    return { dominanceRatio, totalSupports }
  }

  const shouldStopExtracting = (input: {
    extractedFullTextCount: number
    totalFullTextAvailable: number
    collectedPapers: number
    currentAnalysis: AnalysisResult
    previousAnalysis: AnalysisResult | null
    profile: PaperProfile
  }): { stop: boolean; reason: string } => {
    const {
      extractedFullTextCount,
      totalFullTextAvailable,
      collectedPapers,
      currentAnalysis,
      previousAnalysis,
      profile
    } = input

    // Guardrail 1: Coverage floor
    if (extractedFullTextCount < PROGRESSIVE_CONFIG.coverageFloor) {
      return { stop: false, reason: `Below coverage floor (need ≥${PROGRESSIVE_CONFIG.coverageFloor})` }
    }

    // Guardrail 5: Fail-open - if evidence-starved, do not stop early (extract all usable full-text)
    const coverageRatio = collectedPapers > 0 ? totalFullTextAvailable / collectedPapers : 0
    if (coverageRatio < PROGRESSIVE_CONFIG.failOpenCoverageThreshold) {
      if (extractedFullTextCount < totalFullTextAvailable) {
        return {
          stop: false,
          reason: `Fail-open: low full-text coverage (${(coverageRatio * 100).toFixed(0)}%), extracting all available`
        }
      }
    }

    // Guardrail 2: Stability check (need previous round to compare)
    if (!previousAnalysis) {
      return { stop: false, reason: 'Need 2 rounds for stability check' }
    }

    const patternDelta = (currentAnalysis.patterns?.length || 0) - (previousAnalysis.patterns?.length || 0)
    const contradictionDelta = (currentAnalysis.contradictions?.length || 0) - (previousAnalysis.contradictions?.length || 0)

    const isStable =
      patternDelta < PROGRESSIVE_CONFIG.stabilityPatternDelta &&
      contradictionDelta < PROGRESSIVE_CONFIG.stabilityContradictionDelta

    if (!isStable) {
      return { stop: false, reason: `Not stable: +${patternDelta} patterns, +${contradictionDelta} contradictions` }
    }

    // Guardrail 3: Theme coverage check (use patterns + contradictions + gaps text)
    const requiredThemes: string[] = (profile as any)?.coverage?.requiredThemes || []
    const analysisText =
      [
        ...(currentAnalysis.patterns || []).map(p => p.claim),
        ...(currentAnalysis.contradictions || []).map(c => c.description),
        ...(currentAnalysis.gaps || []).map(g => g.description)
      ].join(' ')

    const uncoveredThemes = requiredThemes.filter(theme => !isThemeCovered(theme, analysisText))
    if (uncoveredThemes.length > 0) {
      return { stop: false, reason: `Missing required themes: ${uncoveredThemes.join(', ')}` }
    }

    // Guardrail 4: Source diversity check
    const { dominanceRatio } = computeSupportDominance(currentAnalysis)
    if (dominanceRatio > PROGRESSIVE_CONFIG.diversityMaxDominance) {
      return {
        stop: false,
        reason: `Low diversity: one paper in ${(dominanceRatio * 100).toFixed(0)}% of supports`
      }
    }

    return {
      stop: true,
      reason: `All guardrails passed: ${extractedFullTextCount} full-text papers, stable, themes covered, diverse`
    }
  }

  if (needsExtraction.length > 0) {
    // Identify usable full-text papers (for fail-open + coverage decisions)
    const usableFullTextPapers = papers.filter(hasUsableFullText)
    const usableFullTextPaperIds = new Set(usableFullTextPapers.map(p => p.id))
    const totalFullTextAvailable = usableFullTextPapers.length
    const collectedPapers = papers.length
    const coverageRatio = collectedPapers > 0 ? totalFullTextAvailable / collectedPapers : 0

    // Only extract papers that (a) need extraction and (b) have usable full text
    const extractablePaperIds = needsExtraction.filter(id => usableFullTextPaperIds.has(id))

    // Track skip reasons for visibility (no LLM calls)
    const skippedCount = needsExtraction.length - extractablePaperIds.length
    if (skippedCount > 0) {
      info(
        {
          stage: 'extraction',
          step: 'eligible-filter',
          needsExtraction: needsExtraction.length,
          extractable: extractablePaperIds.length,
          skipped: skippedCount,
          minFullTextChars: MIN_FULL_TEXT_LENGTH
        },
        'Filtered extraction candidates to usable full-text only'
      )
    }

    if (extractablePaperIds.length > 0) {
      const limit = pLimit(CONCURRENCY)

      // Rank extractable papers by relevance + recency + content richness
      const ranked = extractablePaperIds
        .map(paperId => {
          const paper = papers.find(p => p.id === paperId)
          if (!paper) return null
          const pdfLen = getPdfContent(paper).length
          const score = getPaperRelevanceScore(paper)
          const year = getPaperYear(paper) || 0
          return { paperId, score, year, pdfLen }
        })
        .filter(Boolean) as Array<{ paperId: string; score: number; year: number; pdfLen: number }>

      ranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (b.year !== a.year) return b.year - a.year
        return b.pdfLen - a.pdfLen
      })

      const runExtractionBatch = async (batchPaperIds: string[], roundLabel: string) => {
        let completed = 0
        onProgress?.('Extracting key findings...', {
          round: roundLabel,
          batchSize: batchPaperIds.length,
          coverageRatio,
          totalFullTextAvailable
        })

        await Promise.all(
          batchPaperIds.map(paperId =>
            limit(async () => {
              try {
                await ensurePaperContentReadyById(paperId, {
                  skipStructuredExtraction: false,
                  waitForStructuredExtraction: true,
                })
                completed++
                onProgress?.('Extracting key findings...', { round: roundLabel })
              } catch (error) {
                console.warn(`Extraction failed for ${paperId}:`, error)
                completed++
              }
            })
          )
        )

        const refreshedExtractions = await getExtractionsService(batchPaperIds)
        for (const [paperId, extraction] of refreshedExtractions.entries()) {
          if (!cachedExtractions.has(paperId)) {
            newExtractions.set(paperId, extraction)
          }
        }
      }

      // Count cached extractions that correspond to usable full-text papers
      const cachedExtractedFullTextCount = Array.from(cachedExtractions.keys()).filter(id => usableFullTextPaperIds.has(id))
        .length

      // Fail-open path: if evidence coverage is low, extract ALL usable full-text (no early stopping)
      const failOpen = coverageRatio < PROGRESSIVE_CONFIG.failOpenCoverageThreshold

      let previousAnalysis: AnalysisResult | null = null
      let analysisResult: AnalysisResult | null = null

      if (failOpen) {
        const allIds = ranked.map(r => r.paperId)
        await runExtractionBatch(allIds, 'fail-open')

        const allFindings = buildAllFindings()
        onProgress?.('Connecting ideas across sources...', {
          mode: 'fail-open',
          totalFindings: allFindings.length
        })

        analysisResult = await analyzeFindings({
          projectId: 'pipeline',
          findings: allFindings,
          topic
        })
      } else {
        // Progressive rounds
        const totalRounds = PROGRESSIVE_CONFIG.maxRounds
        let cursor = 0
        let round = 0

        while (round < totalRounds && cursor < ranked.length) {
          round++
          const batchSize =
            round === 1 ? PROGRESSIVE_CONFIG.initialBatch : PROGRESSIVE_CONFIG.incrementSize

          const batch = ranked.slice(cursor, cursor + batchSize).map(r => r.paperId)
          cursor += batch.length

          await runExtractionBatch(batch, `round-${round}`)

          const allFindings = buildAllFindings()
          onProgress?.('Connecting ideas across sources...', {
            round,
            totalFindings: allFindings.length
          })

          const currentAnalysis = await analyzeFindings({
            projectId: 'pipeline',
            findings: allFindings,
            topic
          })

          analysisResult = currentAnalysis

          const extractedFullTextCount =
            cachedExtractedFullTextCount +
            Array.from(newExtractions.keys()).filter(id => usableFullTextPaperIds.has(id)).length

          const decision = shouldStopExtracting({
            extractedFullTextCount,
            totalFullTextAvailable,
            collectedPapers,
            currentAnalysis,
            previousAnalysis,
            profile
          })

          info(
            {
              stage: 'extraction',
              step: 'progressive-stop-check',
              round,
              extractedFullTextCount,
              totalFullTextAvailable,
              coverageRatio,
              decision
            },
            'Progressive extraction stop check'
          )

          if (decision.stop) {
            onProgress?.('Analysis complete', { round, extractedFullTextCount })
            break
          }

          previousAnalysis = currentAnalysis
        }
      }

      // If we ran progressive/fail-open, we already computed analysisResult.
      // Store it on the function scope by shadowing the later single-pass analysis.
      if (analysisResult) {
        // Step 4/5 will use this computed analysis result; skip recompute below.
        // We set a local variable name used later by returning early after building theme analysis.
        const allFindings = buildAllFindings()

        // Build structural constraints from profile
        const structuralConstraints = buildConstraintsFromProfile(profile)

        const extractionTimeMs = Date.now() - startTime

        onProgress?.('Research patterns mapped', {
          patterns: analysisResult.patterns.length,
          contradictions: analysisResult.contradictions.length,
          gaps: analysisResult.gaps.length,
          durationMs: extractionTimeMs
        })

        return {
          analysisResult,
          extractionStats: {
            papersProcessed: papers.length,
            papersExtracted: newExtractions.size,
            papersFromCache: cachedExtractions.size,
            totalFindings: allFindings.length,
            extractionTimeMs
          },
          structuralConstraints
        }
      }
    } else {
      onProgress?.('Using existing analysis...', {
        needsExtraction: needsExtraction.length,
        usableFullTextAvailable: totalFullTextAvailable,
        coverageRatio
      })
    }
  }
  
  // Step 4: Combine all extractions and build findings
  const allFindings: FindingWithPaper[] = buildAllFindings()
  
  onProgress?.('Connecting ideas across sources...')
  
  // Step 5: Run cross-document analysis
  const analysisResult = await analyzeFindings({
    projectId: 'pipeline',
    findings: allFindings,
    topic
  })
  
  // Build structural constraints from profile
  const structuralConstraints = buildConstraintsFromProfile(profile)
  
  const extractionTimeMs = Date.now() - startTime
  
  onProgress?.('Research patterns mapped', {
    patterns: analysisResult.patterns.length,
    contradictions: analysisResult.contradictions.length,
    gaps: analysisResult.gaps.length,
    durationMs: extractionTimeMs
  })
  
  return {
    analysisResult,
    extractionStats: {
      papersProcessed: papers.length,
      papersExtracted: newExtractions.size,
      papersFromCache: cachedExtractions.size,
      totalFindings: allFindings.length,
      extractionTimeMs
    },
    structuralConstraints
  }
}

// =============================================================================
// NEW: Enrichment Functions for Pipeline Integration
// =============================================================================

/**
 * Enrich outline sections with synthesis analysis and build contexts
 * 
 * This is the main integration point - it takes the outline and hybrid results
 * and produces enriched section contexts ready for the unified generator.
 */
export async function enrichAndBuildContexts(
  outline: GeneratedOutline,
  hybridResult: HybridThemeExtractionResult,
  profile: PaperProfile,
  papers: PaperWithAuthors[],
  topic: string
): Promise<EnrichedSectionContext[]> {
  const startTime = Date.now()
  
  info({
    outlineSections: outline.sections.length,
    patterns: hybridResult.analysisResult.patterns.length,
    contradictions: hybridResult.analysisResult.contradictions.length,
    gaps: hybridResult.analysisResult.gaps.length
  }, 'Starting outline enrichment')
  
  try {
    const enrichedContexts = await enrichOutlineSections(
      outline,
      hybridResult.analysisResult,
      profile,
      papers,
      topic
    )
    
    const enrichedCount = enrichedContexts.filter(c => c.hasSynthesisEnrichment).length
    
    info({
      totalSections: enrichedContexts.length,
      enrichedSections: enrichedCount,
      durationMs: Date.now() - startTime
    }, 'Outline enrichment returned contexts')
    
    return enrichedContexts
  } catch (error) {
    warn({ error }, 'Outline enrichment failed')
    throw error
  }
}

/**
 * Check if hybrid synthesis is available for a set of papers
 * Returns true if enough papers have extractions or can be extracted
 */
export async function canUseHybridSynthesis(
  paperIds: string[],
  minPapersWithExtractions: number = 3
): Promise<{ available: boolean; extractedCount: number; reason?: string }> {
  try {
    const needsExtraction = await getPapersNeedingExtractionService(paperIds)
    const extractedCount = paperIds.length - needsExtraction.length
    
    if (extractedCount >= minPapersWithExtractions) {
      return { available: true, extractedCount }
    }
    
    // Check if we can extract enough papers
    if (paperIds.length >= minPapersWithExtractions) {
      return { 
        available: true, 
        extractedCount,
        reason: `Will extract ${needsExtraction.length} papers on demand`
      }
    }
    
    return {
      available: false,
      extractedCount,
      reason: `Not enough papers (${paperIds.length}) for hybrid synthesis (minimum ${minPapersWithExtractions})`
    }
  } catch (error) {
    return {
      available: false,
      extractedCount: 0,
      reason: `Error checking extraction status: ${error}`
    }
  }
}
