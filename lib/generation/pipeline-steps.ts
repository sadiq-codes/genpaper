/**
 * Pipeline Steps for Background Generation Execution
 * 
 * This module exports individual phase functions that can be called
 * from separate persisted steps, allowing long-running paper generation
 * to work within Vercel's 60-second function timeout.
 * 
 * Each function is designed to:
 * 1. Complete within 60 seconds
 * 2. Be idempotent (safe to retry)
 * 3. Store/retrieve state from the database
 */

import 'server-only'
import { v4 as uuidv4 } from 'uuid'
import { collectPapers } from '@/lib/generation/discovery'
import { generatePaperProfile, buildProfileGuidanceForPrompt, scaleProfileOutlineForLength } from '@/lib/generation/paper-profile'
import { generateWithUnifiedTemplate, generateSectionBySubsections, type StructuredCitation } from '@/lib/generation/unified-generator'
import { GenerationContextService } from '@/lib/rag/generation-context'
import { sanitizeTopic } from '@/lib/utils/prompt-safety'
import { mergeAnalysisResultIntoProfile } from '@/lib/generation/theme-extraction'
import { enrichAndBuildContexts, type HybridThemeExtractionResult } from '@/lib/synthesis-engine/pipeline-integration'
import { 
  getExtractionsService, 
  getPapersNeedingExtractionService
} from '@/lib/extraction/db-service'
import {
  getPaperProcessingStatusMap,
  isChunkReadyStatus,
  isFullTextReadyStatus,
} from '@/lib/content'
import {
  analyzeFindings,
  getAnalysisReadinessIssue,
  isAnalysisReadyForSynthesis,
  type FindingWithPaper,
} from '@/lib/analysis/cross-document'
import { updateProjectContent, updateResearchProjectStatus } from '@/lib/db/research'
import { getServiceClient } from '@/lib/supabase/service'
import { info, warn } from '@/lib/utils/logger'
import pLimit from 'p-limit'
import { ensurePaperContentReadyById } from '@/lib/services/paper-content-service'

import type { PaperProfile } from '@/lib/generation/paper-profile-types'
import type { PaperWithAuthors, PaperStatus, PaperTypeKey as SimplifiedPaperTypeKey } from '@/types/simplified'
import type { GeneratedOutline, SectionContext } from '@/lib/prompts/types'
import type { EnhancedGenerationOptions } from '@/lib/generation/types'
import type { EnrichedSectionContext } from '@/lib/synthesis-engine/outline-enricher'
import type { PipelineConfig, CitationInstance } from '@/lib/generation/pipeline'
import { PAPER_TYPE_SEARCH_MULTIPLIERS, PAPER_TYPE_MIN_SEARCH } from '@/types/simplified'

// =============================================================================
// Types
// =============================================================================

export interface StepProgressCallback {
  (stage: string, progress: number, message: string, data?: Record<string, unknown>): Promise<void> | void
}

export interface SectionResult {
  sectionKey: string
  title: string
  content: string
  citations: StructuredCitation[]
  wordCount: number
}

export interface QualityIssue {
  sectionIndex: number
  issue: 'truncation'
  details?: string
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Run was cancelled')
  }
}

// =============================================================================
// Phase 1: Profile Generation
// =============================================================================

/**
 * Generate the paper profile which determines structure, sources, etc.
 * Estimated time: 10-30s (single LLM call)
 */
export async function runProfilePhase(
  config: PipelineConfig,
  onProgress?: StepProgressCallback,
  signal?: AbortSignal
): Promise<PaperProfile> {
  throwIfCancelled(signal)
  const sanitizedTopic = sanitizeTopic(config.topic)
  
  onProgress?.('profiling', 5, 'Understanding your research area...')
  
  const rawProfile = await generatePaperProfile({
    topic: sanitizedTopic,
    paperType: config.paperType,
    hasOriginalResearch: config.originalResearch?.has_original_research,
    userContext: config.customInstructions,
    length: config.length,
    researchQuestion: config.originalResearch?.research_question,
    keyFindings: config.originalResearch?.key_findings,
    signal,
  })
  throwIfCancelled(signal)
  const profile = scaleProfileOutlineForLength(rawProfile, config.length)
  
  info({
    discipline: profile.discipline.primary,
    sections: profile.structure.appropriateSections.map(s => s.key),
    minSources: profile.sourceExpectations.minimumUniqueSources,
  }, 'Paper profile generated')
  
  onProgress?.('profiling', 10, `Tailoring approach for ${profile.discipline.primary} research`)
  
  return profile
}

// =============================================================================
// Phase 2: Paper Discovery
// =============================================================================

/**
 * Discover and collect papers for the generation.
 * Estimated time: 30-60s (API calls to search services)
 */
export async function runDiscoveryPhase(
  config: PipelineConfig,
  profile: PaperProfile,
  projectId: string,
  userId: string,
  onProgress?: StepProgressCallback,
  signal?: AbortSignal
): Promise<PaperWithAuthors[]> {
  throwIfCancelled(signal)
  const sanitizedTopic = sanitizeTopic(config.topic)
  
  onProgress?.('search', 15, 'Searching academic databases...')
  
  const discoveryOptions: EnhancedGenerationOptions = {
    projectId,
    userId,
    topic: sanitizedTopic,
    paperType: config.paperType,
    libraryPaperIds: config.libraryPaperIds || [],
    sourceIds: config.libraryPaperIds || [],
    useLibraryOnly: config.useLibraryOnly || false,
    config: {
      temperature: config.temperature || 0.2,
      max_tokens: config.maxTokens || 16000,
      sources: config.sources || ['europe_pmc', 'pubmed_central', 'openalex', 'core', 'arxiv', 'crossref', 'semantic_scholar'],
      limit: (() => {
        const paperType = config.paperType as SimplifiedPaperTypeKey
        const searchMultiplier = PAPER_TYPE_SEARCH_MULTIPLIERS[paperType] ?? 2.5
        const minSearch = PAPER_TYPE_MIN_SEARCH[paperType] ?? 50
        const idealSourceCount = profile.sourceExpectations.idealSourceCount
        const calculatedLimit = Math.ceil(idealSourceCount * searchMultiplier)
        return Math.max(minSearch, calculatedLimit)
      })(),
      library_papers_used: config.libraryPaperIds || [],
      length: config.length,
      paperType: config.paperType,
      useLibraryOnly: config.useLibraryOnly || false,
      localRegion: undefined,
      original_research: config.originalResearch,
    },
    recencyProfile: profile.sourceExpectations.recencyProfile,
    searchYearRange: profile.sourceExpectations.searchYearRange,
    discipline: profile.discipline.primary,
    signal,
  }

  const papers = await collectPapers(discoveryOptions)
  throwIfCancelled(signal)
  
  if (papers.length === 0) {
    throw new Error('No papers found for the given topic')
  }
  
  onProgress?.('search', 22, `${papers.length} sources collected`)
  
  return papers
}

// =============================================================================
// Phase 3: Theme Extraction (Split into batches)
// =============================================================================

const EXTRACTION_BATCH_SIZE = 8 // Higher throughput while staying within step budget

/**
 * Early content readiness gate:
 * 1) Read explicit paper processing_status values
 * 2) Upgrade a bounded subset of papers to full-text until minimum target is met
 * 3) Return chunk-ready paper IDs for downstream analysis/writing
 */
export async function runContentReadinessPhase(
  topic: string,
  profile: PaperProfile,
  papers: PaperWithAuthors[],
  onProgress?: StepProgressCallback,
  signal?: AbortSignal
): Promise<{
  readyPaperIds: string[]
  fullTextReadyPaperIds: string[]
  targetFullTextReady: number
  upgradedToFullText: number
  rechunked: number
}> {
  throwIfCancelled(signal)
  const paperIds = papers.map(p => p.id)
  if (paperIds.length === 0) {
    throw new Error('No papers available for content readiness checks')
  }

  const paperById = new Map(papers.map(p => [p.id, p]))
  const minimumUniqueSources = Math.max(1, profile.sourceExpectations?.minimumUniqueSources || 8)
  const targetFullTextReady = Math.min(paperIds.length, minimumUniqueSources)

  onProgress?.('planning', 23, 'Preparing sources for deep reading...')

  let statusMap = await getPaperProcessingStatusMap(paperIds)
  throwIfCancelled(signal)

  const classify = () => {
    const readyPaperIds: string[] = []
    const fullTextReadyPaperIds: string[] = []
    const fullTextUpgradeCandidates: string[] = []

    for (const paperId of paperIds) {
      const status = statusMap.get(paperId)
      if (!status) continue

      if (isChunkReadyStatus(status)) {
        readyPaperIds.push(paperId)
      }
      if (isFullTextReadyStatus(status)) {
        fullTextReadyPaperIds.push(paperId)
      }
      const paper = paperById.get(paperId)
      const hasPdfUrl = !!(paper?.pdf_url && paper.pdf_url.trim().length > 0)
      if (!isFullTextReadyStatus(status) && hasPdfUrl) {
        fullTextUpgradeCandidates.push(paperId)
      }
    }

    return {
      readyPaperIds,
      fullTextReadyPaperIds,
      fullTextUpgradeCandidates,
    }
  }

  let { readyPaperIds, fullTextReadyPaperIds, fullTextUpgradeCandidates } = classify()

  const rechunked = 0

  const fullTextBeforeUpgrade = fullTextReadyPaperIds.length

  if (fullTextReadyPaperIds.length < targetFullTextReady && fullTextUpgradeCandidates.length > 0) {
    const sortedCandidates = [...fullTextUpgradeCandidates].sort((a, b) => {
      const aPaper = paperById.get(a)
      const bPaper = paperById.get(b)
      return scoreExtractionPriority(bPaper) - scoreExtractionPriority(aPaper)
    })

    let cursor = 0
    while (fullTextReadyPaperIds.length < targetFullTextReady && cursor < sortedCandidates.length) {
      throwIfCancelled(signal)
      const remainingNeeded = targetFullTextReady - fullTextReadyPaperIds.length
      const batchSize = Math.min(3, remainingNeeded, sortedCandidates.length - cursor)
      const batchIds = sortedCandidates.slice(cursor, cursor + batchSize)
      cursor += batchSize

      onProgress?.(
        'planning',
        24,
        'Reading full-text papers...'
      )

      await Promise.allSettled(
        batchIds.map(async paperId => {
          throwIfCancelled(signal)
          try {
            await ensurePaperContentReadyById(paperId, {
              searchQuery: topic,
              // Keep extraction ownership in the dedicated extraction phase.
              skipStructuredExtraction: true,
              signal,
            })
          } catch (err) {
            warn({ paperId, error: err }, 'Full-text upgrade failed')
          }
        })
      )

      statusMap = await getPaperProcessingStatusMap(paperIds)
      throwIfCancelled(signal)
      const afterUpgrade = classify()
      readyPaperIds = afterUpgrade.readyPaperIds
      fullTextReadyPaperIds = afterUpgrade.fullTextReadyPaperIds
    }
  }

  if (readyPaperIds.length === 0) {
    throw new Error('Content readiness failed: no chunk-ready papers available')
  }

  const upgradedToFullText = Math.max(0, fullTextReadyPaperIds.length - fullTextBeforeUpgrade)

  info(
    {
      papers: paperIds.length,
      readyWithChunks: readyPaperIds.length,
      fullTextReady: fullTextReadyPaperIds.length,
      targetFullTextReady,
      upgradedToFullText,
      rechunked,
    },
    'Content readiness complete'
  )

  onProgress?.(
    'planning',
    25,
    'Sources prepared'
  )

  return {
    readyPaperIds,
    fullTextReadyPaperIds,
    targetFullTextReady,
    upgradedToFullText,
    rechunked,
  }
}

function scoreExtractionPriority(paper: PaperWithAuthors | undefined): number {
  if (!paper) return 0
  const citationScore = Math.min((paper.citation_count || 0), 500) / 500
  const year = paper.publication_date ? new Date(paper.publication_date).getFullYear() : 1990
  const recencyScore = Math.max(0, Math.min(1, (year - 2000) / 26))
  const hasAbstract = paper.abstract && paper.abstract.trim().length > 200 ? 1 : 0
  return (citationScore * 0.5) + (recencyScore * 0.35) + (hasAbstract * 0.15)
}

/**
 * Check which papers need extraction and return batch info
 */
export async function runExtractionCheckPhase(
  paperIds: string[],
  papers: PaperWithAuthors[],
  onProgress?: StepProgressCallback,
  signal?: AbortSignal
): Promise<{
  cachedPaperIds: string[]
  pendingPaperIds: string[]
  totalBatches: number
}> {
  throwIfCancelled(signal)
  onProgress?.('planning', 25, 'Reviewing what we already know...')
  
  // Check which papers need extraction
  const needsExtraction = await getPapersNeedingExtractionService(paperIds)
  throwIfCancelled(signal)
  const cachedPaperIds = paperIds.filter(id => !needsExtraction.includes(id))
  
  // Filter to papers that are explicitly full-text ready in DB.
  // Do not infer from in-memory `papers[].pdf_content`, which can be metadata-only.
  const processingStatusMap = await getPaperProcessingStatusMap(needsExtraction)
  throwIfCancelled(signal)
  const usableFullTextIds = new Set(
    needsExtraction.filter(id => isFullTextReadyStatus(processingStatusMap.get(id) || 'pending'))
  )
  const papersById = new Map(papers.map(p => [p.id, p]))
  
  const extractablePaperIds = needsExtraction
    .filter(id => usableFullTextIds.has(id))
    .sort((a, b) => {
      const aPaper = papersById.get(a)
      const bPaper = papersById.get(b)
      return scoreExtractionPriority(bPaper) - scoreExtractionPriority(aPaper)
    })
  const totalBatches = Math.ceil(extractablePaperIds.length / EXTRACTION_BATCH_SIZE)
  
  info({
    cached: cachedPaperIds.length,
    needsExtraction: needsExtraction.length,
    extractable: extractablePaperIds.length,
    totalBatches
  }, 'Extraction check complete')
  
  onProgress?.('planning', 27, 'Reviewing sources...')
  
  return {
    cachedPaperIds,
    pendingPaperIds: extractablePaperIds,
    totalBatches
  }
}

/**
 * Extract findings from a batch of papers
 * Estimated time: 30-60s per batch (LLM calls)
 */
export async function runExtractionBatchPhase(
  batchIndex: number,
  pendingPaperIds: string[],
  onProgress?: StepProgressCallback,
  signal?: AbortSignal
): Promise<number> {
  throwIfCancelled(signal)
  const startIdx = batchIndex * EXTRACTION_BATCH_SIZE
  const endIdx = Math.min(startIdx + EXTRACTION_BATCH_SIZE, pendingPaperIds.length)
  const batchPaperIds = pendingPaperIds.slice(startIdx, endIdx)
  
  if (batchPaperIds.length === 0) {
    return 0
  }
  
  onProgress?.('planning', 28, 'Extracting key findings...')
  
  // Keep idempotency guarantees with a batched freshness check, then run extraction
  // at higher controlled concurrency for better throughput.
  const limit = pLimit(5)
  let extracted = 0
  let extractableNow = new Set<string>()

  try {
    const stillPending = await getPapersNeedingExtractionService(batchPaperIds)
    extractableNow = new Set(stillPending)
    throwIfCancelled(signal)
  } catch (err) {
    warn({ batchIndex, error: err }, 'Failed to refresh extraction status for batch; using original batch IDs')
    extractableNow = new Set(batchPaperIds)
  }
  
  await Promise.all(
    batchPaperIds.map(paperId =>
      limit(async () => {
        if (signal?.aborted) return
        if (!extractableNow.has(paperId)) return

        try {
          await ensurePaperContentReadyById(paperId, {
            skipStructuredExtraction: false,
            waitForStructuredExtraction: true,
            signal,
          })
          extracted++
        } catch (error) {
          warn({ paperId, error }, 'Paper extraction failed')
        }
      })
    )
  )
  throwIfCancelled(signal)
  
  info({ batchIndex, extracted, total: batchPaperIds.length }, 'Extraction batch complete')
  
  return extracted
}

/**
 * Analyze all findings after extraction is complete
 * Estimated time: 20-40s (single LLM call for analysis)
 */
const MAX_ANALYSIS_FINDINGS_TOTAL = 240
const MAX_ANALYSIS_FINDINGS_PER_PAPER = 6
const MIN_ANALYSIS_FINDINGS_PER_PAPER = 2

function scoreFindingForAnalysis(finding: FindingWithPaper): number {
  let score = finding.confidence || 0
  if (finding.isMainFinding) score += 1
  if (finding.value) score += 0.4
  if (finding.direction && finding.direction !== 'descriptive') score += 0.2
  if (finding.context) score += 0.1
  return score
}

function selectFindingsForAnalysis(allFindings: FindingWithPaper[]): FindingWithPaper[] {
  if (allFindings.length <= MAX_ANALYSIS_FINDINGS_TOTAL) {
    return allFindings
  }

  const byPaper = new Map<string, FindingWithPaper[]>()
  for (const finding of allFindings) {
    const paperFindings = byPaper.get(finding.paperId) || []
    paperFindings.push(finding)
    byPaper.set(finding.paperId, paperFindings)
  }

  const selected: FindingWithPaper[] = []
  const overflow: FindingWithPaper[] = []
  const perPaperCount = new Map<string, number>()

  for (const paperFindings of byPaper.values()) {
    const ranked = [...paperFindings].sort((a, b) => scoreFindingForAnalysis(b) - scoreFindingForAnalysis(a))
    if (ranked.length === 0) continue
    const guaranteed = ranked.slice(0, Math.min(ranked.length, MIN_ANALYSIS_FINDINGS_PER_PAPER))

    selected.push(...guaranteed)
    perPaperCount.set(ranked[0].paperId, guaranteed.length)

    if (ranked.length > guaranteed.length) {
      overflow.push(...ranked.slice(guaranteed.length))
    }
  }

  const remainingSlots = Math.max(0, MAX_ANALYSIS_FINDINGS_TOTAL - selected.length)
  if (remainingSlots === 0) {
    return selected
  }

  const rankedOverflow = overflow.sort((a, b) => scoreFindingForAnalysis(b) - scoreFindingForAnalysis(a))

  for (const finding of rankedOverflow) {
    if (selected.length >= MAX_ANALYSIS_FINDINGS_TOTAL) break

    const currentPaperCount = perPaperCount.get(finding.paperId) || 0
    if (currentPaperCount >= MAX_ANALYSIS_FINDINGS_PER_PAPER) continue

    selected.push(finding)
    perPaperCount.set(finding.paperId, currentPaperCount + 1)
  }

  return selected
}

export async function runAnalysisPhase(
  projectId: string,
  paperIds: string[],
  papers: PaperWithAuthors[],
  topic: string,
  profile: PaperProfile,
  onProgress?: StepProgressCallback,
  signal?: AbortSignal
): Promise<HybridThemeExtractionResult> {
  throwIfCancelled(signal)
  onProgress?.('planning', 30, 'Connecting ideas across sources...')
  
  // Get all extractions (cached + newly extracted)
  const extractions = await getExtractionsService(paperIds)
  throwIfCancelled(signal)
  
  // Build findings list
  const allFindings: FindingWithPaper[] = []
  for (const [paperId, extraction] of extractions) {
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
  
  const analysisFindings = selectFindingsForAnalysis(allFindings)

  info({
    totalFindings: allFindings.length,
    analysisFindings: analysisFindings.length,
    papersWithExtractions: extractions.size
  }, 'Analyzing findings')

  if (analysisFindings.length < allFindings.length) {
    onProgress?.('planning', 31, 'Key findings identified')
  }
  
  // Run cross-document analysis
  const analysisResult = await analyzeFindings({
    projectId,
    findings: analysisFindings,
    topic,
    signal
  })
  throwIfCancelled(signal)
  const readinessIssue = getAnalysisReadinessIssue(analysisResult)
  if (readinessIssue) {
    warn({ readinessIssue }, 'Analysis incomplete; falling back to RAG-only context building')
  }
  
  onProgress?.('planning', 35, 'Research patterns mapped')
  
  return {
    analysisResult,
    extractionStats: {
      papersProcessed: papers.length,
      papersExtracted: extractions.size,
      papersFromCache: extractions.size, // All are now in cache
      totalFindings: allFindings.length,
      extractionTimeMs: 0 // Not tracked in step-based approach
    }
  }
}

// =============================================================================
// Phase 4: Context Building
// =============================================================================

/**
 * Build section contexts with RAG and synthesis enrichment
 * Estimated time: 10-30s
 */
export async function runBuildContextsPhase(
  profile: PaperProfile,
  papers: PaperWithAuthors[],
  themeResult: HybridThemeExtractionResult | null,
  config: PipelineConfig,
  onProgress?: StepProgressCallback,
  signal?: AbortSignal
): Promise<SectionContext[]> {
  throwIfCancelled(signal)
  const sanitizedTopic = sanitizeTopic(config.topic)
  const FINDINGS_THRESHOLD = 5
  const totalFindings = themeResult?.extractionStats.totalFindings || 0
  const canUseSynthesisSignals = Boolean(
    themeResult &&
    totalFindings >= FINDINGS_THRESHOLD &&
    isAnalysisReadyForSynthesis(themeResult.analysisResult)
  )
  const synthesisAnalysis = canUseSynthesisSignals && themeResult
    ? themeResult.analysisResult
    : null
  
  // Merge analysis into profile if available
  const enhancedProfile = synthesisAnalysis
    ? mergeAnalysisResultIntoProfile(profile, synthesisAnalysis)
    : profile
  
  // Build outline from profile
  const allPaperIds = papers.map(p => p.id)
  
  if (!enhancedProfile.outline?.sections?.length) {
    throw new Error('Paper profile was generated without an outline')
  }
  
  const typedOutline: GeneratedOutline = {
    paperType: config.paperType,
    topic: sanitizedTopic,
    sections: enhancedProfile.outline.sections.map(section => ({
      sectionKey: section.sectionKey,
      title: section.title,
      candidatePaperIds: allPaperIds.slice(0, 50),
      keyPoints: section.keyPoints,
      expectedWords: section.expectedWords,
      subsections: section.subsections?.map(sub => ({
        sectionKey: sub.sectionKey,
        title: sub.title,
        candidatePaperIds: [],
        keyPoints: sub.keyPoints,
        expectedWords: sub.expectedWords
      }))
    })),
    totalEstimatedWords: enhancedProfile.outline.totalEstimatedWords,
    localRegion: undefined
  }
  
  onProgress?.('writing', 40, 'Matching evidence to sections...')
  
  let sectionContexts: SectionContext[]
  
  // Try hybrid enrichment if we have enough findings
  if (canUseSynthesisSignals && themeResult) {
    try {
      throwIfCancelled(signal)
      sectionContexts = await enrichAndBuildContexts(
        typedOutline,
        themeResult,
        enhancedProfile,
        papers,
        sanitizedTopic
      )
      
      const enrichedCount = sectionContexts.filter(
        s => (s as EnrichedSectionContext).hasSynthesisEnrichment
      ).length
      
      info({ enrichedSections: enrichedCount, totalSections: sectionContexts.length }, 'Hybrid contexts built')
      onProgress?.('writing', 45, 'Sections enriched with insights')
    } catch (error) {
      warn({ error }, 'Hybrid enrichment failed, using RAG-only')
      throwIfCancelled(signal)
      sectionContexts = await GenerationContextService.buildContexts(typedOutline, sanitizedTopic, papers)
    }
  } else {
    throwIfCancelled(signal)
    sectionContexts = await GenerationContextService.buildContexts(typedOutline, sanitizedTopic, papers)
  }
  throwIfCancelled(signal)
  
  onProgress?.('writing', 48, 'Evidence gathered — writing soon')
  
  return sectionContexts
}

// =============================================================================
// Phase 5: Section Generation (One per step)
// =============================================================================

/**
 * Generate a single section
 * Estimated time: 30-60s per section (LLM call with streaming)
 */
export async function runSectionGenerationPhase(
  sectionIndex: number,
  context: SectionContext,
  previousSections: SectionResult[],
  profile: PaperProfile,
  config: PipelineConfig,
  totalSections: number,
  onProgress?: StepProgressCallback,
  signal?: AbortSignal
): Promise<SectionResult> {
  throwIfCancelled(signal)
  const sanitizedTopic = sanitizeTopic(config.topic)
  const sectionTitle = context.title || context.sectionKey
  
  onProgress?.('writing', 50 + Math.round((sectionIndex / totalSections) * 35), 
    `Writing: ${sectionTitle}`)
  
  // Build rolling summary of previous sections
  const previousSummary = previousSections.length > 0
    ? previousSections.map(s => `${s.title}: ${s.content.slice(0, 200)}...`).join('\n\n')
    : undefined
  
  // Calculate token budget from this section's own word target (not averaged across sections).
  // Increased ceilings to reduce hard cutoffs in long, citation-dense sections.
  const sectionTargetWords = context.expectedWords || Math.round((profile.outline?.totalEstimatedWords || 10000) / totalSections)
  const perSectionTokens = Math.min(2800, Math.max(1400, Math.round(sectionTargetWords * 2.3)))
  
  // Build outline tree
  const outlineTree = profile.outline?.sections
    .map(s => `• ${s.title}`)
    .join('\n') || ''
  
  const profileGuidance = buildProfileGuidanceForPrompt(profile)

  const baseOptions = {
    temperature: config.temperature || 0.2,
    maxTokens: perSectionTokens,
    outlineTree,
    topic: sanitizedTopic,
    paperType: config.paperType,
    projectTitle: sanitizedTopic,
    previousSectionsSummary: previousSummary,
    profileGuidance,
    voiceConfig: profile.voice,
    profileCriteria: profile.qualityCriteria,
    customInstructions: config.customInstructions,
    originalResearch: config.originalResearch?.has_original_research ? {
      hasOriginalResearch: true,
      researchQuestion: config.originalResearch.research_question,
      keyFindings: config.originalResearch.key_findings
    } : undefined
  }

  // With generateText (no JSON overhead, no early stopping), subsection splitting
  // is only needed for very long sections (thesis/dissertation chapters).
  const SUBSECTION_WORD_THRESHOLD = 1800
  const shouldSplit = sectionTargetWords >= SUBSECTION_WORD_THRESHOLD

  let contextForGeneration = context

  // Auto-synthesize subsections if the profile didn't provide them
  if (shouldSplit && (!context.subsections || context.subsections.length === 0)) {
    const numSubs = Math.max(2, Math.min(5, Math.round(sectionTargetWords / 1000)))
    const wordsPerSub = Math.round(sectionTargetWords / numSubs)
    contextForGeneration = {
      ...context,
      subsections: Array.from({ length: numSubs }, (_, i) => ({
        title: `Part ${i + 1}`,
        expectedWords: wordsPerSub,
        keyPoints: context.keyPoints
          ? context.keyPoints.slice(
              Math.round((i / numSubs) * context.keyPoints.length),
              Math.round(((i + 1) / numSubs) * context.keyPoints.length)
            )
          : undefined
      }))
    }
  }

  let result
  if (shouldSplit && contextForGeneration.subsections && contextForGeneration.subsections.length > 0) {
    info({ sectionIndex, title: sectionTitle, subsections: contextForGeneration.subsections.length, targetWords: sectionTargetWords },
      'Using subsection splitting for section')
    result = await generateSectionBySubsections(contextForGeneration, baseOptions, undefined, signal)
  } else {
    result = await generateWithUnifiedTemplate({
      context: contextForGeneration,
      options: baseOptions,
      signal,
    })
  }
  throwIfCancelled(signal)
  
  // Ensure section has heading
  let content = result.content.trim()
  const startsWithHeading = /^##?\s+\w/.test(content)
  if (!startsWithHeading && sectionTitle) {
    const isSubsection = context.sectionKey?.toString().includes('.')
    const headingLevel = isSubsection ? '###' : '##'
    content = `${headingLevel} ${sectionTitle}\n\n${content}`
  }
  
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length
  
  onProgress?.('writing', 50 + Math.round(((sectionIndex + 1) / totalSections) * 35),
    `Finished: ${sectionTitle}`, {
      sectionComplete: true,
      sectionTitle,
      sectionContent: content,
      sectionIndex: sectionIndex + 1,
      totalSections
    })
  
  return {
    sectionKey: context.sectionKey,
    title: sectionTitle,
    content,
    citations: result.citations,
    wordCount
  }
}

// =============================================================================
// Phase 6: Quality Check
// =============================================================================

function isLikelyCompleteMarkdownLine(line: string): boolean {
  if (!line) return false

  // List entries often end without sentence punctuation.
  if (/^[-*+]\s+\S+/.test(line) || /^\d+\.\s+\S+/.test(line)) return true

  // Table rows and fenced block delimiters are valid endings.
  if (/^\|.*\|$/.test(line) || /^```/.test(line)) return true

  // A heading at end can be intentional for generated subsection scaffolds.
  if (/^#{1,6}\s+\S+/.test(line)) return true

  return false
}

function hasLikelyTruncatedEnding(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false
  const withoutCitations = trimmed.replace(/(?:\s*\[@[^\]]+\]\s*)+$/g, '').trim()
  if (!withoutCitations) return false

  const lines = withoutCitations
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const lastLine = lines[lines.length - 1] || ''

  if (isLikelyCompleteMarkdownLine(lastLine)) return false

  const lastChar = lastLine.slice(-1)
  // Accept sentence punctuation, table delimiters, and common closing delimiters.
  return !/[.!?;:|)\]"'`]/.test(lastChar)
}

/**
 * Check all sections for quality issues
 * Estimated time: 10-30s (no LLM calls, just analysis)
 */
export async function runQualityCheckPhase(
  sections: SectionResult[],
  contexts: SectionContext[],
  onProgress?: StepProgressCallback,
  signal?: AbortSignal
): Promise<QualityIssue[]> {
  throwIfCancelled(signal)
  onProgress?.('finishing', 88, 'Reviewing for completeness...')
  
  const issues: QualityIssue[] = []
  
  for (let i = 0; i < sections.length; i++) {
    throwIfCancelled(signal)
    const section = sections[i]
    void contexts[i]

    // Detect likely hard cutoff (mid-sentence / incomplete ending).
    if (section.wordCount >= 180 && hasLikelyTruncatedEnding(section.content)) {
      issues.push({
        sectionIndex: i,
        issue: 'truncation',
        details: 'Section appears to end abruptly'
      })
    }
  }
  
  info({ issueCount: issues.length, sections: sections.length }, 'Quality check complete')
  onProgress?.('finishing', 90, issues.length > 0 ? 'Polishing sections...' : 'Looking good so far')
  
  return issues
}

/**
 * Rewrite a section to fix a quality issue
 * Estimated time: 30-60s (LLM call)
 */
export async function runSectionRewritePhase(
  sectionIndex: number,
  issue: QualityIssue,
  context: SectionContext,
  previousContent: string,
  profile: PaperProfile,
  config: PipelineConfig,
  totalSections: number,
  onProgress?: StepProgressCallback,
  signal?: AbortSignal
): Promise<SectionResult> {
  throwIfCancelled(signal)
  void previousContent
  const sanitizedTopic = sanitizeTopic(config.topic)
  const sectionTitle = context.title || context.sectionKey
  
  onProgress?.('finishing', 91, `Refining: ${sectionTitle}`)
  
  // Token budget from this section's own word target (generous 3× so rewrites can expand)
  const sectionTargetWords = context.expectedWords || Math.round((profile.outline?.totalEstimatedWords || 10000) / totalSections)
  const perSectionTokens = Math.max(4000, Math.round(sectionTargetWords * 3))
  
  const outlineTree = profile.outline?.sections
    .map(s => `• ${s.title}`)
    .join('\n') || ''
  
  const profileGuidance = buildProfileGuidanceForPrompt(profile)
  
  const rewriteInstructions = `IMPORTANT: The previous attempt ended abruptly. Rewrite this section from scratch with complete sentences, complete tables if used, and a clear ending.`

  const baseOptions = {
    temperature: config.temperature || 0.2,
    maxTokens: perSectionTokens,
    outlineTree,
    topic: sanitizedTopic,
    paperType: config.paperType,
    projectTitle: sanitizedTopic,
    previousSectionsSummary: rewriteInstructions,
    profileGuidance,
    voiceConfig: profile.voice,
    profileCriteria: profile.qualityCriteria,
    customInstructions: config.customInstructions,
    originalResearch: config.originalResearch?.has_original_research ? {
      hasOriginalResearch: true,
      researchQuestion: config.originalResearch.research_question,
      keyFindings: config.originalResearch.key_findings
    } : undefined
  }

  // Subsection splitting for rewrites — same 2500-word threshold as generation
  const SUBSECTION_WORD_THRESHOLD = 2500
  const shouldSplit = sectionTargetWords >= SUBSECTION_WORD_THRESHOLD

  let contextForRewrite = context

  if (shouldSplit && (!context.subsections || context.subsections.length === 0)) {
    const numSubs = Math.max(2, Math.min(5, Math.round(sectionTargetWords / 1000)))
    const wordsPerSub = Math.round(sectionTargetWords / numSubs)
    contextForRewrite = {
      ...context,
      subsections: Array.from({ length: numSubs }, (_, i) => ({
        title: `Part ${i + 1}`,
        expectedWords: wordsPerSub,
        keyPoints: context.keyPoints
          ? context.keyPoints.slice(
              Math.round((i / numSubs) * context.keyPoints.length),
              Math.round(((i + 1) / numSubs) * context.keyPoints.length)
            )
          : undefined
      }))
    }
  }

  let result
  if (shouldSplit && contextForRewrite.subsections && contextForRewrite.subsections.length > 0) {
    info({ sectionIndex, title: sectionTitle, subsections: contextForRewrite.subsections.length, targetWords: sectionTargetWords },
      'Using subsection splitting for rewrite')
    result = await generateSectionBySubsections(contextForRewrite, baseOptions, undefined, signal)
  } else {
    result = await generateWithUnifiedTemplate({
      context: contextForRewrite,
      options: baseOptions,
      signal,
    })
  }
  throwIfCancelled(signal)
  
  let content = result.content.trim()
  const startsWithHeading = /^##?\s+\w/.test(content)
  if (!startsWithHeading && sectionTitle) {
    const isSubsection = context.sectionKey?.toString().includes('.')
    const headingLevel = isSubsection ? '###' : '##'
    content = `${headingLevel} ${sectionTitle}\n\n${content}`
  }
  
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length
  
  info({ sectionIndex, issue: issue.issue, newWordCount: wordCount }, 'Section rewritten')
  
  return {
    sectionKey: context.sectionKey,
    title: sectionTitle,
    content,
    citations: result.citations,
    wordCount
  }
}

// =============================================================================
// Phase 7: Finalization
// =============================================================================

/**
 * Convert inline [@paperId] citations to storage format [@paperId#instanceId].
 * Also handles [@id1; @id2] multi-cite syntax by splitting into individual markers
 * while preserving grouping metadata for renderers.
 * Strips any markers referencing invalid/hallucinated paper IDs.
 */
function isCitationGroupingSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string }
  const message = `${candidate.message || ''} ${candidate.details || ''} ${candidate.hint || ''}`.toLowerCase()
  return candidate.code === 'PGRST204' &&
    (
      message.includes('citation_group_id') ||
      message.includes('citation_group_order') ||
      message.includes('group_required')
    )
}

function convertInlineCitationsToStorage(
  content: string,
  validPaperIds: Set<string>
): {
  content: string
  instances: CitationInstance[]
} {
  const instances: CitationInstance[] = []
  
  // Match [@paperId] and [@id1; @id2] patterns
  const markerRegex = /\[@([^\]]+)\]/g
  
  let result = content.replace(markerRegex, (_match, inner: string) => {
    // Split on semicolons for multi-cite markers: [@id1; @id2] → two separate markers
    const ids = inner.split(/;\s*@?/).map((s: string) => s.replace(/^@/, '').trim()).filter(Boolean)
    const validIds = ids.filter((paperId) => validPaperIds.has(paperId))
    
    // If all IDs were invalid, remove the marker entirely
    if (validIds.length === 0) return ''

    const isGroupedMultiCite = validIds.length > 1
    const citationGroupId = isGroupedMultiCite ? uuidv4() : null
    const replacements: string[] = []
    for (let index = 0; index < validIds.length; index++) {
      const paperId = validIds[index]!
      const instanceId = uuidv4()
      instances.push({
        instanceId,
        paperId,
        quote: '',
        citationGroupId,
        citationGroupOrder: citationGroupId ? index : null,
        groupRequired: isGroupedMultiCite,
      })
      replacements.push(`[@${paperId}#${instanceId}]`)
    }
    
    // Preserve explicit multi-cite intent in text layout.
    return isGroupedMultiCite ? replacements.join('') : replacements[0]!
  })
  
  // Clean up double spaces
  result = result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:])/g, '$1')
  
  return { content: result, instances }
}

/**
 * Finalize and save the generated paper
 * Estimated time: 10-20s
 */
export async function runFinalizePhase(
  projectId: string,
  sections: SectionResult[],
  papers: PaperWithAuthors[],
  onProgress?: StepProgressCallback,
  signal?: AbortSignal
): Promise<{ content: string; citationCount: number }> {
  throwIfCancelled(signal)
  onProgress?.('finishing', 95, 'Saving your paper...')
  
  // Combine all section content
  let fullContent = sections.map(s => s.content).join('\n\n')
  
  // Clean non-citation artifacts
  const { cleanNonCitationArtifacts } = await import('@/lib/citations/post-processor')
  fullContent = cleanNonCitationArtifacts(fullContent)
  
  // Convert inline [@paperId] citations to storage format [@paperId#instanceId]
  const validPaperIds = new Set(papers.map(p => p.id))
  const { content: processedContent, instances: citationInstances } = 
    convertInlineCitationsToStorage(fullContent, validPaperIds)
  
  fullContent = processedContent
  
  // Build citations map
  const citedPaperIds = new Set(citationInstances.map(c => c.paperId))
  const citationsMap: Record<string, { paperId: string; citationText: string }> = {}
  
  for (const paperId of citedPaperIds) {
    const key = `cite-${paperId}`
    citationsMap[key] = {
      paperId,
      citationText: `[@${paperId}]`
    }
  }
  
  // Save content
  await updateProjectContent(projectId, fullContent.trim(), citationsMap)
  throwIfCancelled(signal)
  
  // Save citation instances
  if (citationInstances.length > 0) {
    try {
      const supabase = getServiceClient()
      
      // Delete existing instances for this project
      await supabase
        .from('citation_instances')
        .delete()
        .eq('project_id', projectId)
      
      // Insert new instances.
      // Use the instanceId as the primary key `id` so markers in content match rows.
      const baseInstanceRecords = citationInstances.map(inst => ({
        project_id: projectId,
        id: inst.instanceId,
        paper_id: inst.paperId,
        quote: inst.quote
      }))
      const groupedInstanceRecords = citationInstances.map(inst => ({
        project_id: projectId,
        id: inst.instanceId,
        paper_id: inst.paperId,
        quote: inst.quote,
        citation_group_id: inst.citationGroupId ?? null,
        citation_group_order:
          typeof inst.citationGroupOrder === 'number' ? inst.citationGroupOrder : null,
        group_required: inst.groupRequired === true,
      }))
      
      // Batch inserts to avoid request size/timeouts for large papers.
      const BATCH_SIZE = 500
      const insertInBatches = async (records: typeof groupedInstanceRecords | typeof baseInstanceRecords) => {
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          const batch = records.slice(i, i + BATCH_SIZE)
          const { error } = await supabase
            .from('citation_instances')
            .insert(batch)
          if (error) {
            throw error
          }
        }
      }

      try {
        await insertInBatches(groupedInstanceRecords)
      } catch (insertError) {
        if (isCitationGroupingSchemaError(insertError)) {
          warn(
            { error: insertError },
            'citation grouping columns unavailable; retrying citation instance save without grouping metadata'
          )
          await insertInBatches(baseInstanceRecords)
        } else {
          throw insertError
        }
      }
    } catch (err) {
      throwIfCancelled(signal)
      warn({ error: err }, 'Failed to save citation instances')
    }
  }
  
  // Update project status
  throwIfCancelled(signal)
  await updateResearchProjectStatus(projectId, 'complete' as PaperStatus)
  throwIfCancelled(signal)
  
  info({
    wordCount: fullContent.split(/\s+/).length,
    citationCount: citedPaperIds.size,
    instanceCount: citationInstances.length
  }, 'Paper finalized')
  
  onProgress?.('complete', 100, 'Your paper is ready!')
  
  return {
    content: fullContent.trim(),
    citationCount: citedPaperIds.size
  }
}

// =============================================================================
// Helper: Get papers by IDs
// =============================================================================

/**
 * Fetch papers by their IDs from the database
 */
export async function getPapersByIds(paperIds: string[]): Promise<PaperWithAuthors[]> {
  if (paperIds.length === 0) return []
  
  const supabase = getServiceClient()
  
  const { data, error } = await supabase
    .from('papers')
    .select('*')
    .in('id', paperIds)
  
  if (error) {
    throw new Error(`Failed to fetch papers: ${error.message}`)
  }
  
  return (data || []) as PaperWithAuthors[]
}
