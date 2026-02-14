/**
 * Pipeline Steps for Inngest Multi-Step Execution
 * 
 * This module exports individual phase functions that can be called
 * from separate Inngest steps, allowing long-running paper generation
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
import { SectionReviewer } from '@/lib/quality/section-reviewer'
import { fourGramOverlapRatio } from '@/lib/utils/overlap'
import { sanitizeTopic } from '@/lib/utils/prompt-safety'
import { mergeAnalysisResultIntoProfile } from '@/lib/generation/theme-extraction'
import { enrichAndBuildContexts, type HybridThemeExtractionResult } from '@/lib/synthesis-engine/pipeline-integration'
import { 
  extractPaper 
} from '@/lib/extraction'
import { 
  getExtractionsService, 
  getPapersNeedingExtractionService,
  saveExtractionService 
} from '@/lib/extraction/db-service'
import { getContentStatus, createChunksForPaper } from '@/lib/content'
import { analyzeFindings, type FindingWithPaper, type AnalysisResult } from '@/lib/analysis/cross-document'
import { updateProjectContent, updateResearchProjectStatus, savePartialContent } from '@/lib/db/research'
import { getServiceClient } from '@/lib/supabase/service'
import { info, warn, error as logError } from '@/lib/utils/logger'
import pLimit from 'p-limit'

import type { PaperProfile } from '@/lib/generation/paper-profile-types'
import type { PaperWithAuthors, PaperStatus, PaperTypeKey as SimplifiedPaperTypeKey } from '@/types/simplified'
import type { GeneratedOutline, SectionContext, PaperTypeKey } from '@/lib/prompts/types'
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
  issue: 'overlap' | 'length' | 'citation' | 'truncation'
  details?: string
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
  onProgress?: StepProgressCallback
): Promise<PaperProfile> {
  const sanitizedTopic = sanitizeTopic(config.topic)
  
  onProgress?.('profiling', 5, 'Analyzing your topic...')
  
  const rawProfile = await generatePaperProfile({
    topic: sanitizedTopic,
    paperType: config.paperType,
    hasOriginalResearch: config.originalResearch?.has_original_research,
    userContext: config.customInstructions,
    length: config.length,
    researchQuestion: config.originalResearch?.research_question,
    keyFindings: config.originalResearch?.key_findings,
  })
  const profile = scaleProfileOutlineForLength(rawProfile, config.length)
  
  info({
    discipline: profile.discipline.primary,
    sections: profile.structure.appropriateSections.map(s => s.key),
    minSources: profile.sourceExpectations.minimumUniqueSources,
  }, 'Paper profile generated')
  
  onProgress?.('profiling', 10, `Identified as ${profile.discipline.primary} research`)
  
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
  onProgress?: StepProgressCallback
): Promise<PaperWithAuthors[]> {
  const sanitizedTopic = sanitizeTopic(config.topic)
  
  onProgress?.('search', 15, 'Searching for relevant papers...')
  
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
    discipline: profile.discipline.primary
  }

  const papers = await collectPapers(discoveryOptions)
  
  if (papers.length === 0) {
    throw new Error('No papers found for the given topic')
  }
  
  onProgress?.('search', 22, `Found ${papers.length} relevant papers`)
  
  return papers
}

// =============================================================================
// Phase 3: Theme Extraction (Split into batches)
// =============================================================================

const MIN_FULL_TEXT_LENGTH = 5000
const EXTRACTION_BATCH_SIZE = 8 // Higher throughput while staying within step budget

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
  onProgress?: StepProgressCallback
): Promise<{
  cachedPaperIds: string[]
  pendingPaperIds: string[]
  totalBatches: number
}> {
  onProgress?.('planning', 25, 'Checking for existing analysis...')
  
  // Check which papers need extraction
  const needsExtraction = await getPapersNeedingExtractionService(paperIds)
  const cachedPaperIds = paperIds.filter(id => !needsExtraction.includes(id))
  
  // Filter to papers with usable full text
  const usableFullTextIds = new Set(
    papers
      .filter(p => ((p as any).pdf_content as string || '').length >= MIN_FULL_TEXT_LENGTH)
      .map(p => p.id)
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
  
  onProgress?.('planning', 27, `${cachedPaperIds.length} papers cached, ${extractablePaperIds.length} need analysis`)
  
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
  papers: PaperWithAuthors[],
  onProgress?: StepProgressCallback
): Promise<number> {
  const startIdx = batchIndex * EXTRACTION_BATCH_SIZE
  const endIdx = Math.min(startIdx + EXTRACTION_BATCH_SIZE, pendingPaperIds.length)
  const batchPaperIds = pendingPaperIds.slice(startIdx, endIdx)
  
  if (batchPaperIds.length === 0) {
    return 0
  }
  
  onProgress?.('planning', 28, `Analyzing papers ${startIdx + 1}-${endIdx} of ${pendingPaperIds.length}...`)
  
  // Keep idempotency guarantees with a batched freshness check, then run extraction
  // at higher controlled concurrency for better throughput.
  const limit = pLimit(5)
  let extracted = 0
  let extractableNow = new Set<string>()

  try {
    const stillPending = await getPapersNeedingExtractionService(batchPaperIds)
    extractableNow = new Set(stillPending)
  } catch (err) {
    warn({ batchIndex, error: err }, 'Failed to refresh extraction status for batch; using original batch IDs')
    extractableNow = new Set(batchPaperIds)
  }
  
  await Promise.all(
    batchPaperIds.map(paperId =>
      limit(async () => {
        if (!extractableNow.has(paperId)) return
        const paper = papers.find(p => p.id === paperId)
        if (!paper) return
        
        const pdfContent = (paper as any).pdf_content as string || ''
        if (pdfContent.length < MIN_FULL_TEXT_LENGTH) return
        
        try {
          const result = await extractPaper({ paperId, text: pdfContent })
          if (result.success && result.extraction) {
            await saveExtractionService(result.extraction)
            extracted++
          }
        } catch (error) {
          warn({ paperId, error }, 'Paper extraction failed')
        }
      })
    )
  )
  
  info({ batchIndex, extracted, total: batchPaperIds.length }, 'Extraction batch complete')
  
  return extracted
}

/**
 * Preflight gate before analysis/writing:
 * ensure chunk rows exist for papers that already have stored content.
 * This avoids expensive late ingestion fallback during section retrieval.
 */
export async function runPreflightContentPhase(
  paperIds: string[],
  papers: PaperWithAuthors[],
  onProgress?: StepProgressCallback
): Promise<{
  readyPaperIds: string[]
  rebuiltChunks: number
  missingContentIds: string[]
}> {
  onProgress?.('planning', 29, 'Running content preflight gate...')

  const statusMap = await getContentStatus(paperIds)
  const needsChunkRebuild = paperIds.filter(id => {
    const status = statusMap.get(id)
    return !!status?.hasContent && status.chunkCount === 0
  })

  const missingContentIds = paperIds.filter(id => {
    const status = statusMap.get(id)
    return !status?.hasContent
  })

  let rebuiltChunks = 0
  if (needsChunkRebuild.length > 0) {
    const limit = pLimit(4)
    await Promise.all(
      needsChunkRebuild.map(paperId =>
        limit(async () => {
          const paper = papers.find(p => p.id === paperId)
          if (!paper) return

          const pdfContent = ((paper as any).pdf_content as string | undefined) || ''
          const abstractContent = (paper.abstract || '').trim()
          const content = pdfContent.length > 0 ? pdfContent : abstractContent
          if (!content) return

          try {
            const chunkCount = await createChunksForPaper(paperId, content)
            if (chunkCount > 0) rebuiltChunks += 1
          } catch (err) {
            warn({ paperId, error: err }, 'Preflight chunk rebuild failed')
          }
        })
      )
    )
  }

  const postStatusMap = await getContentStatus(paperIds)
  const readyPaperIds = paperIds.filter(id => (postStatusMap.get(id)?.chunkCount || 0) > 0)

  info({
    papers: paperIds.length,
    ready: readyPaperIds.length,
    rebuilt: rebuiltChunks,
    missingContent: missingContentIds.length
  }, 'Content preflight complete')

  if (readyPaperIds.length === 0) {
    throw new Error('Content preflight failed: no chunked papers available for generation')
  }

  onProgress?.('planning', 30, `Content preflight ready: ${readyPaperIds.length}/${paperIds.length} papers chunked`)

  return {
    readyPaperIds,
    rebuiltChunks,
    missingContentIds
  }
}

/**
 * Analyze all findings after extraction is complete
 * Estimated time: 20-40s (single LLM call for analysis)
 */
const MAX_ANALYSIS_FINDINGS_TOTAL = 360
const MAX_ANALYSIS_FINDINGS_PER_PAPER = 8
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
  onProgress?: StepProgressCallback
): Promise<HybridThemeExtractionResult> {
  onProgress?.('planning', 30, 'Synthesizing findings across papers...')
  
  // Get all extractions (cached + newly extracted)
  const extractions = await getExtractionsService(paperIds)
  
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
    onProgress?.('planning', 31, `Prioritizing ${analysisFindings.length} core findings for synthesis (from ${allFindings.length})`)
  }
  
  // Run cross-document analysis
  const analysisResult = await analyzeFindings({
    projectId,
    findings: analysisFindings,
    topic
  })
  
  onProgress?.('planning', 35, `Identified ${analysisResult.patterns.length} patterns, ${analysisResult.contradictions.length} debates`)
  
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
  onProgress?: StepProgressCallback
): Promise<SectionContext[]> {
  const sanitizedTopic = sanitizeTopic(config.topic)
  
  // Merge analysis into profile if available
  const enhancedProfile = themeResult 
    ? mergeAnalysisResultIntoProfile(profile, themeResult.analysisResult)
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
  
  onProgress?.('writing', 40, 'Gathering evidence for each section...')
  
  let sectionContexts: SectionContext[]
  
  // Try hybrid enrichment if we have enough findings
  const FINDINGS_THRESHOLD = 5
  const totalFindings = themeResult?.extractionStats.totalFindings || 0
  
  if (themeResult && totalFindings >= FINDINGS_THRESHOLD) {
    try {
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
      onProgress?.('writing', 45, `${enrichedCount} sections enriched with cross-paper insights`)
    } catch (error) {
      warn({ error }, 'Hybrid enrichment failed, using RAG-only')
      sectionContexts = await GenerationContextService.buildContexts(typedOutline, sanitizedTopic, papers)
    }
  } else {
    sectionContexts = await GenerationContextService.buildContexts(typedOutline, sanitizedTopic, papers)
  }
  
  onProgress?.('writing', 48, `Ready to write ${sectionContexts.length} sections`)
  
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
  onProgress?: StepProgressCallback
): Promise<SectionResult> {
  const sanitizedTopic = sanitizeTopic(config.topic)
  const sectionTitle = context.title || context.sectionKey
  
  onProgress?.('writing', 50 + Math.round((sectionIndex / totalSections) * 35), 
    `Writing "${sectionTitle}" (${sectionIndex + 1} of ${totalSections})...`)
  
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
    result = await generateSectionBySubsections(contextForGeneration, baseOptions)
  } else {
    result = await generateWithUnifiedTemplate({
      context: contextForGeneration,
      options: baseOptions
    })
  }
  
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
    `Completed "${sectionTitle}" (${wordCount} words)`, {
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

const OVERLAP_THRESHOLD = 0.22

function hasLikelyTruncatedEnding(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false
  const withoutCitations = trimmed.replace(/(?:\s*\[@[^\]]+\]\s*)+$/g, '').trim()
  if (!withoutCitations) return false
  const lastChar = withoutCitations.slice(-1)
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
  onProgress?: StepProgressCallback
): Promise<QualityIssue[]> {
  onProgress?.('finishing', 88, 'Checking for consistency and quality...')
  
  const issues: QualityIssue[] = []
  let fullContent = ''
  
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    const context = contexts[i]
    
    // Check overlap with previous content
    if (fullContent) {
      const overlap = fourGramOverlapRatio(section.content, fullContent)
      if (overlap > OVERLAP_THRESHOLD) {
        issues.push({
          sectionIndex: i,
          issue: 'overlap',
          details: `${(overlap * 100).toFixed(0)}% overlap with previous sections`
        })
      }
    }
    
    // Check length
    const targetWords = context.expectedWords || 300
    if (targetWords >= 400 && section.wordCount < targetWords * 0.5) {
      issues.push({
        sectionIndex: i,
        issue: 'length',
        details: `${section.wordCount} words vs ${targetWords} target`
      })
    }

    // Detect likely hard cutoff (mid-sentence / incomplete ending).
    if (section.wordCount >= 180 && hasLikelyTruncatedEnding(section.content)) {
      issues.push({
        sectionIndex: i,
        issue: 'truncation',
        details: 'Section appears to end abruptly'
      })
    }
    
    fullContent += section.content + '\n\n'
  }
  
  info({ issueCount: issues.length, sections: sections.length }, 'Quality check complete')
  onProgress?.('finishing', 90, issues.length > 0 
    ? `Found ${issues.length} sections that could be improved`
    : 'All sections passed quality checks')
  
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
  onProgress?: StepProgressCallback
): Promise<SectionResult> {
  const sanitizedTopic = sanitizeTopic(config.topic)
  const sectionTitle = context.title || context.sectionKey
  
  onProgress?.('finishing', 91, `Improving "${sectionTitle}"...`)
  
  // Token budget from this section's own word target (generous 3× so rewrites can expand)
  const sectionTargetWords = context.expectedWords || Math.round((profile.outline?.totalEstimatedWords || 10000) / totalSections)
  const perSectionTokens = Math.max(4000, Math.round(sectionTargetWords * 3))
  
  const outlineTree = profile.outline?.sections
    .map(s => `• ${s.title}`)
    .join('\n') || ''
  
  const profileGuidance = buildProfileGuidanceForPrompt(profile)
  
  // Build rewrite instructions based on issue type
  let rewriteInstructions = ''
  if (issue.issue === 'overlap') {
    rewriteInstructions = `IMPORTANT: Avoid repeating content from earlier sections. Focus only on new, unique insights for "${sectionTitle}".`
  } else if (issue.issue === 'length') {
    const targetWords = context.expectedWords || 300
    rewriteInstructions = `IMPORTANT: This section needs to be longer. Write at least ${Math.round(targetWords * 0.8)} words with thorough coverage of all key points.`
  } else if (issue.issue === 'truncation') {
    rewriteInstructions = `IMPORTANT: The previous attempt ended abruptly. Rewrite this section from scratch with complete sentences, complete tables if used, and a clear ending.`
  }

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
    result = await generateSectionBySubsections(contextForRewrite, baseOptions)
  } else {
    result = await generateWithUnifiedTemplate({
      context: contextForRewrite,
      options: baseOptions
    })
  }
  
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
 * Also handles [@id1; @id2] multi-cite syntax by splitting into individual markers.
 * Strips any markers referencing invalid/hallucinated paper IDs.
 */
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
    
    const replacements: string[] = []
    for (const paperId of ids) {
      if (!validPaperIds.has(paperId)) continue // Strip hallucinated IDs
      
      const instanceId = uuidv4()
      instances.push({
        instanceId,
        paperId,
        quote: '',
      })
      replacements.push(`[@${paperId}#${instanceId}]`)
    }
    
    // If all IDs were invalid, remove the marker entirely
    return replacements.length > 0 ? replacements.join('') : ''
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
  onProgress?: StepProgressCallback
): Promise<{ content: string; citationCount: number }> {
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
      const instanceRecords = citationInstances.map(inst => ({
        project_id: projectId,
        id: inst.instanceId,
        paper_id: inst.paperId,
        quote: inst.quote
      }))
      
      // Batch inserts to avoid request size/timeouts for large papers.
      const BATCH_SIZE = 500
      for (let i = 0; i < instanceRecords.length; i += BATCH_SIZE) {
        const batch = instanceRecords.slice(i, i + BATCH_SIZE)
        const { error } = await supabase
          .from('citation_instances')
          .insert(batch)
        if (error) {
          throw error
        }
      }
    } catch (err) {
      warn({ error: err }, 'Failed to save citation instances')
    }
  }
  
  // Update project status
  await updateResearchProjectStatus(projectId, 'complete' as PaperStatus)
  
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
