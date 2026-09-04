import { createClient } from '@/lib/supabase/server'
import { getAutocompleteLanguageModel, getFastAutocompleteLanguageModel } from '@/lib/ai/vercel-client'
import { fog } from '@/lib/ai/foglamp'

const { generateObject } = fog.with({ traceName: "Inline autocomplete" })
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { handleError, requireAuth } from '@/lib/api/helpers'
import { 
  retrieveEditorContext, 
  formatEditorContextForPrompt, 
  type EditorContext 
} from '@/lib/rag'
import {
  processNumberedCitations,
  type PaperMetadata,
  type CitationStyle,
  type NumberedCitation
} from '@/lib/citations/unified-service'
import { getProjectCitationStyle } from '@/lib/citations/citation-settings'
import { PromptService } from '@/lib/prompts/prompt-service'
import { buildCompleteContext, formatPapersForContext } from '@/lib/prompts/costar-context'
import { checkAutocompleteUsage, formatTimeUntilReset } from '@/lib/billing/usage-limits'
import {
  type OutlinePlanBlueprint,
  buildCurrentSectionGoalsContext,
  buildOutlineBlueprintFromSections,
  buildSectionGoalMap,
  buildSectionSummariesContext,
  countWords,
  dedupePlannedOutline,
  extractiveSectionSummary,
  findNextMissingOutlineHeading,
  generateOutlineBlueprint,
  getSectionTransitionThreshold,
  headingsRoughlyMatch,
  limitSectionSummaries,
  normalizeOutlineHeading,
} from '@/lib/generation/outline-planner'
import { BANNED_PHRASES } from '@/lib/prompts/banned-phrases'
import { getAvailableVoiceProfileIds, type VoiceProfileId } from '@/lib/generation/voice-profiles'

/**
 * Extract paper IDs from citation markers in the preceding text.
 * Used to de-boost recently cited papers in RAG retrieval for better diversity.
 * 
 * Detects our internal marker format: [@paperId#instanceId]
 * This is zero-latency (simple regex, no API calls needed).
 */
function extractCitedPaperIds(text: string): string[] {
  const ids = new Set<string>()
  
  // Pattern: [@uuid#instanceId] - our internal citation marker format
  // UUID format: 8-4-4-4-12 hex characters
  const markerRegex = /\[@([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})#/gi
  let match
  while ((match = markerRegex.exec(text)) !== null) {
    ids.add(match[1].toLowerCase())
  }
  
  return Array.from(ids)
}

interface CompletionRequest {
  projectId: string
  context: {
    precedingText: string
    followingText?: string  // FIM: text after cursor (suffix)
    currentParagraph: string
    currentSection: string
    documentOutline: string[]
    /** True when cursor is in empty paragraph after a heading - signals section opening */
    isSectionOpening?: boolean
    /** Plain-text content currently written in this section (up to a bounded size) */
    currentSectionText?: string
    /** Approximate word count for content already written in current section */
    currentSectionWordCount?: number
  }
  paperIds: string[]
  topic: string
  // When true, skip RAG entirely for faster completions (no citations mode)
  skipRAG?: boolean
  // When true, allow global corpus search and library boosting beyond project papers
  useExternalSources?: boolean
}

interface AutocompleteGenerationConfig {
  voiceProfileId?: string
  plannedOutline?: string[]
  original_research?: {
    has_original_research: boolean
    research_question?: string
    key_findings?: string
  }
  outlineBlueprint?: OutlinePlanBlueprint
  // Backward compatibility for already persisted data
  autocompleteBlueprint?: OutlinePlanBlueprint
  sectionSummaries?: Record<string, string>
}

const MIN_WORDS_BEFORE_NEXT_HEADING = 140

// Citation info returned to client
interface CitationInSuggestion {
  paperId: string
  instanceId: string       // UUID for this specific instance
  marker: string           // [@id#instanceId] marker format
  formatted: string        // (Smith et al., 2023)
  citedContent: string     // The exact content from the paper that was cited
  index: number            // The original [N] index
  // Position offsets for ghost text highlighting
  displayStartOffset: number
  displayEndOffset: number
  paper?: PaperMetadata
}

/**
 * Save citation instances to database
 */
async function saveCitationInstances(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  instances: Array<{ instanceId: string; paperId: string; quote: string }>
): Promise<void> {
  if (instances.length === 0) return
  
  try {
    // Keep quote sizes bounded (same intent as /api/citation-instances)
    const MAX_QUOTE_WORDS = 100
    const truncateQuote = (quote: string) => {
      const words = quote.split(/\s+/)
      if (words.length <= MAX_QUOTE_WORDS) return quote
      return words.slice(0, MAX_QUOTE_WORDS).join(' ') + '...'
    }

    const inserts = instances
      .filter(i => i.instanceId && i.paperId && i.quote)
      .map(i => ({
        id: i.instanceId,
        project_id: projectId,
        paper_id: i.paperId,
        quote: truncateQuote(i.quote),
      }))

    if (inserts.length === 0) return

    const { error } = await supabase
      .from('citation_instances')
      .upsert(inserts, { onConflict: 'id', ignoreDuplicates: true })

    if (error) {
      // If migration not applied yet, treat as optional
      if ((error as { code?: string }).code === 'PGRST205') {
        console.warn('[Autocomplete] citation_instances not available (migration not applied); skipping')
        return
      }
      console.error('[Autocomplete] Failed to save citation instances:', error)
      return
    }

    console.log(`[Autocomplete] Saved ${inserts.length} citation instances`)
  } catch (error) {
    console.error('[Autocomplete] Error saving citation instances:', error)
  }
}

/**
 * Build system prompt using CO-STAR framework template
 * 
 * Note: suggestionType removed - the unified prompt instructs the LLM
 * to analyze writing intent semantically rather than using pre-classified types.
 */
async function buildSystemPromptFromTemplate(
  context: CompletionRequest['context'],
  topic: string,
  paperType: string,
  ragFormatted: { chunksText: string; claimsText: string },
  papersContext: string,
  outlineContext: string,
  currentSectionGoals: string,
  sectionSummariesContext: string,
  voiceProfileId?: string | null,
  noPapersAvailable?: boolean,
  originalResearch?: { has_original_research: boolean; research_question?: string; key_findings?: string } | null
): Promise<string> {
  const validVoiceIds = getAvailableVoiceProfileIds()
  const validatedVoiceId = voiceProfileId && validVoiceIds.includes(voiceProfileId as VoiceProfileId)
    ? voiceProfileId as VoiceProfileId
    : undefined
  
  const costarContext = buildCompleteContext({
    topic,
    paperType: paperType || 'research-article',
    currentSection: context.currentSection,
    precedingText: context.precedingText,
    followingText: context.followingText,  // FIM: pass suffix for better context
    outlineContext,
    currentSectionGoals,
    sectionSummariesContext,
    chunksText: ragFormatted.chunksText,
    claimsText: ragFormatted.claimsText,
    papersContext,
    voiceProfileId: validatedVoiceId,
    isSectionOpening: context.isSectionOpening,  // Pass section opening flag for special handling
    noPapersAvailable,  // Suppress citation instructions when no papers available
    hasOriginalResearch: originalResearch?.has_original_research,
    researchQuestion: originalResearch?.research_question,
    keyFindings: originalResearch?.key_findings,
  })

  return PromptService.buildCompletePrompt(costarContext)
}

/**
 * Build user prompt - minimal trigger approach
 */
function buildUserPrompt(context: CompletionRequest['context']): string {
  const preceding = context.precedingText.trim()
  
  // Section opening with no prior content - clear signal to write opening sentence
  if (!preceding) {
    return `[START OF ${context.currentSection.toUpperCase()}]`
  }
  
  // Section opening with prior content - signal new section while providing context
  if (context.isSectionOpening) {
    const snippet = preceding.slice(-500)
    const ellipsis = preceding.length > 500 ? '...' : ''
    return `${ellipsis}"${snippet}"\n\n[NEW SECTION: ${context.currentSection.toUpperCase()} - Write opening sentence]`
  }
  
  // Normal continuation
  const snippet = preceding.slice(-900)
  const ellipsis = preceding.length > 900 ? '...' : ''
  
  return `${ellipsis}"${snippet}" [CURSOR]`
}

const NOVELTY_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'to', 'of', 'in', 'on', 'for', 'with', 'by', 'as', 'at', 'from', 'into', 'within', 'through',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'their', 'there', 'here',
  'which', 'who', 'whom', 'whose', 'when', 'where', 'while', 'however', 'therefore', 'thus',
])

function normalizeNoveltyText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[@[a-z0-9-]+#[a-z0-9-]+\]/g, ' ')
    .replace(/\[(\d+)\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeNovelty(text: string): string[] {
  const normalized = normalizeNoveltyText(text)
  if (!normalized) return []
  return normalized
    .split(' ')
    .filter(token => token.length >= 3 && !NOVELTY_STOPWORDS.has(token))
}

function buildNgramSet(tokens: string[], n: number): Set<string> {
  const result = new Set<string>()
  if (tokens.length < n) return result
  for (let i = 0; i <= tokens.length - n; i++) {
    result.add(tokens.slice(i, i + n).join(' '))
  }
  return result
}

function computeSetOverlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const value of a) {
    if (b.has(value)) overlap++
  }
  return overlap / Math.min(a.size, b.size)
}

function isLikelyRedundantContinuation(candidate: string, precedingContext: string): boolean {
  const candidateTokens = tokenizeNovelty(candidate)
  const contextTokens = tokenizeNovelty(precedingContext.slice(-2400))
  if (candidateTokens.length < 5 || contextTokens.length < 10) {
    return false
  }

  const candidateTri = buildNgramSet(candidateTokens, 3)
  const contextTri = buildNgramSet(contextTokens, 3)
  const trigramOverlap = computeSetOverlapRatio(candidateTri, contextTri)

  const candidateTokenSet = new Set(candidateTokens)
  const contextTokenSet = new Set(contextTokens)
  const tokenOverlap = computeSetOverlapRatio(candidateTokenSet, contextTokenSet)

  return trigramOverlap >= 0.38 || tokenOverlap >= 0.82
}

/**
 * Build a stable retrieval query for autocomplete RAG.
 *
 * Root cause addressed:
 * per-keystroke query drift prevented cache reuse, causing repeated 3-5s RAG misses.
 * We anchor retrieval to topic + section + opening paragraph prefix so cache keys stay
 * stable while writing within the same section.
 */
function buildRagQueryText(topic: string, context: CompletionRequest['context']): string {
  const normalizedTopic = topic.trim() || 'Research'
  const normalizedSection = (context.currentSection || 'General').trim()

  // Use only a stable prefix of the current paragraph (first words), not full preceding text.
  const paragraphPrefix = (context.currentParagraph || '')
    .trim()
    .split(/\s+/)
    .slice(0, 14)
    .join(' ')

  if (paragraphPrefix) {
    return `${normalizedTopic} | ${normalizedSection} | ${paragraphPrefix}`
  }

  return `${normalizedTopic} | ${normalizedSection}`
}

// Convert RAG context papers to PaperMetadata format
function ragContextToPaperMetadata(ragContext: EditorContext): PaperMetadata[] {
  const papers: PaperMetadata[] = []
  
  for (const [id, paper] of ragContext.papers) {
    papers.push({
      id,
      title: paper.title,
      authors: paper.authors || [],
      year: paper.year,
      doi: paper.doi,
      venue: paper.venue
    })
  }
  
  return papers
}

/**
 * Single sentence with its own citations
 */
interface AICitation {
  paperId: string
  citedContent: string
}

interface AISentence {
  text: string
  citations: AICitation[]
}

/**
 * Parse structured AI response with multiple sentences
 * Each sentence has its own text and citations array
 */
interface AIStructuredResponse {
  sentences: AISentence[]
  contextHint: string
  confidence: number  // 0.0-1.0, how confident the model is in this completion
}

function buildAICompletionSchema(allowedPaperIds: string[]) {
  const allowedPaperIdsLower = new Set(allowedPaperIds.map(id => id.toLowerCase()))

  const citationsSchema =
    allowedPaperIds.length === 0
      ? z
          .array(
            z.object({
              paperId: z.string(),
              citedContent: z.string(),
            })
          )
          .max(0)
      : z
          .array(
            z.object({
              paperId: z
                .string()
                .uuid()
                .refine(
                  paperId => allowedPaperIdsLower.has(paperId.toLowerCase()),
                  'paperId must reference a retrieved paper'
                ),
              citedContent: z.string(),
            })
          )

  return z.object({
    sentences: z.array(
      z.object({
        text: z.string().min(1),
        citations: citationsSchema,
      })
    ).min(1).max(2),
    contextHint: z.string(),
    confidence: z.number().min(0).max(1),
  })
}

function normalizeSentenceForServerOwnedCitations(
  sentence: AISentence
): { prose: string; numberedText: string; citations: NumberedCitation[] } | null {
  // Remove any model-produced [N] markers; server owns marker placement.
  const prose = sentence.text.replace(/\s*\[\d+\]/g, '').replace(/\s+/g, ' ').trim()
  if (!prose) return null

  // Reject truncated generations.
  if (!/[.!?]['")]*$/.test(prose)) {
    console.log(`[Autocomplete] Dropping truncated sentence: "${prose.slice(-40)}"`)
    return null
  }

  // Deterministic citation numbering (server-owned). Keep first occurrence per paper.
  const seenPaperIds = new Set<string>()
  const normalizedCitations: NumberedCitation[] = []
  for (const citation of sentence.citations) {
    const paperId = citation.paperId.trim()
    if (!paperId || seenPaperIds.has(paperId)) continue
    seenPaperIds.add(paperId)
    normalizedCitations.push({
      index: normalizedCitations.length + 1,
      paperId,
      citedContent: citation.citedContent || '',
    })
  }

  const markerSuffix =
    normalizedCitations.length > 0
      ? ` ${normalizedCitations.map(c => `[${c.index}]`).join(' ')}`
      : ''

  let numberedText = prose
  if (markerSuffix) {
    // Place citations before terminal punctuation to keep academic inline style natural.
    const trailingMatch = prose.match(/([.!?]['")\]]*)$/)
    if (trailingMatch && trailingMatch.index !== undefined) {
      const punctuationStart = trailingMatch.index
      const body = prose.slice(0, punctuationStart).trimEnd()
      const trailing = trailingMatch[1]
      numberedText = `${body}${markerSuffix}${trailing}`
    } else {
      numberedText = `${prose}${markerSuffix}`
    }
  }

  return {
    prose,
    numberedText,
    citations: normalizedCitations,
  }
}

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now()
  const timings: Record<string, number> = {}
  
  try {
    // Auth check
    const authStartTime = Date.now()
    const user = await requireAuth()
    const supabase = await createClient()
    timings.auth = Date.now() - authStartTime

    // Check daily usage limits (read-only). Usage is incremented on explicit accept.
    const usageCheck = await checkAutocompleteUsage(user.id)
    if (!usageCheck.allowed) {
      const timeUntilReset = formatTimeUntilReset(usageCheck.resetsAt)
      return NextResponse.json({ 
        error: 'Daily autocomplete limit reached',
        code: 'AUTOCOMPLETE_LIMIT_REACHED',
        message: `You've used all ${usageCheck.dailyLimit} daily autocomplete requests. Upgrade to a paid plan for unlimited autocomplete, or wait ${timeUntilReset} for your limit to reset.`,
        usage: {
          current: usageCheck.currentUses,
          limit: usageCheck.dailyLimit,
          resetsAt: usageCheck.resetsAt.toISOString(),
        }
      }, { status: 429 })
    }

    // Parse request body
    let body: CompletionRequest
    try {
      const text = await request.text()
      if (!text || text.trim() === '') {
        return NextResponse.json({ error: 'Empty request body' }, { status: 400 })
      }
      body = JSON.parse(text)
    } catch (parseError: unknown) {
      if (parseError instanceof Error) {
        if (parseError.message === 'aborted' || parseError.message.includes('ECONNRESET')) {
          return new NextResponse(null, { status: 499 })
        }
      }
      console.error('Failed to parse request body:', parseError)
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }

    const { projectId, context, paperIds, topic, skipRAG, useExternalSources } = body

    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })
    }

    // Build a stable section-scoped query to maximize RAG cache reuse.
    const queryText = buildRagQueryText(topic || '', context)
    
    // OPTIMIZATION: Fetch project and determine paper IDs in parallel when possible
    const projectFetchStart = Date.now()
    
    // Start project fetch + library paper IDs fetch in parallel
    const projectPromise = supabase
      .from('research_projects')
      .select('id, topic, paper_type, generation_config')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()
    
    // Only fetch library IDs when external sources are enabled (used for boosting)
    const libraryIdsPromise = useExternalSources
      ? supabase
          .from('library_papers')
          .select('paper_id')
          .eq('user_id', user.id)
          .limit(50)
      : Promise.resolve({ data: null })
    
    // Use project paper IDs if provided; otherwise search global corpus
    let effectivePaperIds = paperIds || []
    
    // FAST MODE: Skip RAG entirely when citations are disabled
    if (skipRAG) {
      console.log('[Autocomplete] skipRAG=true - skipping RAG for fast completion')
      effectivePaperIds = []
    }
    // No project papers → search the global pre-indexed corpus only if external sources enabled
    else if (effectivePaperIds.length === 0) {
      if (useExternalSources) {
        console.log('[Autocomplete] No project papers — using global corpus search')
      } else {
        console.log('[Autocomplete] No project papers and external sources disabled — no RAG')
      }
    }

    // Wait for project + library fetches (both started in parallel above)
    const [{ data: project, error: projectError }, { data: libraryRows }] = await Promise.all([
      projectPromise,
      libraryIdsPromise,
    ])
    timings.projectFetch = Date.now() - projectFetchStart

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    
    // Extract library paper IDs for search boosting (only when external sources enabled)
    const boostedPaperIds = useExternalSources
      ? (libraryRows?.map((r: { paper_id: string }) => r.paper_id) || [])
      : []
    
    // Extract voice profile, outline plan, and optional section memory from generation config.
    // These fields are persisted on the project to keep autocomplete stateful across sessions.
    const generationConfig = (
      project as { generation_config?: AutocompleteGenerationConfig | null }
    ).generation_config || null

    let mutableGenerationConfig: AutocompleteGenerationConfig = generationConfig
      ? { ...generationConfig }
      : {}

    const voiceProfileId = mutableGenerationConfig.voiceProfileId || null
    let plannedOutline = dedupePlannedOutline(mutableGenerationConfig.plannedOutline || [])
    let outlineBlueprint =
      mutableGenerationConfig.outlineBlueprint ||
      mutableGenerationConfig.autocompleteBlueprint
    let sectionSummaries: Record<string, string> = mutableGenerationConfig.sectionSummaries || {}
    const originalResearch = mutableGenerationConfig.original_research || null

    if (voiceProfileId) {
      console.log('[Autocomplete] Using project voice profile:', voiceProfileId)
    }

    // One-time bootstrap: if no stored outline exists, generate a blueprint from the title/topic.
    if (plannedOutline.length === 0) {
      const inferredTopic = (topic || project.topic || context.documentOutline?.[0] || '').trim()
      if (inferredTopic) {
        outlineBlueprint = await generateOutlineBlueprint({
          topic: inferredTopic,
          paperType: project.paper_type || 'literatureReview',
          titleHeading: context.documentOutline?.[0],
        })

        plannedOutline = dedupePlannedOutline(
          outlineBlueprint.sections.map(section => section.heading)
        )

        mutableGenerationConfig = {
          ...mutableGenerationConfig,
          outlineBlueprint,
          autocompleteBlueprint: outlineBlueprint,
          plannedOutline,
        }

        const { error: configUpdateError } = await supabase
          .from('research_projects')
          .update({ generation_config: mutableGenerationConfig })
          .eq('id', projectId)
          .eq('user_id', user.id)

        if (configUpdateError) {
          console.warn('[Autocomplete] Failed to persist generated outline:', configUpdateError)
        } else {
          console.log(`[Autocomplete] Generated blueprint with ${plannedOutline.length} sections`)
        }
      }
    }

    if (!outlineBlueprint && plannedOutline.length > 0) {
      outlineBlueprint = buildOutlineBlueprintFromSections(
        plannedOutline.map(heading => ({
          heading,
          goal: '',
        })),
        'autocomplete'
      )
    }

    const sectionGoalMap = buildSectionGoalMap(outlineBlueprint?.sections || [])

    // -----------------------------------------------------------------------
    // OUTLINE-AWARE HEADING SUGGESTION
    // Suggest the next heading only when:
    // - title bootstrap (first heading insertion after title), OR
    // - current section has enough content and cursor is at an empty boundary.
    // -----------------------------------------------------------------------
    if (plannedOutline.length > 0) {
      const nextHeading = findNextMissingOutlineHeading(plannedOutline, context.documentOutline || [])
      const isEmptyParagraph = !context.currentParagraph?.trim()
      const currentSectionWordCount = context.currentSectionWordCount
        ?? countWords(context.currentSectionText || context.precedingText)
      const sectionTransitionThreshold = getSectionTransitionThreshold({
        currentSection: context.currentSection,
        plannedOutline,
        blueprintSections: outlineBlueprint?.sections || [],
        fallbackWords: MIN_WORDS_BEFORE_NEXT_HEADING,
      })
      const endsAtSentenceBoundary = /[.!?]["')\]]*$/.test(context.precedingText.trim())
      const isTitleBootstrap = (context.documentOutline?.length || 0) <= 1 && currentSectionWordCount < 40

      const shouldSuggestHeading = Boolean(nextHeading) && isEmptyParagraph && (
        isTitleBootstrap ||
        (
          !context.isSectionOpening &&
          currentSectionWordCount >= sectionTransitionThreshold &&
          endsAtSentenceBoundary
        )
      )

      if (nextHeading && shouldSuggestHeading) {
        // When advancing sections, store a compact summary of the completed section.
        const currentSectionKey = normalizeOutlineHeading(context.currentSection || '')
        const canSummarizeCurrentSection =
          !isTitleBootstrap &&
          currentSectionKey.length > 0 &&
          currentSectionWordCount >= sectionTransitionThreshold &&
          Boolean(context.currentSectionText?.trim())

        if (canSummarizeCurrentSection && !sectionSummaries[currentSectionKey]) {
          const summary = extractiveSectionSummary(context.currentSectionText || '')
          if (summary) {
            sectionSummaries = limitSectionSummaries(
              {
                ...sectionSummaries,
                [currentSectionKey]: summary,
              },
              plannedOutline
            )

            mutableGenerationConfig = {
              ...mutableGenerationConfig,
              plannedOutline,
              sectionSummaries,
              ...(outlineBlueprint
                ? { outlineBlueprint, autocompleteBlueprint: outlineBlueprint }
                : {}),
            }

            const { error: summaryUpdateError } = await supabase
              .from('research_projects')
              .update({ generation_config: mutableGenerationConfig })
              .eq('id', projectId)
              .eq('user_id', user.id)

            if (summaryUpdateError) {
              console.warn('[Autocomplete] Failed to persist section summary:', summaryUpdateError)
            } else {
              console.log(`[Autocomplete] Stored section summary for "${context.currentSection}"`)
            }
          }
        }

        console.log(
          `[Autocomplete] Suggesting next heading: "${nextHeading}" (sectionWords=${currentSectionWordCount}, threshold=${sectionTransitionThreshold})`
        )
        timings.total = Date.now() - requestStartTime

        const headingText = `## ${nextHeading}\n`
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'done',
              sentences: [{
                text: headingText,
                displayText: headingText.trim(),
                citations: [],
              }],
              contextHint: 'Next section',
              ragInfo: { chunksUsed: 0, claimsUsed: 0, papersReferenced: 0 },
              timing: timings,
              isHeadingSuggestion: true,
            })}\n\n`))
            controller.close()
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        })
      }
    }

    // RAG + citation style fetch in parallel
    // effectivePaperIds=[] triggers global corpus search in retrieveEditorContext
    const ragStartTime = Date.now()
    
    let ragContext: Awaited<ReturnType<typeof retrieveEditorContext>>
    let citationStyle: CitationStyle | null = null
    let usesFastModel = false
    
    // Skip RAG when: citations disabled, OR no project papers and external sources off
    const shouldSkipRAG = skipRAG || (effectivePaperIds.length === 0 && !useExternalSources)
    
    if (shouldSkipRAG) {
      // No RAG, no citation style fetch
      ragContext = {
        hasContent: true,
        chunks: [],
        claims: [],
        papers: new Map(),
      }
      usesFastModel = true
      timings.rag = Date.now() - ragStartTime
      console.log(`[Autocomplete] RAG skipped — ${skipRAG ? 'citations disabled' : 'no project papers & external sources off'}`)
    } else {
      // Extract recently cited paper IDs from preceding text for de-boosting
      // Look back ~1000 chars to capture recent citations in current context
      // Cap at 5 papers to ensure enough of the corpus remains at full score
      const recentlyCitedPaperIds = extractCitedPaperIds(
        context.precedingText.slice(-1000)
      ).slice(0, 5)
      
      if (recentlyCitedPaperIds.length > 0) {
        console.log(`[Autocomplete] De-boosting ${recentlyCitedPaperIds.length} recently cited papers (max 5)`)
      }
      
      const [retrievedContext, style] = await Promise.all([
        retrieveEditorContext(queryText, effectivePaperIds, {
          maxChunks: 10,           // Increased from 4 for better diversity
          maxClaims: 0,
          minChunkScore: 0.2,     // Slightly lower to include more papers
          minClaimScore: 0.25,
          boostedPaperIds,
          maxChunksPerPaper: 2,   // Limit per paper to force diversity
          deboostPaperIds: recentlyCitedPaperIds, // De-boost recently cited papers
        }),
        getProjectCitationStyle(projectId, user.id) as Promise<CitationStyle>
      ])
      ragContext = retrievedContext
      citationStyle = style
      timings.rag = Date.now() - ragStartTime

      if (ragContext.hasContent) {
        console.log(`[Autocomplete] RAG context: ${ragContext.chunks.length} chunks, ${ragContext.papers.size} papers`)
      } else {
        // No chunks found — use fast model for topic-only completion
        usesFastModel = true
        ragContext = { hasContent: true, chunks: [], claims: [], papers: new Map() }
        console.log('[Autocomplete] No RAG chunks found — topic-only mode')
      }
    }
    
    // Log timing breakdown
    console.log('[Autocomplete] Timing breakdown (ms):', {
      ...timings,
      skipRAG: shouldSkipRAG,
      useExternalSources: !!useExternalSources,
      globalSearch: effectivePaperIds.length === 0 && !!useExternalSources,
      chunksRetrieved: ragContext.chunks.length,
      papersUsed: ragContext.papers.size
    })

    const ragFormatted = formatEditorContextForPrompt(ragContext)
    const papersContext = formatPapersForContext(
      Array.from(ragContext.papers.entries()).map(([id, paper]) => ({
        id,
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
      }))
    )

    // Build outline context: current headings + remaining planned sections (+ goals when available)
    let outlineContext: string
    if (context.documentOutline.length > 0) {
      outlineContext = 'Current document sections:\n' + context.documentOutline.map(h => `- ${h}`).join('\n')
      if (plannedOutline.length > 0) {
        const remaining = plannedOutline.filter(
          planned => !context.documentOutline.some(existing => headingsRoughlyMatch(existing, planned))
        )
        if (remaining.length > 0) {
          outlineContext += '\n\nUpcoming planned sections:\n' + remaining.map(heading => {
            const goal = sectionGoalMap.get(normalizeOutlineHeading(heading))
            return goal ? `- ${heading}: ${goal}` : `- ${heading}`
          }).join('\n')
        }
      }
    } else if (plannedOutline.length > 0) {
      outlineContext = 'Planned paper outline:\n' + plannedOutline.map(heading => {
        const goal = sectionGoalMap.get(normalizeOutlineHeading(heading))
        return goal ? `- ${heading}: ${goal}` : `- ${heading}`
      }).join('\n')
    } else {
      outlineContext = 'No outline.'
    }

    const currentSectionGoals = buildCurrentSectionGoalsContext(
      context.currentSection,
      plannedOutline,
      sectionGoalMap
    )
    const sectionSummariesContext = buildSectionSummariesContext(
      sectionSummaries,
      plannedOutline
    )

    const paperType = project.paper_type || 'literatureReview'

    // Determine if no papers are available for citation
    // This flag tells the prompt template to suppress citation instructions
    // to prevent hallucinated paper IDs
    const noPapersAvailable = shouldSkipRAG || ragContext.papers.size === 0
    if (noPapersAvailable) {
      console.log('[Autocomplete] No papers available - citations disabled in prompt')
    }

    const system = await buildSystemPromptFromTemplate(
      context,
      topic || project.topic,
      paperType,
      ragFormatted,
      papersContext,
      outlineContext,
      currentSectionGoals,
      sectionSummariesContext,
      voiceProfileId,  // Pass voice profile for consistent completions
      noPapersAvailable,  // Suppress citation instructions when no papers available
      originalResearch   // Pass original research for findings-anchored completions
    )
    
    let userPrompt = buildUserPrompt(context)

    // Inject citation history so the model diversifies across papers
    if (!noPapersAvailable) {
      const recentlyCitedPaperIds = extractCitedPaperIds(context.precedingText.slice(-1500))
      if (recentlyCitedPaperIds.length > 0) {
        const recentTitles = recentlyCitedPaperIds
          .map(id => ragContext.papers.get(id)?.title)
          .filter(Boolean)
          .slice(0, 4)

        if (recentTitles.length > 0) {
          userPrompt += `\n\nCITATION DIVERSITY (MANDATORY): The preceding text already cites these papers — do NOT cite them again unless absolutely no other source is relevant:\n${recentTitles.map(t => `- "${t}"`).join('\n')}\nChoose DIFFERENT papers from the Available Papers list.`
        }
      }
    }

    const abortController = new AbortController()
    const timeout = setTimeout(() => {
      abortController.abort(new DOMException('Autocomplete timed out', 'AbortError'))
    }, 30000)

    // Abort upstream generation immediately if the client disconnects
    const onRequestAbort = () => {
      abortController.abort(new DOMException('Client disconnected', 'AbortError'))
    }
    request.signal.addEventListener('abort', onRequestAbort, { once: true })
    
    // Track LLM timing
    const llmStartTime = Date.now()
    
    try {
      // Fast model when no RAG context (no citations to generate)
      // Standard model when RAG context available (grounded completions)
      const model = usesFastModel
        ? getFastAutocompleteLanguageModel() 
        : getAutocompleteLanguageModel()
      
      console.log(`[Autocomplete] model: ${usesFastModel ? 'fast' : 'standard'}, chunks: ${ragContext.chunks.length}`)

      // Retry with larger budgets to prevent truncated JSON on strict structured output.
      const tokenBudgets = usesFastModel ? [500, 700] : [1000, 1400]
      const MAX_SCHEMA_ATTEMPTS = tokenBudgets.length
      const schemaOutputInstruction =
        '\n\nOUTPUT CONTRACT (MANDATORY): Return ONLY one JSON object with this exact schema: ' +
        '{"sentences":[{"text":"...","citations":[{"paperId":"uuid","citedContent":"..."}]}],' +
        '"contextHint":"...","confidence":0.0}. ' +
        'Do NOT include [N] citation markers in sentence text. Sentence text must be plain prose only. ' +
        'Put source links ONLY in each sentence.citations array using paperId and citedContent.'
      const strictRetrySystemInstruction =
        '\n\nSTRICT RETRY MODE (MANDATORY): Follow the output contract exactly. ' +
        'Do NOT include [N] markers in prose. Keep citations in citations[] only. ' +
        'Each sentence must add NEW information, must not restate previous nearby text, and must not include meta-preview phrasing like what the next section will cover.'

      const papers = ragContextToPaperMetadata(ragContext)
      const completionSchema = buildAICompletionSchema(papers.map(p => p.id))
      const encoder = new TextEncoder()
      
      // Flag to prevent enqueue after close
      let streamClosed = false
      
      const stream = new ReadableStream({
        async start(controller) {
          try {
            // Process each sentence independently with its own citations
            interface ProcessedSentence {
              text: string           // Raw text with [@id#instanceId] markers
              displayText: string    // Formatted with (Author, Year)
              citations: CitationInSuggestion[]
            }

            const CONFIDENCE_THRESHOLD = 0.5

            let finalProcessedSentences: ProcessedSentence[] | null = null
            let finalContextHint = 'Continuing...'
            let finalInstancesToCreate: Array<{ instanceId: string; paperId: string; quote: string }> = []
            let successAttempt = 0

            for (let attempt = 1; attempt <= MAX_SCHEMA_ATTEMPTS; attempt++) {
              if (abortController.signal.aborted) {
                streamClosed = true
                try { controller.close() } catch {}
                return
              }

              const isRetry = attempt > 1
              const maxOutputTokens = tokenBudgets[attempt - 1]
              const attemptSystem = `${system}${schemaOutputInstruction}${isRetry ? strictRetrySystemInstruction : ''}`
              if (isRetry) {
                console.warn(
                  `[Autocomplete] Strict retry ${attempt}/${MAX_SCHEMA_ATTEMPTS} after schema/citation mismatch ` +
                  `(maxOutputTokens=${maxOutputTokens})`
                )
              }

              let parsed: AIStructuredResponse | null = null
              try {
                const { object } = await fog.run({ customer: { id: user.id } }, () =>
                  generateObject({
                    model,
                    system: attemptSystem,
                    prompt: userPrompt,
                    schema: completionSchema,
                    maxOutputTokens,
                    temperature: 0.5,
                    abortSignal: abortController.signal,
                  })
                )

                parsed = object
                timings.llmTotal = Date.now() - llmStartTime
                if (timings.llmFirstToken === undefined) {
                  // Non-streamed object mode: first useful output arrives with final object.
                  timings.llmFirstToken = timings.llmTotal
                }
                console.log(
                  `[Autocomplete] Structured AI response (attempt ${attempt}/${MAX_SCHEMA_ATTEMPTS}):`,
                  JSON.stringify(parsed).slice(0, 500)
                )
              } catch (error) {
                if (attempt < MAX_SCHEMA_ATTEMPTS) {
                  console.warn(
                    `[Autocomplete] Structured generation failed at ${maxOutputTokens} tokens, retrying with ${tokenBudgets[attempt]}`,
                    error
                  )
                  continue
                }
                if (!streamClosed) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    type: 'error',
                    error: 'Could not generate completion - strict schema validation failed'
                  })}\n\n`))
                  streamClosed = true
                  controller.close()
                }
                return
              }

              if (!parsed || parsed.sentences.length === 0) {
                if (attempt < MAX_SCHEMA_ATTEMPTS) {
                  console.warn(
                    `[Autocomplete] Empty structured response at ${maxOutputTokens} tokens, retrying with ${tokenBudgets[attempt]}`
                  )
                  continue
                }
                if (!streamClosed) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    type: 'error',
                    error: 'Could not generate completion - strict schema validation failed'
                  })}\n\n`))
                  streamClosed = true
                  controller.close()
                }
                return
              }

              if (parsed.confidence < CONFIDENCE_THRESHOLD) {
                console.log(`[Autocomplete] Low confidence (${parsed.confidence}) - suppressing suggestion`)
                if (!streamClosed) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    type: 'error',
                    error: 'No confident suggestion available for this context'
                  })}\n\n`))
                  streamClosed = true
                  controller.close()
                }
                return
              }

              const allText = parsed.sentences.map(s => s.text.toLowerCase()).join(' ')
              const foundBannedPhrase = BANNED_PHRASES.find(phrase => allText.includes(phrase.toLowerCase()))
              if (foundBannedPhrase) {
                console.log(`[Autocomplete] Banned phrase detected: "${foundBannedPhrase}" - suppressing suggestion`)
                if (!streamClosed) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    type: 'error',
                    error: 'Suggestion contained generic filler - please try again'
                  })}\n\n`))
                  streamClosed = true
                  controller.close()
                }
                return
              }

              const processedSentences: ProcessedSentence[] = []
              const allInstancesToCreate: Array<{ instanceId: string; paperId: string; quote: string }> = []
              let strictCitationMismatch = false
              let noveltyContextWindow = context.precedingText.slice(-2400)

              for (let i = 0; i < parsed.sentences.length; i++) {
                const sentence = parsed.sentences[i]
                console.log(`[Autocomplete] Processing sentence ${i + 1}:`, sentence.text.slice(0, 80))

                const normalizedSentence = normalizeSentenceForServerOwnedCitations(sentence)
                if (!normalizedSentence) {
                  strictCitationMismatch = true
                  console.warn(
                    `[Autocomplete] Strict sentence normalization failed in sentence ${i + 1}`
                  )
                  break
                }

                if (isLikelyRedundantContinuation(normalizedSentence.prose, noveltyContextWindow)) {
                  strictCitationMismatch = true
                  console.warn(
                    `[Autocomplete] Strict novelty check failed in sentence ${i + 1}: likely repetitive continuation`
                  )
                  break
                }

                // Process numbered citations [1], [2], etc. for this sentence
                // When skipRAG is true, citationStyle is null but papers is empty anyway
                // so citation processing will be a no-op. Use 'apa' as fallback.
                const processResult = processNumberedCitations(
                  normalizedSentence.numberedText,
                  normalizedSentence.citations,
                  papers,
                  citationStyle || 'apa'
                )

                if (processResult.failedCitations.length > 0) {
                  strictCitationMismatch = true
                  console.warn(
                    `[Autocomplete] Strict citation mismatch in sentence ${i + 1}:`,
                    processResult.failedCitations
                  )
                  break
                }

                // Collect instances to create
                allInstancesToCreate.push(...processResult.instancesToCreate)

                // Build citations array for this sentence with position offsets
                const sentenceCitations: CitationInSuggestion[] = []
                for (const c of processResult.processedCitations) {
                  // Strict mode: all processed citations must have valid offsets.
                  if (c.formattedStartOffset < 0 || c.formattedEndOffset < 0) {
                    strictCitationMismatch = true
                    console.warn(
                      `[Autocomplete] Strict citation position mismatch: index=${c.index}, formatted="${c.formatted}"`
                    )
                    break
                  }

                  sentenceCitations.push({
                    paperId: c.paperId,
                    instanceId: c.instanceId,
                    marker: c.marker,
                    formatted: c.formatted,
                    citedContent: c.citedContent,
                    index: c.index,
                    displayStartOffset: c.formattedStartOffset,
                    displayEndOffset: c.formattedEndOffset,
                    paper: c.paper
                  })
                }

                if (strictCitationMismatch) {
                  break
                }

                processedSentences.push({
                  text: processResult.contentWithMarkers,
                  displayText: processResult.contentFormatted,
                  citations: sentenceCitations
                })

                noveltyContextWindow = `${noveltyContextWindow} ${processResult.contentFormatted}`.slice(-2400)
              }

              if (strictCitationMismatch || processedSentences.length === 0) {
                if (attempt < MAX_SCHEMA_ATTEMPTS) {
                  console.warn(
                    `[Autocomplete] Strict citation processing failed at ${maxOutputTokens} tokens, retrying with ${tokenBudgets[attempt]}`
                  )
                  continue
                }
                if (!streamClosed) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    type: 'error',
                    error: 'Could not generate completion - strict citation validation failed'
                  })}\n\n`))
                  streamClosed = true
                  controller.close()
                }
                return
              }

              finalProcessedSentences = processedSentences
              finalInstancesToCreate = allInstancesToCreate
              finalContextHint = parsed.contextHint
              successAttempt = attempt
              break
            }

            if (!finalProcessedSentences) {
              if (!streamClosed) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'error',
                  error: 'Could not generate completion - strict validation failed'
                })}\n\n`))
                streamClosed = true
                controller.close()
              }
              return
            }

            if (successAttempt > 1) {
              console.log(`[Autocomplete] Strict retry succeeded on attempt ${successAttempt}`)
            }

            // Save all citation instances to database
            if (finalInstancesToCreate.length > 0) {
              await saveCitationInstances(supabase, projectId, finalInstancesToCreate)
            }

            // Log final timing
            timings.total = Date.now() - requestStartTime
            console.log('[Autocomplete] Total timing (ms):', timings)

            if (!streamClosed) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'done',
                // Array of sentences for progressive display
                sentences: finalProcessedSentences,
                contextHint: finalContextHint,
                ragInfo: {
                  chunksUsed: ragContext.chunks.length,
                  claimsUsed: ragContext.claims.length,
                  papersReferenced: ragContext.papers.size
                },
                timing: timings  // Include timing in response for debugging
              })}\n\n`))

              streamClosed = true
              controller.close()
            }
          } catch (err) {
            console.error('Streaming error:', err)
            if (!streamClosed) {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'Streaming failed' })}\n\n`))
                controller.close()
              } catch {
                // Ignore - controller already closed
              }
              streamClosed = true
            }
          } finally {
            clearTimeout(timeout)
            request.signal.removeEventListener('abort', onRequestAbort)
          }
        },
        cancel() {
          streamClosed = true
          clearTimeout(timeout)
          request.signal.removeEventListener('abort', onRequestAbort)
          abortController.abort(new DOMException('Stream cancelled', 'AbortError'))
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Global-Search': effectivePaperIds.length === 0 ? '1' : '0',
        },
      })
    } catch (err) {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', onRequestAbort)
      throw err
    }

  } catch (error) {
    return handleError(error, 'Editor completion error')
  }
}
