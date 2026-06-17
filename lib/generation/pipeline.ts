import 'server-only'
import { v4 as uuidv4 } from 'uuid'
import { updateProjectContent, updateResearchProjectStatus, updateProjectVoiceProfile, savePartialContent } from '@/lib/db/research'
import { collectPapers } from '@/lib/generation/discovery'
// generateOutline removed — outline now comes from paper profile
import { generateMultipleSectionsUnified, type StructuredCitation } from '@/lib/generation/unified-generator'
import { GenerationContextService } from '@/lib/rag/generation-context'
// Legacy validatePaperType removed - using profile-based validation only
import { sanitizeTopic } from '@/lib/utils/prompt-safety'
import { classifyError, CancellationError } from '@/lib/generation/errors'
import { warn, error as logError, info } from '@/lib/utils/logger'
// Citation markers converted from [N] to [@paperId#instanceId] for storage
// cleanRemainingArtifacts removes any leaked tool syntax
import { generatePaperProfile, validatePaperWithProfile, buildProfileGuidanceForPrompt, scaleProfileOutlineForLength } from '@/lib/generation/paper-profile'
import { logSectionCitations } from '@/lib/rag/relevance-feedback'
import { mergeAnalysisResultIntoProfile } from '@/lib/generation/theme-extraction'
import { extractThemesHybrid, enrichAndBuildContexts, type HybridThemeExtractionResult } from '@/lib/synthesis-engine/pipeline-integration'
import type { EnrichedSectionContext } from '@/lib/synthesis-engine/outline-enricher'
import { getServiceClient } from '@/lib/supabase/service'
import type { PaperProfile } from '@/lib/generation/paper-profile-types'
import type { PaperStatus, OriginalResearchConfig, PaperTypeKey as SimplifiedPaperTypeKey } from '@/types/simplified'
import { PAPER_TYPE_SEARCH_MULTIPLIERS, PAPER_TYPE_MIN_SEARCH } from '@/types/simplified'
import type { GeneratedOutline, SectionContext, PaperTypeKey } from '@/lib/prompts/types'
import type { EnhancedGenerationOptions } from '@/lib/generation/types'
import { getAnalysisReadinessIssue, type AnalysisResult } from '@/lib/analysis/cross-document'
import { SYNTHESIS_FINDINGS_THRESHOLD } from '@/lib/generation/paper-type-config'

/**
 * Citation instance to be saved to the database
 */
export interface CitationInstance {
  instanceId: string
  paperId: string
  quote: string
  /** Optional grouping metadata for multi-cite clusters (e.g. [@a; @b]). */
  citationGroupId?: string | null
  citationGroupOrder?: number | null
  /** Hint for renderers: true when citation came from an explicit multi-cite cluster. */
  groupRequired?: boolean
}

/**
 * Pipeline performance metrics for bottleneck analysis
 */
export interface PipelineMetrics {
  // Timing (in milliseconds)
  totalDuration: number
  paperDiscoveryDuration: number
  themeExtractionDuration: number
  outlineGenerationDuration: number
  contextBuildingDuration: number
  sectionGenerationDuration: number
  qualityCheckDuration: number
  
  // Section generation breakdown
  sectionTimings: Array<{
    title: string
    generationMs: number
    qualityCheckMs: number
    wasRewritten: boolean
    rewriteReason?: 'citation_verification'
  }>
  
  // Reserved for legacy compatibility; no overlap rewrite logic.
  overlapStats: {
    sectionsChecked: number
    sectionsExceedingThreshold: number
    rewritesTriggered: number
    avgOverlapRatio: number
    maxOverlapRatio: number
  }
  
  // PDF processing stats
  pdfStats: {
    papersWithFullText: number
    papersAbstractOnly: number
    avgChunksPerPaper: number
  }
  
  // Citation stats
  citationStats: {
    sectionsVerified: number
    sectionsFailed: number
    regenerationsTriggered: number
  }
}

/**
 * Minimal configuration object for paper generation
 */
export interface PipelineConfig {
  // Required
  topic: string
  paperType: PaperTypeKey
  length: number
  
  // Optional
  useLibraryOnly?: boolean
  libraryPaperIds?: string[]
  sources?: string[]
  temperature?: number
  maxTokens?: number
  customInstructions?: string
  
  // Original research support
  originalResearch?: OriginalResearchConfig
}

/**
 * Pipeline result containing generated content and metrics
 */
export interface PipelineResult {
  content: string
  outline: GeneratedOutline
  sections: SectionContext[]
  citations: Record<string, { paperId: string; citationText: string }>
  /** Citation instances to be saved for hover quote previews */
  citationInstances?: CitationInstance[]
  /** The generated paper profile that guided generation */
  profile: PaperProfile
  /** Cross-document analysis result (patterns/contradictions/gaps) */
  analysisResult?: AnalysisResult
  metrics: {
    papersUsed: number
    sectionsGenerated: number
    totalWords: number
    qualityScore: number
    generationTime: number
  }
  /** Detailed performance metrics for bottleneck analysis */
  performanceMetrics?: PipelineMetrics
}

/**
 * Statistics from the citation conversion process
 */
export interface CitationConversionStats {
  /** Number of [N] markers successfully converted to [@paperId#instanceId] */
  markersConverted: number
  /** Number of times we reused the first quote because LLM provided fewer entries than markers */
  quotesReused: number
  /** Number of orphan markers removed (indices with no citation entries) */
  orphanMarkersRemoved: number
  /** Number of citations with invalid/hallucinated paper IDs */
  invalidCitationsFiltered: number
}

/**
 * Convert numbered citation markers [1], [2], [3] to storage format [@paperId#instanceId]
 * using the structured citation data from the LLM.
 * 
 * @param content - Content with [1], [2], [3] markers
 * @param citations - Structured citations array from LLM (one entry per occurrence, in order)
 * @param validPaperIds - Set of valid paper IDs to filter out hallucinated citations
 * @returns Object with converted content, instances to save to DB, and conversion stats
 */
function convertNumberedCitationsToStorage(
  content: string,
  citations: StructuredCitation[],
  validPaperIds: Set<string>
): {
  content: string
  instances: CitationInstance[]
  invalidCitations: StructuredCitation[]
  stats: CitationConversionStats
} {
  const instances: CitationInstance[] = []
  const invalidCitations: StructuredCitation[] = []
  const stats: CitationConversionStats = {
    markersConverted: 0,
    quotesReused: 0,
    orphanMarkersRemoved: 0,
    invalidCitationsFiltered: 0,
  }
  
  // Group citations by index and filter valid ones
  const citationsByIndex = new Map<number, StructuredCitation[]>()
  for (const citation of citations) {
    if (!validPaperIds.has(citation.paperId)) {
      invalidCitations.push(citation)
      stats.invalidCitationsFiltered++
      continue
    }
    const existing = citationsByIndex.get(citation.index) || []
    existing.push(citation)
    citationsByIndex.set(citation.index, existing)
  }
  
  let result = content
  
  // Process each citation index
  for (const [index, citationsForIndex] of citationsByIndex) {
    const pattern = new RegExp(`\\[${index}\\]`, 'g')
    const markersInContent = (content.match(pattern) || []).length
    let occurrenceCount = 0
    
    // Warn if marker count doesn't match citation entries
    if (markersInContent > citationsForIndex.length) {
      const reusedCount = markersInContent - citationsForIndex.length
      stats.quotesReused += reusedCount
      warn({
        index,
        markersInContent,
        citationEntries: citationsForIndex.length,
        quotesReused: reusedCount,
      }, 'More [N] markers than citation entries - reusing first quote for extra occurrences')
    }
    
    // Replace each occurrence with a unique instanceId
    result = result.replace(pattern, () => {
      const citation = citationsForIndex[occurrenceCount] || citationsForIndex[0]
      occurrenceCount++
      stats.markersConverted++
      
      const instanceId = uuidv4()
      instances.push({
        instanceId,
        paperId: citation.paperId,
        quote: citation.quote || '',
      })
      
      return `[@${citation.paperId}#${instanceId}]`
    })
  }
  
  // Remove any numbered markers that weren't in the citations array (hallucinated indices)
  result = result.replace(/\[\d+\]/g, (match) => {
    stats.orphanMarkersRemoved++
    warn({ marker: match }, 'Removing numbered citation marker with no corresponding citation data')
    return ''
  })
  
  // Clean up any double spaces left by removed citations
  result = result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:])/g, '$1')
  
  // Log summary stats if there were issues
  if (stats.quotesReused > 0 || stats.orphanMarkersRemoved > 0 || stats.invalidCitationsFiltered > 0) {
    info({
      markersConverted: stats.markersConverted,
      quotesReused: stats.quotesReused,
      orphanMarkersRemoved: stats.orphanMarkersRemoved,
      invalidCitationsFiltered: stats.invalidCitationsFiltered,
    }, 'Citation conversion completed with issues')
  }
  
  return { content: result, instances, invalidCitations, stats }
}

/**
 * Progress callback interface for streaming updates
 */
export interface ProgressCallback {
  (stage: string, progress: number, message: string, data?: Record<string, unknown>): void
}

/**
 * Main orchestrator function - handles the complete paper generation pipeline
 * 
 * ARCHITECTURAL RESPONSIBILITIES:
 * - Pipeline: Orchestration, quality assessment, evidence tracking, overlap detection, project management
 * - Unified Generator: Core content generation, streaming, basic quality metrics
 * 
 * This is the single entry point that replaces the complex route logic with
 * a clean, testable pipeline that follows the 5-layer architecture:
 * 1. Search: collectPapers()
 * 2. Content readiness: metadata registration + targeted full-text/chunk upgrades
 * 3. RAG: GenerationContextService.buildContexts()
 * 4. Generation: generateMultipleSectionsUnified()
 * 5. Quality: citation verification + evidence tracking
 */
export async function generatePaper(
  config: PipelineConfig,
  projectId: string,
  userId: string,
  onProgress?: ProgressCallback,
  baseUrl?: string,
  signal?: AbortSignal
): Promise<PipelineResult> {
  const startTime = Date.now()
  
  // Initialize performance metrics for bottleneck analysis
  const metrics: PipelineMetrics = {
    totalDuration: 0,
    paperDiscoveryDuration: 0,
    themeExtractionDuration: 0,
    outlineGenerationDuration: 0,
    contextBuildingDuration: 0,
    sectionGenerationDuration: 0,
    qualityCheckDuration: 0,
    sectionTimings: [],
    overlapStats: {
      sectionsChecked: 0,
      sectionsExceedingThreshold: 0,
      rewritesTriggered: 0,
      avgOverlapRatio: 0,
      maxOverlapRatio: 0
    },
    pdfStats: {
      papersWithFullText: 0,
      papersAbstractOnly: 0,
      avgChunksPerPaper: 0
    },
    citationStats: {
      sectionsVerified: 0,
      sectionsFailed: 0,
      regenerationsTriggered: 0
    }
  }
  
  // Helper to check for cancellation at key checkpoints
  const checkCancellation = (stage: string) => {
    if (signal?.aborted) {
      throw new CancellationError(`Pipeline cancelled during ${stage}`)
    }
  }
  
  // Check for cancellation at pipeline start
  checkCancellation('initialization')
  
  onProgress?.('initialization', 0, 'Preparing to write your paper...')
  
  // Sanitize user input to prevent prompt injection
  const sanitizedTopic = sanitizeTopic(config.topic)
  if (sanitizedTopic !== config.topic) {
    warn({ original: config.topic.slice(0, 100), sanitized: sanitizedTopic.slice(0, 100) }, 'Topic was sanitized for safety')
  }
  
  // Set project status to generating
  await updateResearchProjectStatus(projectId, 'generating' as PaperStatus)

  try {
    // Step 1: Generate Paper Profile (contextual intelligence)
    // This MUST happen first to determine search parameters
    onProgress?.('profiling', 2, 'Understanding your research area...', {
      topic: sanitizedTopic.slice(0, 50)
    })
    
    const rawProfile = await generatePaperProfile({
      topic: sanitizedTopic,
      paperType: config.paperType,
      hasOriginalResearch: config.originalResearch?.has_original_research,
      userContext: config.customInstructions,
      length: config.length,
    })
    const paperProfile = scaleProfileOutlineForLength(rawProfile, config.length)
    
    info({
      discipline: paperProfile.discipline.primary,
      sections: paperProfile.structure.appropriateSections.map(s => s.key),
      inappropriateSections: paperProfile.structure.inappropriateSections.map(s => s.name),
      minSources: paperProfile.sourceExpectations.minimumUniqueSources,
      recencyProfile: paperProfile.sourceExpectations.recencyProfile
    }, 'Paper profile generated')
    
    onProgress?.('profiling', 8, `Tailoring approach for ${paperProfile.discipline.primary} research`, {
      discipline: paperProfile.discipline.primary,
      sectionsPlanned: paperProfile.structure.appropriateSections.length,
      minSources: paperProfile.sourceExpectations.minimumUniqueSources
    })
    
    // Persist voice profile to project for chat/autocomplete to use
    if (paperProfile.voice?.profileId) {
      try {
        await updateProjectVoiceProfile(projectId, paperProfile.voice.profileId)
        info({ voiceProfileId: paperProfile.voice.profileId }, 'Voice profile persisted to project')
      } catch (voiceError) {
        // Non-fatal - voice profile is nice to have but not critical
        warn({ error: voiceError }, 'Failed to persist voice profile to project')
      }
    }
    
    // Step 2: Prepare Sources (Process uploads + Search online)
    // This combines uploaded paper processing and online search into one stage
    const discoveryStartTime = Date.now()
    const uploadedCount = config.libraryPaperIds?.length || 0
    
    // 2a: Process uploaded papers first (if any)
    if (uploadedCount > 0) {
      onProgress?.('search', 10, 'Reading your uploaded papers...', {
        uploadedPapers: uploadedCount,
        phase: 'processing_uploads'
      })
      
      try {
        const { ensureBulkPaperContentReadyByIds } = await import('@/lib/services/paper-content-service')
        const processingResults = await ensureBulkPaperContentReadyByIds(config.libraryPaperIds!, {
          searchQuery: sanitizedTopic,
          waitForStructuredExtraction: false,
        })
        const successfulIds = new Set(processingResults.paperIds)
        const successful = successfulIds.size
        const failedIds = config.libraryPaperIds!.filter(id => !successfulIds.has(id))
        const failed = failedIds.length
        
        if (failed > 0) {
          warn({ 
            successful, 
            failed, 
            failedIds
          }, 'Some papers failed to process')
        }
        
        info({ successful, failed, total: uploadedCount }, 'Uploaded paper processing completed')
        
        onProgress?.('search', 15, 'Uploaded papers ready', {
          uploadedProcessed: successful,
          uploadedFailed: failed,
          phase: 'uploads_complete'
        })
      } catch (processingError) {
        warn({ error: processingError }, 'Paper processing failed, continuing with available content')
      }
    }
    
    // 2b: Search online for additional papers (unless library-only mode)
    if (!config.useLibraryOnly) {
      onProgress?.('search', 18, 'Searching academic databases...', { 
        phase: 'searching_online',
        recencyProfile: paperProfile.sourceExpectations.recencyProfile
      })
    } else {
      onProgress?.('search', 18, 'Working exclusively with your uploaded papers', {
        phase: 'library_only',
        uploadedPapers: uploadedCount
      })
    }
    
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
        // Dynamic search limit based on paper type
        // Different paper types need different search volumes to account for filtering losses
        limit: (() => {
          const paperType = config.paperType as SimplifiedPaperTypeKey
          const searchMultiplier = PAPER_TYPE_SEARCH_MULTIPLIERS[paperType] ?? 2.5
          const minSearch = PAPER_TYPE_MIN_SEARCH[paperType] ?? 50
          const idealSourceCount = paperProfile.sourceExpectations.idealSourceCount
          const calculatedLimit = Math.ceil(idealSourceCount * searchMultiplier)
          const finalLimit = Math.max(minSearch, calculatedLimit)
          info({ paperType, idealSourceCount, searchMultiplier, minSearch, calculatedLimit, finalLimit }, 'Dynamic search limit calculated')
          return finalLimit
        })(),
        library_papers_used: config.libraryPaperIds || [],
        length: config.length,
        paperType: config.paperType,
        useLibraryOnly: config.useLibraryOnly || false,
        localRegion: undefined
      },
      // Pass recency profile from paper profile
      recencyProfile: paperProfile.sourceExpectations.recencyProfile,
      // Pass explicit search year range from paper profile (AI-determined based on topic)
      searchYearRange: paperProfile.sourceExpectations.searchYearRange,
      // Pass discipline for API-level filtering to ensure sources are from the right field
      discipline: paperProfile.discipline.primary
    }

    const discoveryResult = await collectPapers(discoveryOptions)
    const allPapers = discoveryResult.papers
    const translationResult = discoveryResult.translation
    
    // If topic was translated, update profile with output language
    if (translationResult?.wasTranslated) {
      paperProfile.outputLanguage = translationResult.outputLanguage
      info({
        originalLanguage: translationResult.outputLanguage,
        originalTopic: translationResult.originalTopic.slice(0, 50),
        searchTopic: translationResult.searchTopic.slice(0, 50)
      }, `Paper will be generated in ${translationResult.outputLanguage}`)
    }
    
    // Check cancellation after paper discovery
    checkCancellation('paper discovery')
    
    if (allPapers.length === 0) {
      throw new Error('No papers found for the given topic')
    }
    
    // Profile-driven source availability check
    // Calculate how many papers likely have usable content (not just abstracts)
    // We'll get more accurate numbers later in prompt-builder, but this provides early warning
    const minRequiredSources = paperProfile.sourceExpectations.minimumUniqueSources
    const availablePapers = allPapers.length
    
    // Critical threshold: if we have fewer papers than 50% of minimum required, warn but continue
    // This avoids a hardwall while still signaling reduced source diversity
    const criticalThreshold = Math.ceil(minRequiredSources * 0.5)
    
    if (availablePapers < criticalThreshold) {
      warn({
        availablePapers,
        minRequiredSources,
        criticalThreshold,
        paperType: paperProfile.paperType,
        discipline: paperProfile.discipline.primary
      }, `Source availability far below recommended minimum (${availablePapers}/${minRequiredSources}). Paper quality may be significantly affected.`)
      
      onProgress?.('search', 16, 'Fewer sources than ideal — proceeding with what we found', {
        papersFound: availablePapers,
        minRequired: minRequiredSources,
        criticalThreshold,
        warning: 'Paper may have very limited citation diversity'
      })
    }
    
    // Warning threshold: if below minimum but above critical, warn but continue
    if (availablePapers < minRequiredSources) {
      warn({
        availablePapers,
        minRequiredSources,
        paperType: paperProfile.paperType,
        discipline: paperProfile.discipline.primary
      }, `Source availability below recommended minimum (${availablePapers}/${minRequiredSources}). Paper quality may be affected.`)
      
      onProgress?.('search', 18, 'Sources collected — making the most of them', {
        papersFound: availablePapers,
        minRequired: minRequiredSources,
        warning: 'Paper may have limited citation diversity'
      })
    }
    
    metrics.paperDiscoveryDuration = Date.now() - discoveryStartTime
    
    const totalUploaded = config.libraryPaperIds?.length || 0
    const onlineCount = allPapers.length - totalUploaded
    const sourcesMessage = `${allPapers.length} sources collected`
    
    onProgress?.('search', 22, sourcesMessage, {
      papersFound: allPapers.length,
      uploadedPapers: totalUploaded,
      onlinePapers: onlineCount,
      minRequiredByProfile: minRequiredSources,
      durationMs: metrics.paperDiscoveryDuration,
      phase: 'complete'
    })

    // Step 3: Planning (Theme Extraction + Outline Generation)
    // Use hybrid extraction: structured findings + cross-document analysis
    const themeStartTime = Date.now()
    onProgress?.('planning', 25, 'Extracting key findings...')
    
    let analysisResult: AnalysisResult | undefined
    let hybridResult: HybridThemeExtractionResult | undefined
    let enhancedProfile = paperProfile
    
    try {
      // Use new hybrid extraction: extracts structured findings then analyzes patterns
      hybridResult = await extractThemesHybrid(
        allPapers,
        sanitizedTopic,
        paperProfile,
        (message, details) => {
          // Forward progress updates
          onProgress?.('planning', 27, message, details)
        }
      )
      
      analysisResult = hybridResult.analysisResult
      const analysisReadinessIssue = getAnalysisReadinessIssue(analysisResult)
      if (analysisReadinessIssue) {
        warn({ analysisReadinessIssue }, 'Analysis incomplete; continuing with RAG-only generation path')
        hybridResult = undefined
      } else {
        // Merge cross-document signals into the profile
        enhancedProfile = mergeAnalysisResultIntoProfile(paperProfile, analysisResult)
      }
      
      metrics.themeExtractionDuration = Date.now() - themeStartTime

      if (hybridResult) {
        info({
          patterns: analysisResult.patterns.length,
          contradictions: analysisResult.contradictions.length,
          gaps: analysisResult.gaps.length,
          papersExtracted: hybridResult.extractionStats.papersExtracted,
          papersFromCache: hybridResult.extractionStats.papersFromCache,
          totalFindings: hybridResult.extractionStats.totalFindings
        }, 'Hybrid theme extraction completed')
        
        onProgress?.('planning', 30, 'Research patterns mapped', {
          patternsFound: analysisResult.patterns.length,
          contradictionsFound: analysisResult.contradictions.length,
          gapsFound: analysisResult.gaps.length,
          findingsExtracted: hybridResult.extractionStats.totalFindings,
          durationMs: metrics.themeExtractionDuration,
          phase: 'themes_complete'
        })
      } else {
        onProgress?.('planning', 30, 'Structuring your paper...', {
          durationMs: metrics.themeExtractionDuration,
          phase: 'themes_incomplete'
        })
      }
    } catch (hybridError) {
      // Hybrid extraction failed - continue without themes
      // Legacy extractThemes has been removed in favor of hybrid approach
      metrics.themeExtractionDuration = Date.now() - themeStartTime
      warn({ error: hybridError }, 'Hybrid extraction failed, continuing without theme enrichment')
      onProgress?.('planning', 30, 'Structuring your paper...', {
        phase: 'outline_start',
        warning: 'Theme extraction failed'
      })
    }

    // Check cancellation after theme extraction
    checkCancellation('theme extraction')

    // Continue planning: Use outline from paper profile
    const outlineStartTime = Date.now()
    
    const allPaperIds = allPapers.map(p => p.id)
    
    // Validate profile outline exists
    if (!enhancedProfile.outline || !enhancedProfile.outline.sections || enhancedProfile.outline.sections.length === 0) {
      const msg = 'Paper profile was generated without an outline. This should not happen — the profile prompt requires an outline.'
      logError({ paperType: config.paperType, topic: sanitizedTopic.slice(0, 100) }, msg)
      throw new Error(msg)
    }
    
    info({
      source: 'paper-profile',
      sections: enhancedProfile.outline.sections.length,
      totalWords: enhancedProfile.outline.totalEstimatedWords,
      subsections: enhancedProfile.outline.sections.reduce((sum, s) => sum + (s.subsections?.length || 0), 0)
    }, 'Using outline from paper profile')
    
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
    
    metrics.outlineGenerationDuration = Date.now() - outlineStartTime
    
    // Build section names for display
    const sectionNames = typedOutline.sections.map(s => s.title).join(', ')
    onProgress?.('planning', 38, 'Structure ready', {
      sectionsPlanned: typedOutline.sections.length,
      sectionNames,
      durationMs: metrics.outlineGenerationDuration,
      phase: 'outline_complete'
    })

    // Step 4: Write Paper (Hybrid Enrichment + RAG + Generation)
    // Build enriched contexts with synthesis data + RAG chunks
    const contextStartTime = Date.now()
    
    let sectionContexts: SectionContext[] | EnrichedSectionContext[]
    
    const totalFindings = hybridResult?.extractionStats.totalFindings || 0
    const usingSynthesisEnrichment = hybridResult && totalFindings >= SYNTHESIS_FINDINGS_THRESHOLD
    
    info({
      stage: 'synthesis-pipeline',
      step: 'path-decision',
      extraction: {
        hasHybridResult: !!hybridResult,
        totalFindings,
        papersProcessed: hybridResult?.extractionStats.papersProcessed || 0,
        papersExtracted: hybridResult?.extractionStats.papersExtracted || 0,
        threshold: SYNTHESIS_FINDINGS_THRESHOLD
      },
      decision: {
        usingSynthesisEnrichment,
        reason: !hybridResult 
          ? 'no hybrid extraction result' 
          : totalFindings < SYNTHESIS_FINDINGS_THRESHOLD 
            ? `findings (${totalFindings}) below threshold (${SYNTHESIS_FINDINGS_THRESHOLD})`
            : `findings (${totalFindings}) meets threshold (${SYNTHESIS_FINDINGS_THRESHOLD})`
      },
      analysisStats: hybridResult ? {
        patterns: hybridResult.analysisResult.patterns.length,
        contradictions: hybridResult.analysisResult.contradictions.length,
        gaps: hybridResult.analysisResult.gaps.length
      } : null
    }, `Synthesis pipeline: ${usingSynthesisEnrichment ? 'USING synthesis enrichment' : 'SKIPPING to RAG-only'}`)
    
    if (!usingSynthesisEnrichment && hybridResult) {
      warn({
        stage: 'synthesis-pipeline',
        issue: 'below-threshold',
        totalFindings,
        threshold: SYNTHESIS_FINDINGS_THRESHOLD
      }, `⚠️ Only ${totalFindings} findings extracted - synthesis enrichment disabled (need ${SYNTHESIS_FINDINGS_THRESHOLD}+)`)
    }
    
    // Try hybrid enrichment if we have analysis results
    // Note: usingSynthesisEnrichment is only true when hybridResult exists
    if (usingSynthesisEnrichment && hybridResult) {
      onProgress?.('writing', 40, 'Connecting ideas across sources...')
      
      try {
        sectionContexts = await enrichAndBuildContexts(
          typedOutline,
          hybridResult,
          enhancedProfile,
          allPapers,
          sanitizedTopic
        )
        
        const enrichedCount = sectionContexts.filter(
          s => (s as EnrichedSectionContext).hasSynthesisEnrichment
        ).length
        
        info({
          totalSections: sectionContexts.length,
          enrichedSections: enrichedCount,
          totalPatterns: sectionContexts.reduce((sum, s) => 
            sum + ((s as EnrichedSectionContext).synthesisContent?.patterns.length || 0), 0)
        }, 'Hybrid enriched contexts built')
        
        onProgress?.('writing', 45, 'Sections enriched with insights', {
          sectionsWithContext: sectionContexts.length,
          enrichedSections: enrichedCount,
          durationMs: Date.now() - contextStartTime
        })
        
      } catch (enrichError) {
        // Fallback to standard RAG-only contexts
        warn({ error: enrichError }, 'Hybrid enrichment failed, falling back to RAG-only')
        onProgress?.('writing', 40, 'Matching evidence to sections...')
        sectionContexts = await GenerationContextService.buildContexts(
          typedOutline,
          sanitizedTopic,
          allPapers
        )
      }
    } else {
      // Not enough findings for hybrid, use RAG-only
      onProgress?.('writing', 40, 'Matching evidence to sections...')
      sectionContexts = await GenerationContextService.buildContexts(
        typedOutline,
        sanitizedTopic,
        allPapers
      )
    }
    
    metrics.contextBuildingDuration = Date.now() - contextStartTime
    
    // Calculate PDF stats from section contexts
    const allChunkCounts = sectionContexts.map(ctx => ctx.contextChunks?.length || 0)
    const totalChunks = allChunkCounts.reduce((a, b) => a + b, 0)
    metrics.pdfStats.avgChunksPerPaper = allPapers.length > 0 ? totalChunks / allPapers.length : 0
    
    onProgress?.('writing', 48, 'Evidence gathered — writing soon', {
      sectionsWithContext: sectionContexts.length,
      durationMs: metrics.contextBuildingDuration,
      avgChunksPerSection: totalChunks / sectionContexts.length
    })

    // Check cancellation before content generation (the longest phase)
    checkCancellation('context building')

    // Generate Content
    const generationStartTime = Date.now()
    
    let completedSections = 0
    let fullContent = ''
    const allCitations: StructuredCitation[] = []
    
    // Compute per-section token allocation based on target word count
    // Each section's expectedWords determines its token budget
    // Rule of thumb: 1 word ≈ 1.5 tokens for content + ~40% overhead for structured output JSON (citations with quotes)
    const sectionCount = Math.max(1, sectionContexts.length)
    const perSectionTokens = Math.max(2000, Math.round(
      ((typedOutline.totalEstimatedWords || 10000) / sectionCount) * 1.5 * 1.4
    ))

    // Generate all sections using unified template
    const outlineTreeText = typedOutline.sections.map(s => `• ${s.title}`).join('\n')
    
    // Build profile guidance for prompts
    const profileGuidance = buildProfileGuidanceForPrompt(paperProfile)
    
    const results = await generateMultipleSectionsUnified(
      sectionContexts,
      {
        temperature: config.temperature || 0.2,
        maxTokens: perSectionTokens,
        outlineTree: outlineTreeText,
        // Pass project context for better prompts
        topic: sanitizedTopic,
        paperType: config.paperType,
        projectTitle: sanitizedTopic,
        // Pass original research context if available
        originalResearch: config.originalResearch?.has_original_research ? {
          hasOriginalResearch: true,
          researchQuestion: config.originalResearch.research_question,
          keyFindings: config.originalResearch.key_findings
        } : undefined,
        // Pass paper profile guidance for contextual intelligence
        profileGuidance,
        // Pass voice configuration for authorial persona variation
        voiceConfig: paperProfile.voice,
        // Pass quality criteria from profile - eliminates per-section LLM calls
        profileCriteria: paperProfile.qualityCriteria,
        customInstructions: config.customInstructions,
        // Pass output language for non-English papers
        outputLanguage: paperProfile.outputLanguage
      },
      // Progress callback - called when section starts
      (completed, total, currentSection) => {
        const progress = Math.round((completed / total) * 35) + 50 // 50-85%
        onProgress?.('writing', progress, `Writing: ${currentSection}`)
      },
      // Section complete callback - sends content for live preview
      (sectionTitle, content, sectionIndex, total) => {
        const progress = Math.round((sectionIndex / total) * 35) + 50 // 50-85%
        onProgress?.('writing', progress, `Finished: ${sectionTitle}`, {
          sectionComplete: true,
          sectionTitle,
          sectionContent: content,
          sectionIndex,
          totalSections: total
        })
      },
      // Streaming callback - called with each chunk as it streams
      (sectionTitle, chunk, fullContentSoFar) => {
        // Send streaming content for live preview
        onProgress?.('writing', -1, `Writing: ${sectionTitle}`, {
          streaming: true,
          sectionTitle,
          streamingChunk: chunk,
          streamingContent: fullContentSoFar
        })
      }
    )

    // Step 5: Finishing (Quality Checks + Save)
    metrics.sectionGenerationDuration = Date.now() - generationStartTime
    const qualityStartTime = Date.now()
    onProgress?.('finishing', 88, 'Reviewing for completeness...')
    
    let totalQualityScore = 0
    
    for (let i = 0; i < results.length; i++) {
      // Check cancellation at each section in quality loop
      checkCancellation(`quality check for section ${i + 1}`)
      
      const sectionQualityStart = Date.now()
      let result = results[i]
      const sectionContext = sectionContexts[i]
      let wasRewritten = false
      let rewriteReason: 'citation_verification' | undefined
      
      // NOTE: Evidence tracking removed to allow all sections access to all chunks
      // Previously, trackBulkUsage() marked chunks as "used" after each section,
      // which caused later sections to have 0 available chunks.
      // Now all sections can cite from the full evidence pool.
      
      // Log citation feedback for RAG improvement (non-blocking)
      // This tracks which chunks were actually cited to improve future retrieval
      if (sectionContext.contextChunks && sectionContext.contextChunks.length > 0) {
        logSectionCitations(
          projectId,
          sectionContext.sectionKey,
          result.content,
          sectionContext.contextChunks,
          sectionContext.title,
          result.citations  // Pass structured citations for reliable extraction
        ).catch(err => {
          // Non-critical - don't fail pipeline on feedback logging errors
          warn({ section: sectionContext.title, error: err }, 'Citation feedback logging failed')
        })
      }
      
      // Single hard quality gate: citation verification.
      try {
        const { verifySectionCitations, buildCitationFeedback } = await import('@/lib/quality/citation-verifier')
        const citationReport = await verifySectionCitations(
          sectionContext.title,
          result.content,
          sectionContext.contextChunks || [],
          result.citations  // Pass structured citations for numbered marker mapping
        )
        
        metrics.citationStats.sectionsVerified++
        
        if (!citationReport.passed && citationReport.totalCitations > 0) {
          metrics.citationStats.sectionsFailed++

          // Determine severity (only severe failures trigger regeneration)
          const severeByScore = citationReport.score < 0.4
          const severeByZeroVerified = citationReport.verifiedCitations === 0
          const severeByMissingEvidence = citationReport.failedCitations.some(f =>
            f.issue?.toLowerCase().includes('no content available from cited paper')
          )
          const isSevere = severeByScore || severeByZeroVerified || severeByMissingEvidence

          warn(
            {
              section: sectionContext.title,
              verified: citationReport.verifiedCitations,
              failed: citationReport.failedCitations.length,
              score: (citationReport.score * 100).toFixed(0) + '%',
              severe: isSevere
            },
            isSevere
              ? 'Citation verification failed (severe) - regenerating section'
              : 'Citation verification failed (non-severe) - keeping section'
          )

          // Max one rewrite per section.
          if (isSevere && !wasRewritten) {
            // Build feedback about which citations failed
            const citationFeedback = buildCitationFeedback(citationReport)

            // Regenerate ONCE with citation feedback (no multi-pass loops)
            try {
              metrics.citationStats.regenerationsTriggered++
              wasRewritten = true
              rewriteReason = 'citation_verification'

              const { generateWithUnifiedTemplate } = await import('@/lib/generation/unified-generator')
              const regenerated = await generateWithUnifiedTemplate({
                context: sectionContext,
                options: {
                  temperature: config.temperature || 0.2,
                  maxTokens: perSectionTokens,
                  forceRewrite: true,
                  rewriteText: result.content,
                  previousSectionsSummary: citationFeedback,
                  outlineTree: typedOutline.sections.map(s => `• ${s.title}`).join('\n'),
                  // Preserve profile guidance during rewrite to maintain paper type rules
                  profileGuidance,
                  paperType: config.paperType,
                  topic: sanitizedTopic,
                  // Preserve voice configuration during rewrite for consistent authorial persona
                  voiceConfig: paperProfile.voice,
                  // Pass quality criteria from profile
                  profileCriteria: paperProfile.qualityCriteria,
                  customInstructions: config.customInstructions
                }
              })

              // Re-verify regenerated content (single recheck; no further regen)
              // Pass regenerated.citations to enable numbered marker mapping
              const recheck = await verifySectionCitations(
                sectionContext.title,
                regenerated.content,
                sectionContext.contextChunks || [],
                regenerated.citations
              )

              if (recheck.passed || recheck.score > citationReport.score) {
                result = regenerated
                info(
                  { section: sectionContext.title, newScore: (recheck.score * 100).toFixed(0) + '%' },
                  'Section regenerated with improved citations'
                )
              } else {
                warn({ section: sectionContext.title }, 'Citation regeneration did not improve - keeping original')
              }
            } catch (regenError) {
              warn({ section: sectionContext.title, error: regenError }, 'Citation-based regeneration failed')
            }
          }
        }
        
        // Quality score follows citation integrity directly.
        totalQualityScore += citationReport.score * 100
      } catch (err) {
        // Don't fail pipeline on citation verification errors
        warn({ section: sectionContext.title, error: err }, 'Citation verification failed')
        totalQualityScore += 60
      }
      
      // Verify section has proper markdown heading (prompt now instructs AI to include it)
      let sectionContent = result.content.trim()
      const sectionTitle = sectionContext.title
      
      // Check if content starts with a markdown heading
      const startsWithHeading = /^##?\s+\w/.test(sectionContent)
      
      if (!startsWithHeading && sectionTitle) {
        // Fallback: Add section heading if AI didn't include it
        const isSubsection = sectionContext.sectionKey?.toString().includes('.')
        const headingLevel = isSubsection ? '###' : '##'
        sectionContent = `${headingLevel} ${sectionTitle}\n\n${sectionContent}`
        warn({ section: sectionTitle }, 'AI did not include section heading - added automatically')
      }
      
      fullContent += sectionContent + '\n\n'
      allCitations.push(...result.citations)
      completedSections++
      
      // Track section timing for metrics
      metrics.sectionTimings.push({
        title: sectionContext.title,
        generationMs: 0, // Generation time is tracked at unified-generator level
        qualityCheckMs: Date.now() - sectionQualityStart,
        wasRewritten,
        rewriteReason
      })
      
      // INCREMENTAL SAVE: Checkpoint after each section completes
      // This allows partial recovery if generation is interrupted (network drop, tab closed)
      // Note: This saves raw content without citation processing - final save handles that
      try {
        await savePartialContent(projectId, fullContent.trim(), completedSections)
      } catch (saveErr) {
        // Non-fatal - log and continue
        warn({ section: sectionContext.title, error: saveErr }, 'Partial save failed')
      }
    }
    
    metrics.qualityCheckDuration = Date.now() - qualityStartTime
    
    const avgQualityScore = results.length > 0 ? totalQualityScore / results.length : 0
    
    // Paper type validation - use profile-based validation for contextual accuracy
    const validPaperIdsForValidation = new Set(allPapers.map(p => p.id))
    const citedPaperIdsForValidation = Array.from(
      new Set(allCitations.map(c => c.paperId).filter(id => validPaperIdsForValidation.has(id)))
    )
    const profileValidation = validatePaperWithProfile(fullContent, paperProfile, citedPaperIdsForValidation)
    
    if (!profileValidation.valid) {
      warn({ 
        paperType: config.paperType, 
        discipline: paperProfile.discipline.primary,
        issues: profileValidation.issues 
      }, 'Profile-based validation issues detected')
    }
    
    if (profileValidation.warnings.length > 0) {
      info({ warnings: profileValidation.warnings }, 'Profile validation warnings')
    }
    
    // Log section and citation analysis for debugging
    info({
      foundSections: profileValidation.sectionAnalysis.found,
      missingSections: profileValidation.sectionAnalysis.missing,
      uniqueSources: profileValidation.citationAnalysis.uniqueSourceCount,
      requiredSources: profileValidation.citationAnalysis.minimumRequired,
      citationsAdequate: profileValidation.citationAnalysis.adequate,
      validationScore: profileValidation.score
    }, 'Paper profile validation analysis')
    
    onProgress?.('finishing', 92, 'Saving your paper...')
    
    // Clean non-citation artifacts (leaked tool syntax, etc.)
    const { cleanNonCitationArtifacts } = await import('@/lib/citations/post-processor')
    fullContent = cleanNonCitationArtifacts(fullContent)
    
    // VALIDATION: Create set of valid paper IDs to filter out hallucinated citations
    const validPaperIds = new Set(allPapers.map(p => p.id))
    
    // Convert numbered [1], [2] markers to [@paperId#instanceId] format
    // This also validates paper IDs and generates instances for the database
    const { 
      content: processedContent, 
      instances: citationInstances, 
      invalidCitations,
      stats: conversionStats
    } = convertNumberedCitationsToStorage(fullContent, allCitations, validPaperIds)
    fullContent = processedContent
    
    // Log warnings for invalid citations (hallucinated or malformed paper IDs)
    if (invalidCitations.length > 0) {
      warn({
        invalidCount: invalidCitations.length,
        totalCitations: allCitations.length,
        invalidIds: invalidCitations.slice(0, 5).map(c => c.paperId),
      }, 'Filtered out citations with invalid/hallucinated paper IDs')
    }
    
    // Log conversion stats if there were quote reuse or orphan issues
    if (conversionStats.quotesReused > 0 || conversionStats.orphanMarkersRemoved > 0) {
      warn({
        markersConverted: conversionStats.markersConverted,
        quotesReused: conversionStats.quotesReused,
        orphanMarkersRemoved: conversionStats.orphanMarkersRemoved,
      }, 'Citation conversion had quality issues - LLM may need prompt improvements')
    }
    
    // Build citations map for project_citations table (deduplicated by paperId)
    const citedPaperIds = new Set(citationInstances.map(c => c.paperId))
    const citationsMap: Record<string, { paperId: string; citationText: string }> = {}
    
    for (const paperId of citedPaperIds) {
      const key = `cite-${paperId}`
      citationsMap[key] = {
        paperId,
        citationText: `[@${paperId}]`
      }
    }
    
    info({ 
      validCitations: citedPaperIds.size,
      invalidCitations: invalidCitations.length,
      totalGenerated: allCitations.length,
      instancesCreated: citationInstances.length
    }, 'Citations validated and converted to storage format')
    
    // Save content with converted citations
    await updateProjectContent(projectId, fullContent.trim(), citationsMap)
    
    // Save citation instances for hover quote previews
    if (citationInstances.length > 0) {
      try {
        const supabase = getServiceClient()
        const { error: instancesError } = await supabase
          .from('citation_instances')
          .upsert(
            citationInstances.map(inst => ({
              id: inst.instanceId,
              paper_id: inst.paperId,
              project_id: projectId,
              quote: inst.quote,
            })),
            { onConflict: 'id' }
          )
        
        if (instancesError) {
          // Non-fatal - log and continue
          warn({ error: instancesError }, 'Failed to save citation instances')
        } else {
          info({ count: citationInstances.length }, 'Citation instances saved for hover previews')
        }
      } catch (err) {
        warn({ error: err }, 'Failed to save citation instances')
      }
    }
    
    // Finalize metrics
    metrics.totalDuration = Date.now() - startTime
    
    // Log comprehensive performance metrics for bottleneck analysis
    info({
      totalDurationMs: metrics.totalDuration,
      paperDiscoveryMs: metrics.paperDiscoveryDuration,
      themeExtractionMs: metrics.themeExtractionDuration,
      outlineGenerationMs: metrics.outlineGenerationDuration,
      contextBuildingMs: metrics.contextBuildingDuration,
      sectionGenerationMs: metrics.sectionGenerationDuration,
      qualityCheckMs: metrics.qualityCheckDuration,
      overlapStats: {
        checked: metrics.overlapStats.sectionsChecked,
        exceededThreshold: metrics.overlapStats.sectionsExceedingThreshold,
        rewrites: metrics.overlapStats.rewritesTriggered,
        avgOverlap: (metrics.overlapStats.avgOverlapRatio * 100).toFixed(1) + '%',
        maxOverlap: (metrics.overlapStats.maxOverlapRatio * 100).toFixed(1) + '%'
      },
      citationStats: {
        verified: metrics.citationStats.sectionsVerified,
        failed: metrics.citationStats.sectionsFailed,
        regenerations: metrics.citationStats.regenerationsTriggered
      },
      sectionsRewritten: metrics.sectionTimings.filter(s => s.wasRewritten).length,
      totalSections: metrics.sectionTimings.length
    }, 'Pipeline performance metrics')
    
    onProgress?.('complete', 100, 'Your paper is ready!', {
      totalWords: fullContent.split(' ').length,
      qualityScore: avgQualityScore,
      performanceMetrics: metrics
    })

    return {
      content: fullContent.trim(),
      outline: typedOutline,
      sections: sectionContexts,
      citations: citationsMap,
      citationInstances,  // For hover quote previews
      profile: enhancedProfile,  // Return the enhanced profile with emergent themes
      analysisResult,            // Include analysis result for transparency
      metrics: {
        papersUsed: allPapers.length,
        sectionsGenerated: completedSections,
        totalWords: fullContent.split(' ').length,
        qualityScore: avgQualityScore,
        generationTime: (Date.now() - startTime) / 1000
      },
      performanceMetrics: metrics
    }

  } catch (err) {
    logError({ error: err }, 'Pipeline error')

    // Classify error for better reporting
    const classified = classifyError(err)
    logError({ category: classified.category, message: classified.userMessage }, 'Pipeline failed')
    
    // Update project status to failed
    await updateResearchProjectStatus(projectId, 'failed' as PaperStatus)
    
    // Re-throw the classified error for better handling upstream
    throw classified
  }
}


