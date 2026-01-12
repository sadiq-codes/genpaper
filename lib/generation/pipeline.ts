import 'server-only'
import { updateProjectContent, updateResearchProjectStatus } from '@/lib/db/research'
import { collectPapers } from '@/lib/generation/discovery'
import { generateOutline, type OriginalResearchInput } from '@/lib/prompts/generators'
import { generateMultipleSectionsUnified } from '@/lib/generation/unified-generator'
import { GenerationContextService } from '@/lib/rag/generation-context'
import { SectionReviewer } from '@/lib/quality/section-reviewer'
import { validatePaperType } from '@/lib/quality/paper-type-validator'
import { fourGramOverlapRatio } from '@/lib/utils/overlap'
import { EvidenceTracker } from '@/lib/services/evidence-tracker'
import { sanitizeTopic } from '@/lib/utils/prompt-safety'
import { classifyError, CancellationError } from '@/lib/generation/errors'
import { warn, error as logError, info } from '@/lib/utils/logger'
// Citation markers [CITE: paper_id] are kept in markdown - UI renders them
// We only need cleanRemainingArtifacts to remove any leaked tool syntax
import { generatePaperProfile, validatePaperWithProfile, buildProfileGuidanceForPrompt } from '@/lib/generation/paper-profile'
import { extractThemes, mergeThemeAnalysisIntoProfile, buildThemeGuidanceForOutline } from '@/lib/generation/theme-extraction'
import type { PaperProfile, ThemeAnalysis } from '@/lib/generation/paper-profile-types'
import type { PaperStatus, OriginalResearchConfig } from '@/types/simplified'
import type { GeneratedOutline, SectionContext, PaperTypeKey } from '@/lib/prompts/types'
import type { EnhancedGenerationOptions } from '@/lib/generation/types'

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
  
  // Check for cancellation at pipeline start
  if (signal?.aborted) {
    throw new CancellationError('Pipeline cancelled before start')
  }
  
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
    // Step 0: Generate Paper Profile (NEW - contextual intelligence)
    onProgress?.('profiling', 2, 'Analyzing topic and determining paper requirements...')
    
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
    
    onProgress?.('profiling', 8, 'Paper profile generated', {
      discipline: paperProfile.discipline.primary,
      sectionsPlanned: paperProfile.structure.appropriateSections.length,
      minSources: paperProfile.sourceExpectations.minimumUniqueSources
    })
    
    // Step 1: Collect Papers (Search + Ingestion) - now uses profile for guidance
    onProgress?.('search', 10, 'Collecting and ingesting papers...', { 
      useLibraryOnly: config.useLibraryOnly,
      libraryPapers: config.libraryPaperIds?.length || 0,
      recencyProfile: paperProfile.sourceExpectations.recencyProfile
    })
    
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
        sources: config.sources || ['arxiv', 'openalex', 'crossref', 'semantic_scholar'],
        // Use profile's ideal source count to determine paper limit
        // Fetch more papers than needed to ensure diversity after filtering
        limit: Math.max(50, paperProfile.sourceExpectations.idealSourceCount * 2),
        library_papers_used: config.libraryPaperIds || [],
        length: config.length,
        paperType: config.paperType,
        useLibraryOnly: config.useLibraryOnly || false,
        localRegion: undefined
      },
      // Pass recency profile from paper profile
      recencyProfile: paperProfile.sourceExpectations.recencyProfile
    }

    const allPapers = await collectPapers(discoveryOptions)
    
    if (allPapers.length === 0) {
      throw new Error('No papers found for the given topic')
    }
    
    // Profile-driven source availability check
    // Calculate how many papers likely have usable content (not just abstracts)
    // We'll get more accurate numbers later in prompt-builder, but this provides early warning
    const minRequiredSources = paperProfile.sourceExpectations.minimumUniqueSources
    const availablePapers = allPapers.length
    
    // Critical threshold: if we have fewer papers than 50% of minimum required, fail early
    // This prevents generating papers with insufficient source diversity
    const criticalThreshold = Math.ceil(minRequiredSources * 0.5)
    
    if (availablePapers < criticalThreshold) {
      const errorMsg = `Insufficient sources for ${paperProfile.paperType} on this topic. ` +
        `Found ${availablePapers} papers but this paper type requires at least ${minRequiredSources} sources ` +
        `(critical minimum: ${criticalThreshold}). ` +
        `Consider broadening the topic or adding papers to your library.`
      
      logError({ 
        availablePapers, 
        minRequiredSources, 
        criticalThreshold,
        paperType: paperProfile.paperType,
        discipline: paperProfile.discipline.primary
      }, 'Source availability below critical threshold')
      
      throw new Error(errorMsg)
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
    
    onProgress?.('search', 20, 'Papers collected successfully', {
      papersFound: allPapers.length,
      minRequiredByProfile: minRequiredSources
    })

    // Step 1.5: Theme Extraction (NEW - Scribbr-aligned approach)
    // Analyze collected papers to identify emergent themes BEFORE outline generation
    // This ensures themes come from actual literature, not guesses
    onProgress?.('themes', 22, 'Analyzing literature for themes and patterns...')
    
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
      
      onProgress?.('themes', 24, 'Theme analysis complete', {
        themesFound: themeAnalysis.emergentThemes.length,
        debatesFound: themeAnalysis.debates.length,
        gapsFound: themeAnalysis.gaps.length,
        suggestedOrganization: themeAnalysis.organizationSuggestion.approach
      })
    } catch (themeError) {
      // Theme extraction is an enhancement - don't fail the pipeline if it fails
      warn({ error: themeError }, 'Theme extraction failed, continuing with original profile')
      onProgress?.('themes', 24, 'Theme analysis skipped (using default structure)')
    }

    // Step 2: Generate Outline (now with theme-informed profile)
    onProgress?.('outline', 25, 'Generating paper outline...')
    
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
    
    onProgress?.('outline', 30, 'Outline generated with profile-guided structure', {
      sectionsPlanned: typedOutline.sections.length
    })

    // Step 3: Build Section Contexts (RAG)
    onProgress?.('context', 35, 'Building section contexts...')
    
    const sectionContexts = await GenerationContextService.buildContexts(
      typedOutline,
      sanitizedTopic,
      allPapers
    )
    
    onProgress?.('context', 40, 'Section contexts prepared', {
      sectionsWithContext: sectionContexts.length
    })

    // Step 4: Generate Content
    onProgress?.('generation', 45, 'Starting unified content generation...')
    
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
        profileGuidance
        // Note: minSourcesRequired removed - using semantic citation guidance instead
      },
      (completed, total, currentSection) => {
        const progress = Math.round((completed / total) * 40) + 45 // 45-85%
        onProgress?.('generation', progress, `Generating ${currentSection} (${completed}/${total})`)
      }
    )

    // Step 5: Quality Checks and Assembly
    onProgress?.('quality', 85, 'Running quality checks...')
    
    let totalQualityScore = 0
    let qualityIssues: string[] = []
    const OVERLAP_THRESHOLD = 0.22
    
    for (let i = 0; i < results.length; i++) {
      let result = results[i]
      const sectionContext = sectionContexts[i]
      
      // Check cross-section overlap and rewrite if necessary
      const overlap = fourGramOverlapRatio(result.content, fullContent)
      if (fullContent && overlap > OVERLAP_THRESHOLD) {
        warn({ section: sectionContext.title, overlap: overlap.toFixed(2) }, 'High overlap detected, triggering rewrite')
        try {
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
              outlineTree: typedOutline.sections.map(s => `• ${s.title}`).join('\n')
            }
          })
        } catch (rewriteError) {
          warn({ section: sectionContext.title, error: rewriteError }, 'Rewrite failed')
        }
      }
      
      // Track evidence usage for cross-section memory (centralized here to avoid duplication)
      if (sectionContext.contextChunks && sectionContext.contextChunks.length > 0) {
        EvidenceTracker.trackBulkUsageSync(sectionContext.contextChunks, sectionContext.title, projectId)
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
      
      // Hallucination detection - verify claims are grounded in evidence
      try {
        const { quickHallucinationCheck } = await import('@/lib/quality/hallucination-detector')
        const hallucinationCheck = await quickHallucinationCheck(
          result.content,
          sectionContext.contextChunks || []
        )
        
        if (!hallucinationCheck.passed) {
          const ungroundedPct = ((1 - hallucinationCheck.score) * 100).toFixed(0)
          warn({ section: sectionContext.title, ungroundedPct }, 'Hallucination warning: claims may be ungrounded')
          qualityIssues.push(`${sectionContext.title}: ${ungroundedPct}% potentially ungrounded claims`)
          // Reduce quality score based on hallucination score
          totalQualityScore -= (1 - hallucinationCheck.score) * 15
        }
      } catch (err) {
        // Don't fail on hallucination check errors - it's an enhancement
        warn({ section: sectionContext.title, error: err }, 'Hallucination check failed')
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
    }
    
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
    
    // Also run legacy validation for comparison during transition
    const hasOriginalResearch = config.originalResearch?.has_original_research || false
    const legacyValidation = validatePaperType(fullContent, config.paperType, hasOriginalResearch)
    
    if (!legacyValidation.valid && profileValidation.valid) {
      // Log discrepancy for monitoring - profile validation should be more accurate
      info({
        legacyIssues: legacyValidation.issues,
        profilePassed: true
      }, 'Legacy validation flagged issues that profile validation passed - profile takes precedence')
    }
    
    onProgress?.('saving', 95, 'Extracting citations and saving content...')
    
    // Extract [CITE: paper_id] markers but DON'T replace them
    // Content is saved as markdown with citation markers intact
    // The UI renders them as formatted citations (e.g., "Smith et al., 2024")
    const citationMatches = fullContent.match(/\[CITE:\s*([a-f0-9-]+)\]/gi) || []
    const citedPaperIds = new Set<string>()
    
    for (const match of citationMatches) {
      const paperIdMatch = match.match(/\[CITE:\s*([a-f0-9-]+)\]/i)
      if (paperIdMatch) {
        citedPaperIds.add(paperIdMatch[1])
      }
    }
    
    info({ citationCount: citedPaperIds.size }, 'Extracted unique citations from content')
    
    // Clean non-citation artifacts (leaked tool syntax, etc.) but KEEP [CITE: ...] markers
    const { cleanNonCitationArtifacts } = await import('@/lib/citations/post-processor')
    fullContent = cleanNonCitationArtifacts(fullContent)
    
    // Build citations map from extracted paper IDs
    const citationsMap: Record<string, { paperId: string; citationText: string }> = {}
    let citationNum = 1
    for (const paperId of citedPaperIds) {
      citationsMap[`cite-${citationNum}`] = {
        paperId,
        citationText: `[CITE: ${paperId}]` // Store the marker as the "text" for backwards compat
      }
      citationNum++
    }
    
    // Also add any citations collected during generation
    allCitations.forEach((citation) => {
      if (!citedPaperIds.has(citation.paperId)) {
        citationsMap[`cite-${citationNum}`] = citation
        citationNum++
      }
    })
    
    await updateProjectContent(projectId, fullContent.trim(), citationsMap)
    
    onProgress?.('complete', 100, 'Paper generation completed successfully', {
      totalWords: fullContent.split(' ').length,
      qualityScore: avgQualityScore
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
      }
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


