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
import { generatePaperProfile, buildProfileGuidanceForPrompt } from '@/lib/generation/paper-profile'
import { generateWithUnifiedTemplate, type StructuredCitation } from '@/lib/generation/unified-generator'
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
  hasExtractionService,
  saveExtractionService 
} from '@/lib/extraction/db-service'
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
  issue: 'overlap' | 'length' | 'citation'
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
  
  const profile = await generatePaperProfile({
    topic: sanitizedTopic,
    paperType: config.paperType,
    hasOriginalResearch: config.originalResearch?.has_original_research,
    userContext: undefined
  })
  
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
      localRegion: undefined
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
const EXTRACTION_BATCH_SIZE = 5 // 5 papers per batch to stay under 60s

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
  
  const extractablePaperIds = needsExtraction.filter(id => usableFullTextIds.has(id))
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
  
  const limit = pLimit(3) // 3 concurrent extractions
  let extracted = 0
  
  await Promise.all(
    batchPaperIds.map(paperId =>
      limit(async () => {
        const paper = papers.find(p => p.id === paperId)
        if (!paper) return

        // Idempotency: if this step is retried, don't create a new extraction version.
        // (pendingPaperIds is persisted from an earlier check and may be stale.)
        try {
          const alreadyExtracted = await hasExtractionService(paperId)
          if (alreadyExtracted) return
        } catch (err) {
          // If we can't check, proceed with extraction; save will fail if constraints do.
          warn({ paperId, error: err }, 'Failed to check existing extraction; proceeding')
        }
        
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
 * Analyze all findings after extraction is complete
 * Estimated time: 20-40s (single LLM call for analysis)
 */
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
  
  info({ totalFindings: allFindings.length, papersWithExtractions: extractions.size }, 'Analyzing findings')
  
  // Run cross-document analysis
  const analysisResult = await analyzeFindings({
    projectId,
    findings: allFindings,
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
  
  // Calculate token budget
  const perSectionTokens = Math.max(2000, Math.round(
    ((profile.outline?.totalEstimatedWords || 10000) / totalSections) * 1.5 * 1.4
  ))
  
  // Build outline tree
  const outlineTree = profile.outline?.sections
    .map(s => `• ${s.title}`)
    .join('\n') || ''
  
  const profileGuidance = buildProfileGuidanceForPrompt(profile)
  
  const result = await generateWithUnifiedTemplate({
    context,
    options: {
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
      originalResearch: config.originalResearch?.has_original_research ? {
        hasOriginalResearch: true,
        researchQuestion: config.originalResearch.research_question,
        keyFindings: config.originalResearch.key_findings
      } : undefined
    }
  })
  
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
    if (targetWords >= 800 && section.wordCount < targetWords * 0.7) {
      issues.push({
        sectionIndex: i,
        issue: 'length',
        details: `${section.wordCount} words vs ${targetWords} target`
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
  
  const perSectionTokens = Math.max(2000, Math.round(
    ((profile.outline?.totalEstimatedWords || 10000) / totalSections) * 1.5 * 1.4
  ))
  
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
  }
  
  const result = await generateWithUnifiedTemplate({
    context,
    options: {
      temperature: config.temperature || 0.2,
      maxTokens: perSectionTokens,
      outlineTree,
      topic: sanitizedTopic,
      paperType: config.paperType,
      projectTitle: sanitizedTopic,
      previousSectionsSummary: rewriteInstructions,
      profileGuidance,
      voiceConfig: profile.voice,
      profileCriteria: profile.qualityCriteria
    }
  })
  
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
 * Convert numbered citations to storage format
 */
function convertNumberedCitationsToStorage(
  content: string,
  citations: StructuredCitation[],
  validPaperIds: Set<string>
): {
  content: string
  instances: CitationInstance[]
} {
  const instances: CitationInstance[] = []
  
  // Group citations by index and filter valid ones
  const citationsByIndex = new Map<number, StructuredCitation[]>()
  for (const citation of citations) {
    if (!validPaperIds.has(citation.paperId)) continue
    const existing = citationsByIndex.get(citation.index) || []
    existing.push(citation)
    citationsByIndex.set(citation.index, existing)
  }
  
  let result = content
  
  // Process each citation index
  for (const [index, citationsForIndex] of citationsByIndex) {
    const pattern = new RegExp(`\\[${index}\\]`, 'g')
    let occurrenceCount = 0
    
    result = result.replace(pattern, () => {
      const citation = citationsForIndex[occurrenceCount] || citationsForIndex[0]
      occurrenceCount++
      
      const instanceId = uuidv4()
      instances.push({
        instanceId,
        paperId: citation.paperId,
        quote: citation.quote,
      })
      
      return `[@${citation.paperId}#${instanceId}]`
    })
  }
  
  // Remove orphan markers
  result = result.replace(/\[\d+\]/g, '')
  
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
  
  // Collect all citations
  const allCitations = sections.flatMap(s => s.citations)
  
  // Clean non-citation artifacts
  const { cleanNonCitationArtifacts } = await import('@/lib/citations/post-processor')
  fullContent = cleanNonCitationArtifacts(fullContent)
  
  // Convert citations to storage format
  const validPaperIds = new Set(papers.map(p => p.id))
  const { content: processedContent, instances: citationInstances } = 
    convertNumberedCitationsToStorage(fullContent, allCitations, validPaperIds)
  
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
  await updateResearchProjectStatus(projectId, 'completed' as PaperStatus)
  
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
