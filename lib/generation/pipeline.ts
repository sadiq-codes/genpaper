import 'server-only'
import { updateProjectContent, updateResearchProjectStatus, updateProjectVoiceProfile, savePartialContent } from '@/lib/db/research'
import { collectPapers } from '@/lib/generation/discovery'
import { generateOutline, type OriginalResearchInput } from '@/lib/prompts/generators'
import { generateMultipleSectionsUnified } from '@/lib/generation/unified-generator'
import { GenerationContextService } from '@/lib/rag/generation-context'
import { SectionReviewer } from '@/lib/quality/section-reviewer'
// Legacy validatePaperType removed - using profile-based validation only
import { fourGramOverlapRatio } from '@/lib/utils/overlap'
import { EvidenceTracker } from '@/lib/services/evidence-tracker'
import { sanitizeTopic } from '@/lib/utils/prompt-safety'
import { classifyError, CancellationError } from '@/lib/generation/errors'
import { warn, error as logError, info } from '@/lib/utils/logger'
// Citation markers [CITE: paper_id] are kept in markdown - UI renders them
// We only need cleanRemainingArtifacts to remove any leaked tool syntax
import { generatePaperProfile, validatePaperWithProfile, buildProfileGuidanceForPrompt } from '@/lib/generation/paper-profile'
import { logSectionCitations } from '@/lib/rag/relevance-feedback'
import { extractThemes, mergeThemeAnalysisIntoProfile, buildThemeGuidanceForOutline } from '@/lib/generation/theme-extraction'
import { getServiceClient } from '@/lib/supabase/service'
import type { PaperProfile, ThemeAnalysis } from '@/lib/generation/paper-profile-types'
import type { PaperStatus, OriginalResearchConfig, PaperTypeKey as SimplifiedPaperTypeKey } from '@/types/simplified'
import { PAPER_TYPE_SEARCH_MULTIPLIERS, PAPER_TYPE_MIN_SEARCH } from '@/types/simplified'
import type { GeneratedOutline, SectionContext, PaperTypeKey } from '@/lib/prompts/types'
import type { EnhancedGenerationOptions } from '@/lib/generation/types'

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
    rewriteReason?: 'overlap' | 'citation_verification'
  }>
  
  // Overlap detection stats
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
  length: 'short' | 'medium' | 'long'
  
  // Optional
  useLibraryOnly?: boolean
  libraryPaperIds?: string[]
  sources?: string[]
  temperature?: number
  maxTokens?: number
  
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
  /** The generated paper profile that guided generation */
  profile: PaperProfile
  /** Theme analysis from collected papers (Scribbr-aligned approach) */
  themeAnalysis?: ThemeAnalysis
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
 * 2. Ingestion: ensureBulkContentIngestion() (handled within collectPapers)
 * 3. RAG: GenerationContextService.buildContexts()
 * 4. Generation: generateMultipleSectionsUnified()
 * 5. Quality: comprehensive overlap check + SectionReviewer + evidence tracking
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
  
  onProgress?.('initialization', 0, 'Starting paper generation pipeline...')
  
  // Sanitize user input to prevent prompt injection
  const sanitizedTopic = sanitizeTopic(config.topic)
  if (sanitizedTopic !== config.topic) {
    warn({ original: config.topic.slice(0, 100), sanitized: sanitizedTopic.slice(0, 100) }, 'Topic was sanitized for safety')
  }
  
  // Set project status to generating
  await updateResearchProjectStatus(projectId, 'generating' as PaperStatus)
  
  // Set up evidence tracking with database persistence
  EvidenceTracker.setProject(projectId)
  await EvidenceTracker.loadFromDatabase(projectId)

  try {
    // Step 1: Generate Paper Profile (contextual intelligence)
    // This MUST happen first to determine search parameters
    onProgress?.('profiling', 2, 'Analyzing your topic...', {
      topic: sanitizedTopic.slice(0, 50)
    })
    
    const paperProfile = await generatePaperProfile({
      topic: sanitizedTopic,
      paperType: config.paperType,
      hasOriginalResearch: config.originalResearch?.has_original_research,
      userContext: undefined  // Could be extended to accept user context
    })
    
    info({
      discipline: paperProfile.discipline.primary,
      sections: paperProfile.structure.appropriateSections.map(s => s.key),
      inappropriateSections: paperProfile.structure.inappropriateSections.map(s => s.name),
      minSources: paperProfile.sourceExpectations.minimumUniqueSources,
      recencyProfile: paperProfile.sourceExpectations.recencyProfile
    }, 'Paper profile generated')
    
    onProgress?.('profiling', 8, `Identified as ${paperProfile.discipline.primary} research`, {
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
      onProgress?.('search', 10, `Processing ${uploadedCount} uploaded paper${uploadedCount > 1 ? 's' : ''}...`, {
        uploadedPapers: uploadedCount,
        phase: 'processing_uploads'
      })
      
      try {
        const { processMultiplePapers } = await import('@/lib/content/background-processor')
        const processingResults = await processMultiplePapers(config.libraryPaperIds!)
        
        const successful = processingResults.filter(r => r.status === 'processed').length
        const failed = processingResults.filter(r => r.status === 'failed').length
        
        if (failed > 0) {
          warn({ 
            successful, 
            failed, 
            failedIds: processingResults.filter(r => r.status === 'failed').map(r => r.paperId)
          }, 'Some papers failed to process')
        }
        
        info({ successful, failed, total: uploadedCount }, 'Uploaded paper processing completed')
        
        onProgress?.('search', 15, `Processed ${successful} uploaded paper${successful > 1 ? 's' : ''}`, {
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
      onProgress?.('search', 18, 'Searching online databases...', { 
        phase: 'searching_online',
        recencyProfile: paperProfile.sourceExpectations.recencyProfile
      })
    } else {
      onProgress?.('search', 18, 'Using only your uploaded papers...', {
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

    const allPapers = await collectPapers(discoveryOptions)
    
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
      
      onProgress?.('search', 16, `⚠️ Very limited sources: ${availablePapers} papers found, ${minRequiredSources} recommended`, {
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
      
      onProgress?.('search', 18, `⚠️ Limited source availability: ${availablePapers} papers found, ${minRequiredSources} recommended`, {
        papersFound: availablePapers,
        minRequired: minRequiredSources,
        warning: 'Paper may have limited citation diversity'
      })
    }
    
    metrics.paperDiscoveryDuration = Date.now() - discoveryStartTime
    
    // Build a descriptive message about sources found
    const totalUploaded = config.libraryPaperIds?.length || 0
    const onlineCount = allPapers.length - totalUploaded
    let sourcesMessage = `Found ${allPapers.length} papers`
    if (totalUploaded > 0 && onlineCount > 0) {
      sourcesMessage = `Ready: ${totalUploaded} uploaded + ${onlineCount} online = ${allPapers.length} papers`
    } else if (totalUploaded > 0) {
      sourcesMessage = `Ready: ${totalUploaded} uploaded paper${totalUploaded > 1 ? 's' : ''}`
    } else {
      sourcesMessage = `Found ${allPapers.length} relevant papers online`
    }
    
    onProgress?.('search', 22, sourcesMessage, {
      papersFound: allPapers.length,
      uploadedPapers: totalUploaded,
      onlinePapers: onlineCount,
      minRequiredByProfile: minRequiredSources,
      durationMs: metrics.paperDiscoveryDuration,
      phase: 'complete'
    })

    // Step 3: Planning (Theme Extraction + Outline Generation)
    // Analyze collected papers to identify emergent themes, then create outline
    const themeStartTime = Date.now()
    onProgress?.('planning', 25, 'Analyzing themes in the literature...')
    
    let themeAnalysis: ThemeAnalysis | undefined
    let enhancedProfile = paperProfile
    
    try {
      themeAnalysis = await extractThemes(allPapers, sanitizedTopic, paperProfile)
      
      // Merge emergent themes into the profile
      enhancedProfile = mergeThemeAnalysisIntoProfile(paperProfile, themeAnalysis)
      
      info({
        emergentThemes: themeAnalysis.emergentThemes.length,
        debates: themeAnalysis.debates.length,
        gaps: themeAnalysis.gaps.length,
        pivotalPapers: themeAnalysis.pivotalPapers.length,
        suggestedOrganization: themeAnalysis.organizationSuggestion.approach,
        confidence: themeAnalysis.confidence
      }, 'Theme extraction completed')
      
      metrics.themeExtractionDuration = Date.now() - themeStartTime
      
      onProgress?.('planning', 30, `Found ${themeAnalysis.emergentThemes.length} themes, creating outline...`, {
        themesFound: themeAnalysis.emergentThemes.length,
        debatesFound: themeAnalysis.debates.length,
        gapsFound: themeAnalysis.gaps.length,
        suggestedOrganization: themeAnalysis.organizationSuggestion.approach,
        durationMs: metrics.themeExtractionDuration,
        phase: 'themes_complete'
      })
    } catch (themeError) {
      metrics.themeExtractionDuration = Date.now() - themeStartTime
      // Theme extraction is an enhancement - don't fail the pipeline if it fails
      warn({ error: themeError }, 'Theme extraction failed, continuing with original profile')
      onProgress?.('planning', 30, 'Creating paper outline...', {
        phase: 'outline_start'
      })
    }

    // Check cancellation after theme extraction
    checkCancellation('theme extraction')

    // Continue planning: Generate Outline (now with theme-informed profile)
    const outlineStartTime = Date.now()
    
    // Limit paper IDs passed to outline generation to prevent token overflow
    // The outline only needs representative papers - full paper list is used during RAG
    const MAX_PAPERS_FOR_OUTLINE = 50
    const allPaperIds = allPapers.map(p => p.id)
    const outlinePaperIds = allPaperIds.slice(0, MAX_PAPERS_FOR_OUTLINE)
    
    if (allPaperIds.length > MAX_PAPERS_FOR_OUTLINE) {
      info({
        totalPapers: allPaperIds.length,
        usedForOutline: MAX_PAPERS_FOR_OUTLINE
      }, 'Limiting papers for outline generation to prevent token overflow')
    }
    
    // Build original research input if available
    const originalResearchInput: OriginalResearchInput | undefined = 
      config.originalResearch?.has_original_research ? {
        researchQuestion: config.originalResearch.research_question,
        keyFindings: config.originalResearch.key_findings
      } : undefined
    
    // Build theme guidance for outline generation
    const themeGuidance = themeAnalysis ? buildThemeGuidanceForOutline(themeAnalysis) : undefined
    
    const rawOutline = await generateOutline(
      config.paperType,
      sanitizedTopic,
      outlinePaperIds,  // Use limited paper IDs for outline (prevents token overflow)
      originalResearchInput,
      enhancedProfile,  // Use the enhanced profile with emergent themes
      themeGuidance     // Pass theme guidance for better outline structure
    )
    
    // Build properly typed outline
    // Note: The outline generator receives comprehensive profile guidance that tells it
    // exactly which sections are appropriate and which are forbidden for this paper type.
    // The prompts are designed to prevent inappropriate sections from being generated.
    const typedOutline: GeneratedOutline = {
      paperType: config.paperType,
      topic: sanitizedTopic,
      sections: rawOutline.sections.map(section => ({
        ...section,
        sectionKey: section.sectionKey as any // Type assertion for flexibility
      })),
      localRegion: undefined
    }
    
    metrics.outlineGenerationDuration = Date.now() - outlineStartTime
    
    // Build section names for display
    const sectionNames = typedOutline.sections.map(s => s.title).join(', ')
    onProgress?.('planning', 38, `Outline ready: ${typedOutline.sections.length} sections`, {
      sectionsPlanned: typedOutline.sections.length,
      sectionNames,
      durationMs: metrics.outlineGenerationDuration,
      phase: 'outline_complete'
    })

    // Step 4: Write Paper (RAG + Generation combined)
    // First gather evidence, then write each section
    const contextStartTime = Date.now()
    onProgress?.('writing', 40, 'Gathering evidence for each section...')
    
    const sectionContexts = await GenerationContextService.buildContexts(
      typedOutline,
      sanitizedTopic,
      allPapers
    )
    
    metrics.contextBuildingDuration = Date.now() - contextStartTime
    
    // Calculate PDF stats from section contexts
    const allChunkCounts = sectionContexts.map(ctx => ctx.contextChunks?.length || 0)
    const totalChunks = allChunkCounts.reduce((a, b) => a + b, 0)
    metrics.pdfStats.avgChunksPerPaper = allPapers.length > 0 ? totalChunks / allPapers.length : 0
    
    onProgress?.('writing', 45, 'Starting to write sections...', {
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
    const allCitations: Array<{ paperId: string; citationText: string }> = []
    
    // Compute safe per-section token allocation
    const totalMaxTokens = config.maxTokens || 16000
    const sectionCount = Math.max(1, sectionContexts.length)
    const perSectionTokens = Math.max(1000, Math.floor(totalMaxTokens / sectionCount))

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
        voiceConfig: paperProfile.voice
        // Note: minSourcesRequired removed - using semantic citation guidance instead
      },
      // Progress callback - called when section starts
      (completed, total, currentSection) => {
        const progress = Math.round((completed / total) * 35) + 50 // 50-85%
        onProgress?.('writing', progress, `Writing ${currentSection} (${completed + 1}/${total})...`)
      },
      // Section complete callback - sends content for live preview
      (sectionTitle, content, sectionIndex, total) => {
        const progress = Math.round((sectionIndex / total) * 35) + 50 // 50-85%
        onProgress?.('writing', progress, `Completed ${sectionTitle} (${sectionIndex}/${total})`, {
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
        onProgress?.('writing', -1, `Writing ${sectionTitle}...`, {
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
    onProgress?.('finishing', 88, 'Reviewing quality...')
    
    let totalQualityScore = 0
    let qualityIssues: string[] = []
    const OVERLAP_THRESHOLD = 0.22
    
    // Track overlap ratios for metrics
    const overlapRatios: number[] = []
    
    for (let i = 0; i < results.length; i++) {
      // Check cancellation at each section in quality loop
      checkCancellation(`quality check for section ${i + 1}`)
      
      const sectionQualityStart = Date.now()
      let result = results[i]
      const sectionContext = sectionContexts[i]
      let wasRewritten = false
      let rewriteReason: 'overlap' | 'citation_verification' | undefined
      
      // Check cross-section overlap and rewrite if necessary
      const overlap = fourGramOverlapRatio(result.content, fullContent)
      overlapRatios.push(overlap)
      metrics.overlapStats.sectionsChecked++
      
      if (fullContent && overlap > OVERLAP_THRESHOLD) {
        metrics.overlapStats.sectionsExceedingThreshold++
        warn({ section: sectionContext.title, overlap: overlap.toFixed(2) }, 'High overlap detected, triggering rewrite')
        try {
          metrics.overlapStats.rewritesTriggered++
          wasRewritten = true
          rewriteReason = 'overlap'
          const prevSummary = `Avoid repeating earlier content; focus only on new insights for ${sectionContext.title}.`
          const { generateWithUnifiedTemplate } = await import('@/lib/generation/unified-generator')
          result = await generateWithUnifiedTemplate({
            context: sectionContext,
            options: {
              temperature: config.temperature || 0.2,
              maxTokens: perSectionTokens,
              forceRewrite: true,
              rewriteText: result.content,
              previousSectionsSummary: prevSummary,
              outlineTree: typedOutline.sections.map(s => `• ${s.title}`).join('\n'),
              // Preserve profile guidance during rewrite to maintain paper type rules
              profileGuidance,
              paperType: config.paperType,
              topic: sanitizedTopic,
              // Preserve voice configuration during rewrite for consistent authorial persona
              voiceConfig: paperProfile.voice
            }
          })
        } catch (rewriteError) {
          warn({ section: sectionContext.title, error: rewriteError }, 'Rewrite failed')
        }
      }
      
      // NOTE: Evidence tracking removed to allow all sections access to all chunks
      // Previously, trackBulkUsage() marked chunks as "used" after each section,
      // which caused later sections to have 0 available chunks.
      // Now all sections can cite from the full evidence pool.
      // Overlap detection (fourGramOverlapRatio) still guards against repetition.
      
      // Log citation feedback for RAG improvement (non-blocking)
      // This tracks which chunks were actually cited to improve future retrieval
      if (sectionContext.contextChunks && sectionContext.contextChunks.length > 0) {
        logSectionCitations(
          projectId,
          sectionContext.sectionKey,
          result.content,
          sectionContext.contextChunks,
          sectionContext.title
        ).catch(err => {
          // Non-critical - don't fail pipeline on feedback logging errors
          warn({ section: sectionContext.title, error: err }, 'Citation feedback logging failed')
        })
      }
      
      // Comprehensive section quality review (pipeline-level assessment)
      try {
        const review = await SectionReviewer.reviewSection(
          sectionContext.sectionKey,
          result.content,
          result.citations,
          sectionContext.contextChunks || [],
          sectionContext.expectedWords || 300
        )
        
        totalQualityScore += review.score
        if (!review.passed) {
          qualityIssues.push(`${sectionContext.title}: ${review.issues.join(', ')}`)
        }
      } catch (err) {
        warn({ section: sectionContext.title, error: err }, 'Quality review failed')
        // Use a default score if review fails
        totalQualityScore += 75
      }
      
      // Citation verification - verify that cited papers actually support the claims
      // This is BLOCKING - if citations fail verification, we regenerate with feedback
      try {
        const { verifySectionCitations, buildCitationFeedback } = await import('@/lib/quality/citation-verifier')
        const citationReport = await verifySectionCitations(
          sectionContext.title,
          result.content,
          sectionContext.contextChunks || []
        )
        
        metrics.citationStats.sectionsVerified++
        
        if (!citationReport.passed && citationReport.totalCitations > 0) {
          metrics.citationStats.sectionsFailed++
          warn({ 
            section: sectionContext.title, 
            verified: citationReport.verifiedCitations,
            failed: citationReport.failedCitations.length,
            score: (citationReport.score * 100).toFixed(0) + '%'
          }, 'Citation verification failed - regenerating section')
          
          // Build feedback about which citations failed
          const citationFeedback = buildCitationFeedback(citationReport)
          
          // Regenerate with citation feedback
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
                voiceConfig: paperProfile.voice
              }
            })
            
            // Verify the regenerated content
            const recheck = await verifySectionCitations(
              sectionContext.title,
              regenerated.content,
              sectionContext.contextChunks || []
            )
            
            if (recheck.passed || recheck.score > citationReport.score) {
              result = regenerated
              info({ section: sectionContext.title, newScore: (recheck.score * 100).toFixed(0) + '%' }, 'Section regenerated with improved citations')
            } else {
              warn({ section: sectionContext.title }, 'Regeneration did not improve citations - keeping original')
              qualityIssues.push(`${sectionContext.title}: Some citations could not be verified`)
            }
          } catch (regenError) {
            warn({ section: sectionContext.title, error: regenError }, 'Citation-based regeneration failed')
            qualityIssues.push(`${sectionContext.title}: Citation verification issues detected`)
          }
        }
        
        // Adjust quality score based on citation verification
        totalQualityScore += citationReport.score * 10 // Bonus for verified citations
      } catch (err) {
        // Don't fail pipeline on citation verification errors
        warn({ section: sectionContext.title, error: err }, 'Citation verification failed')
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
    
    // Finalize overlap stats
    if (overlapRatios.length > 0) {
      metrics.overlapStats.avgOverlapRatio = overlapRatios.reduce((a, b) => a + b, 0) / overlapRatios.length
      metrics.overlapStats.maxOverlapRatio = Math.max(...overlapRatios)
    }
    
    metrics.qualityCheckDuration = Date.now() - qualityStartTime
    
    const avgQualityScore = totalQualityScore / results.length
    
    // Paper type validation - use profile-based validation for contextual accuracy
    const profileValidation = validatePaperWithProfile(fullContent, paperProfile)
    
    if (!profileValidation.valid) {
      warn({ 
        paperType: config.paperType, 
        discipline: paperProfile.discipline.primary,
        issues: profileValidation.issues 
      }, 'Profile-based validation issues detected')
      qualityIssues.push(...profileValidation.issues)
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
    
    // Extract citations from CITATIONS blocks BEFORE converting markers
    // This captures paper IDs and quotes for database storage
    const { cleanNonCitationArtifacts, convertNumberedToStorageFormat, parseNumberedCitationsBlock } = await import('@/lib/citations/post-processor')
    
    // Parse all CITATIONS blocks from the full content to build allCitations
    // This replaces the broken extractCitationMarkers approach
    const citationsFromBlock = parseNumberedCitationsBlock(fullContent)
    for (const [, entry] of citationsFromBlock) {
      allCitations.push({
        paperId: entry.paperId,
        citationText: `[@${entry.paperId}]`
      })
    }
    
    // Convert numbered [1], [2] markers to [@paperId#instanceId] format for storage
    // Returns both converted content and instances to save
    const conversionResult = convertNumberedToStorageFormat(fullContent)
    fullContent = conversionResult.content
    
    // Save citation instances to database (direct insert, no HTTP round-trip)
    if (conversionResult.instancesToCreate.length > 0) {
      try {
        const serviceSupabase = getServiceClient()
        
        // Filter out instances without quotes and prepare for insert
        const validInstances = conversionResult.instancesToCreate
          .filter(i => i.instanceId && i.paperId && i.quote)
          .map(inst => ({
            id: inst.instanceId,
            project_id: projectId,
            paper_id: inst.paperId,
            // Truncate quote to 100 words max (same as API route)
            quote: inst.quote.split(/\s+/).slice(0, 100).join(' ')
          }))
        
        if (validInstances.length > 0) {
          const { error: insertError } = await serviceSupabase
            .from('citation_instances')
            .upsert(validInstances, { onConflict: 'id', ignoreDuplicates: true })
          
          if (insertError) {
            // If the migration for citation_instances hasn't been applied yet,
            // PostgREST returns PGRST205 (table missing from schema cache). Treat as optional.
            const code = (insertError as { code?: string }).code
            if (code === 'PGRST205') {
              info({ code }, 'citation_instances not available (migration not applied); skipping instance save')
            } else {
              warn({ error: insertError }, 'Failed to save citation instances')
            }
          } else {
            info({ count: validInstances.length }, 'Saved citation instances to database')
          }
        }
      } catch (err) {
        warn({ error: err }, 'Error saving citation instances')
      }
    }
    
    // Clean non-citation artifacts (leaked tool syntax, etc.)
    fullContent = cleanNonCitationArtifacts(fullContent)
    
    // VALIDATION: Create set of valid paper IDs to filter out hallucinated citations
    const validPaperIds = new Set(allPapers.map(p => p.id))
    
    // Filter and validate citations
    const validCitations: Array<{ paperId: string; citationText: string }> = []
    const invalidCitations: Array<{ paperId: string; citationText: string }> = []
    
    for (const citation of allCitations) {
      if (validPaperIds.has(citation.paperId)) {
        validCitations.push(citation)
      } else {
        invalidCitations.push(citation)
      }
    }
    
    // Log warnings for invalid citations (hallucinated or malformed paper IDs)
    if (invalidCitations.length > 0) {
      warn({
        invalidCount: invalidCitations.length,
        totalCitations: allCitations.length,
        invalidIds: invalidCitations.slice(0, 5).map(c => c.paperId), // Log first 5 for debugging
      }, 'Filtered out citations with invalid/hallucinated paper IDs')
      
      // Remove invalid citation markers from content to prevent "(Untitled, n.d.)" rendering
      for (const invalidCitation of invalidCitations) {
        // Remove Pandoc-style [@paper_id] markers
        const pandocPattern = new RegExp(`\\[@${invalidCitation.paperId}\\]`, 'g')
        fullContent = fullContent.replace(pandocPattern, '')
        
        // Remove legacy [CITE: paper_id] markers
        const legacyPattern = new RegExp(`\\[CITE:\\s*${invalidCitation.paperId}\\]`, 'g')
        fullContent = fullContent.replace(legacyPattern, '')
      }
      
      // Clean up any double spaces left by removed citations
      // IMPORTANT: do not collapse newlines, or markdown headings/paragraphs break.
      // Collapse only repeated spaces/tabs within a line, and normalize space-before-punctuation.
      fullContent = fullContent
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+([.,;:])/g, '$1')
    }
    
    const citedPaperIds = new Set(validCitations.map(c => c.paperId))
    const citationsMap: Record<string, { paperId: string; citationText: string }> = {}
    
    for (const citation of validCitations) {
      // Deduplicate by paperId
      const key = `cite-${citation.paperId}`
      if (!citationsMap[key]) {
        citationsMap[key] = {
          paperId: citation.paperId,
          citationText: citation.citationText
        }
      }
    }
    
    info({ 
      validCitations: citedPaperIds.size,
      invalidCitations: invalidCitations.length,
      totalGenerated: allCitations.length
    }, 'Citations validated and filtered')
    
    await updateProjectContent(projectId, fullContent.trim(), citationsMap)
    
    // Flush evidence tracker to ensure all usage is persisted to database
    // This enables cross-session deduplication for resumable generation
    await EvidenceTracker.flush(projectId)
    
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
    
    onProgress?.('complete', 100, 'Paper generation completed successfully', {
      totalWords: fullContent.split(' ').length,
      qualityScore: avgQualityScore,
      performanceMetrics: metrics
    })

    return {
      content: fullContent.trim(),
      outline: typedOutline,
      sections: sectionContexts,
      citations: citationsMap,
      profile: enhancedProfile,  // Return the enhanced profile with emergent themes
      themeAnalysis,             // Include theme analysis for transparency
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
    
    // Clean up evidence tracker (use sync to avoid nested async issues)
    EvidenceTracker.clearLedgerSync(projectId)
    
    // Classify error for better reporting
    const classified = classifyError(err)
    logError({ category: classified.category, message: classified.userMessage }, 'Pipeline failed')
    
    // Update project status to failed
    await updateResearchProjectStatus(projectId, 'failed' as PaperStatus)
    
    // Re-throw the classified error for better handling upstream
    throw classified
  }
}


