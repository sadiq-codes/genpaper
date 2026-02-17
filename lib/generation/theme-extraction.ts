/**
 * Theme Extraction Service
 * 
 * Analyzes collected papers BEFORE outline generation to identify:
 * - Emergent themes that actually exist in the literature
 * - Scholarly debates and contradictions
 * - Gaps in the collected research
 * - Pivotal/influential publications
 * - Recommended organizational approach
 * 
 * This enables themes to EMERGE from actual literature rather than being
 * assumed from the topic alone (the Scribbr-aligned approach).
 */

import 'server-only'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { info, warn, error as logError } from '@/lib/utils/logger'
import { createServiceClient } from '@/lib/supabase/service'
import type { AnalysisResult } from '@/lib/analysis/cross-document'
import type { 
  ThemeAnalysis,
  ThemeExtractionInput,
  PaperProfile
} from './paper-profile-types'

// Note: These types are defined in paper-profile-types and shape the ThemeAnalysis output
// EmergentTheme, ScholarlyDebate, LiteratureGap, PivotalPaper, 
// MethodologicalApproach, OrganizationSuggestion
import type { PaperWithAuthors } from '@/types/simplified'

// ──────────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────────

/** Maximum number of papers to include full text excerpts for (top-ranked papers) */
const MAX_FULL_TEXT_PAPERS = 10

/** Maximum characters of full text excerpts per paper */
const MAX_EXCERPT_CHARS = 2000

/** Minimum chunk length to consider as "full text" (vs just abstract) */
const MIN_FULL_TEXT_CHUNK_LENGTH = 500

// ──────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extract themes from collected papers.
 * This should be called AFTER paper collection and BEFORE outline generation.
 * 
 * Uses a hybrid approach:
 * - Abstracts for all papers (always available)
 * - Full text excerpts for top-ranked papers (when available)
 * 
 * @param papers - Collected papers from the discovery step
 * @param topic - The research topic
 * @param profile - The paper profile (provides discipline context)
 * @returns ThemeAnalysis with emergent themes, debates, gaps, and pivotal papers
 */
export async function extractThemes(
  papers: PaperWithAuthors[],
  topic: string,
  profile: PaperProfile
): Promise<ThemeAnalysis> {
  const startTime = Date.now()
  
  info({ 
    paperCount: papers.length, 
    topic: topic.slice(0, 100),
    discipline: profile.discipline.primary 
  }, 'Starting theme extraction')
  
  try {
    // Step 1: Prepare input data with hybrid content gathering
    const input = await prepareThemeExtractionInput(papers, topic, profile)
    
    info({
      papersWithFullText: input.papers.filter(p => p.fullTextExcerpts && p.fullTextExcerpts.length > 0).length,
      totalPapers: input.papers.length
    }, 'Theme extraction input prepared')
    
    // Step 2: Call LLM for theme extraction
    const analysis = await performThemeExtraction(input)
    
    // Step 3: Enhance with citation-based pivotal paper detection
    const enhancedAnalysis = enhancePivotalPapers(analysis, papers)
    
    const duration = Date.now() - startTime
    info({
      themesFound: enhancedAnalysis.emergentThemes.length,
      debatesFound: enhancedAnalysis.debates.length,
      gapsFound: enhancedAnalysis.gaps.length,
      pivotalPapers: enhancedAnalysis.pivotalPapers.length,
      suggestedOrganization: enhancedAnalysis.organizationSuggestion.approach,
      durationMs: duration
    }, 'Theme extraction completed')
    
    return enhancedAnalysis
    
  } catch (error) {
    // Log with detailed error information
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    
    logError({ 
      errorMessage,
      errorStack,
      errorType: error?.constructor?.name || typeof error,
      topic,
      paperCount: papers.length
    }, 'Theme extraction failed')
    
    // Also log to console for visibility in dev
    console.error('Theme extraction error details:', {
      message: errorMessage,
      stack: errorStack,
      topic: topic.slice(0, 100)
    })
    
    // Return a minimal fallback analysis rather than failing completely
    return getFallbackThemeAnalysis(papers.length, topic)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Input Preparation (Hybrid Content Gathering)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Prepare the input for theme extraction with hybrid content gathering.
 * - All papers get their abstracts included
 * - Top-ranked papers also get full text excerpts if available
 */
async function prepareThemeExtractionInput(
  papers: PaperWithAuthors[],
  topic: string,
  profile: PaperProfile
): Promise<ThemeExtractionInput> {
  
  // Sort papers by relevance/authority score to prioritize top papers for full text
  const sortedPapers = [...papers].sort((a, b) => {
    const scoreA = (a.metadata as any)?.combined_score || (a.metadata as any)?.relevance_score || 0
    const scoreB = (b.metadata as any)?.combined_score || (b.metadata as any)?.relevance_score || 0
    return scoreB - scoreA
  })
  
  // Get full text excerpts for top papers
  const topPaperIds = sortedPapers.slice(0, MAX_FULL_TEXT_PAPERS).map(p => p.id)
  const fullTextMap = await getFullTextExcerpts(topPaperIds)
  
  // Build the input structure
  const inputPapers = sortedPapers.map(paper => ({
    id: paper.id,
    title: paper.title,
    abstract: paper.abstract,
    publicationDate: paper.publication_date,
    citationCount: paper.citation_count,
    venue: paper.venue,
    fullTextExcerpts: fullTextMap.get(paper.id)
  }))
  
  return {
    topic,
    profile,
    papers: inputPapers
  }
}

/**
 * Get full text excerpts for a set of papers from their chunks.
 * Returns the most relevant/representative chunks, not everything.
 */
async function getFullTextExcerpts(
  paperIds: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  
  if (paperIds.length === 0) {
    return result
  }
  
  try {
    // Use service client to bypass RLS - this runs in background generation jobs
    const supabase = createServiceClient()
    
    // Get chunks for these papers, filtering for substantial content
    const { data: chunks, error } = await supabase
      .from('paper_chunks')
      .select('paper_id, content, chunk_index')
      .in('paper_id', paperIds)
      .order('chunk_index', { ascending: true })
    
    if (error) {
      warn({ error }, 'Failed to fetch chunks for theme extraction')
      return result
    }
    
    // Group chunks by paper and filter for full-text chunks
    for (const chunk of chunks || []) {
      // Only include substantial chunks (not just abstracts)
      if (chunk.content && chunk.content.length >= MIN_FULL_TEXT_CHUNK_LENGTH) {
        const existing = result.get(chunk.paper_id) || []
        
        // Limit total excerpt length per paper
        const currentLength = existing.reduce((sum, e) => sum + e.length, 0)
        if (currentLength < MAX_EXCERPT_CHARS) {
          // Truncate if needed
          const remainingSpace = MAX_EXCERPT_CHARS - currentLength
          const excerpt = chunk.content.slice(0, remainingSpace)
          existing.push(excerpt)
          result.set(chunk.paper_id, existing)
        }
      }
    }
    
    return result
    
  } catch (error) {
    warn({ error }, 'Error fetching full text excerpts')
    return result
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// LLM-based Theme Extraction
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Perform the actual theme extraction using LLM.
 */
async function performThemeExtraction(
  input: ThemeExtractionInput
): Promise<ThemeAnalysis> {
  const model = getLanguageModel()
  
  const prompt = buildThemeExtractionPrompt(input)
  
  const response = await model.doGenerate({
    prompt: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: [{ type: 'text', text: prompt.user }] }
    ],
    responseFormat: {
      type: 'json',
      schema: THEME_ANALYSIS_JSON_SCHEMA
    },
    temperature: 0.3,
    maxOutputTokens: 4000
  })
  
  // In v3, response has content array with text parts
  const textPart = response.content?.find((p: { type: string }) => p.type === 'text')
  const responseText = textPart && 'text' in textPart ? textPart.text : undefined
  
  if (!responseText) {
    throw new Error('No response from theme extraction model')
  }
  
  // Check for truncation
  // Note: Cast to string to handle different type definitions across AI SDK versions
  const finishReason = response.finishReason as unknown as string
  if (finishReason === 'length') {
    warn({
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens
    }, 'Theme extraction response was truncated')
    throw new Error('Theme extraction response was truncated due to token limit')
  }
  
  let rawAnalysis: Record<string, unknown>
  try {
    rawAnalysis = JSON.parse(responseText)
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : String(parseError)
    warn({
      parseError: errorMsg,
      responsePreview: responseText?.slice(0, 500),
      finishReason
    }, 'Failed to parse theme extraction response')
    throw new Error(`Theme extraction JSON parse failed: ${errorMsg}`)
  }
  
  // Add metadata
  return {
    ...rawAnalysis,
    analyzedAt: new Date().toISOString(),
    papersAnalyzed: input.papers.length,
    papersWithFullText: input.papers.filter(p => p.fullTextExcerpts && p.fullTextExcerpts.length > 0).length
  } as ThemeAnalysis
}

/**
 * Build the prompt for theme extraction.
 */
function buildThemeExtractionPrompt(input: ThemeExtractionInput): { system: string; user: string } {
  const { topic, profile, papers } = input
  
  // Build paper summaries for the prompt
  const paperSummaries = papers.slice(0, 40).map((paper, idx) => {
    let summary = `[${idx + 1}] ID: ${paper.id}\n`
    summary += `    Title: ${paper.title}\n`
    if (paper.publicationDate) {
      summary += `    Year: ${paper.publicationDate.slice(0, 4)}\n`
    }
    if (paper.citationCount) {
      summary += `    Citations: ${paper.citationCount}\n`
    }
    if (paper.venue) {
      summary += `    Venue: ${paper.venue}\n`
    }
    if (paper.abstract) {
      summary += `    Abstract: ${paper.abstract.slice(0, 500)}${paper.abstract.length > 500 ? '...' : ''}\n`
    }
    if (paper.fullTextExcerpts && paper.fullTextExcerpts.length > 0) {
      summary += `    Full Text Excerpts:\n`
      for (const excerpt of paper.fullTextExcerpts) {
        summary += `      "${excerpt.slice(0, 300)}${excerpt.length > 300 ? '...' : ''}"\n`
      }
    }
    return summary
  }).join('\n')
  
  const system = `You are an expert research analyst specializing in ${profile.discipline.primary}. Your task is to analyze a collection of academic papers and identify:

1. **Emergent Themes**: What topics/concepts recur across multiple papers? These should EMERGE from the actual content, not be assumed.

2. **Scholarly Debates**: Where do authors disagree or present competing theories/findings?

3. **Literature Gaps**: What important questions are NOT adequately addressed by these papers?

4. **Pivotal Papers**: Which papers appear to be influential based on how often they're referenced or how foundational their methods/findings appear?

5. **Methodological Approaches**: What research methods are commonly used in this literature?

6. **Organizational Recommendation**: What structure would best organize a literature review of these papers?

Be specific and cite paper IDs to support your analysis. Your themes should reflect what the papers ACTUALLY discuss, not what you expect them to discuss based on the topic.

Field Context:
- Primary Discipline: ${profile.discipline.primary}
- Related Fields: ${profile.discipline.related.join(', ') || 'None specified'}
- Pace of Change: ${profile.discipline.fieldCharacteristics.paceOfChange}
- Theory vs Empirical Balance: ${profile.discipline.fieldCharacteristics.theoryVsEmpirical}`

  const user = `Analyze these ${papers.length} papers on the topic: "${topic}"

===== PAPERS TO ANALYZE =====
${paperSummaries}

===== ANALYSIS INSTRUCTIONS =====

Based on ONLY the papers above, identify:

1. EMERGENT THEMES (3-7 themes)
   - Name each theme descriptively (e.g., "Machine Learning Applications in Drug Discovery", not "Theme 1")
   - Rate strength as 'dominant' (appears in many papers), 'moderate' (several papers), or 'emerging' (few but notable)
   - List which paper IDs support each theme

2. SCHOLARLY DEBATES (1-4 debates)
   - Identify where papers present conflicting findings or competing theories
   - List the different positions and which papers support each

3. LITERATURE GAPS (2-5 gaps)
   - What important questions are these papers NOT answering?
   - Rate significance as 'critical', 'notable', or 'minor'

4. PIVOTAL PAPERS (3-8 papers)
   - Identify papers that seem foundational or frequently referenced
   - Explain WHY each appears influential
   - Note evidence type: citation_count (if high), frequently_referenced (mentioned by other papers), foundational_methods, or field_defining

5. METHODOLOGICAL APPROACHES
   - What research methods appear in these papers?
   - Rate prevalence as 'common', 'moderate', or 'rare'

6. ORGANIZATIONAL RECOMMENDATION
   - Recommend: 'thematic' (organize by themes), 'chronological' (trace development over time), 'methodological' (compare methods), 'theoretical' (organize by theories), or 'hybrid'
   - Explain your rationale
   - If hybrid, specify which approaches to combine
   - Suggest specific section titles based on your theme analysis

7. TEMPORAL SPAN
   - Note the earliest and latest publication years
   - Identify if there's a concentration period

8. CONFIDENCE & LIMITATIONS
   - Rate your confidence (0-1) based on data quality
   - Note any limitations (e.g., "Only abstracts available for most papers")

Return your analysis as JSON matching the required schema.`

  return { system, user }
}

// ──────────────────────────────────────────────────────────────────────────────
// Pivotal Paper Enhancement
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Enhance pivotal paper identification using citation counts when available.
 * Combines LLM inference with actual citation data.
 */
function enhancePivotalPapers(
  analysis: ThemeAnalysis,
  papers: PaperWithAuthors[]
): ThemeAnalysis {
  // Ensure all required arrays exist (LLM might omit them)
  if (!Array.isArray(analysis.pivotalPapers)) {
    analysis.pivotalPapers = []
  }
  if (!Array.isArray(analysis.emergentThemes)) {
    analysis.emergentThemes = []
  }
  if (!Array.isArray(analysis.debates)) {
    analysis.debates = []
  }
  if (!Array.isArray(analysis.gaps)) {
    analysis.gaps = []
  }
  if (!Array.isArray(analysis.methodologicalApproaches)) {
    analysis.methodologicalApproaches = []
  }
  if (!analysis.organizationSuggestion) {
    analysis.organizationSuggestion = {
      approach: 'thematic',
      rationale: 'Default thematic organization'
    }
  }
  if (typeof analysis.confidence !== 'number') {
    analysis.confidence = 0.5
  }
  
  // Create a map of paper ID to citation count
  const citationMap = new Map<string, number>()
  for (const paper of papers) {
    if (paper.citation_count && paper.citation_count > 0) {
      citationMap.set(paper.id, paper.citation_count)
    }
  }
  
  // Find high-citation papers that weren't identified by LLM
  const identifiedIds = new Set(analysis.pivotalPapers.map(p => p.paperId))
  
  // Sort papers by citation count
  const highCitationPapers = papers
    .filter(p => p.citation_count && p.citation_count > 50 && !identifiedIds.has(p.id))
    .sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))
    .slice(0, 3)  // Add up to 3 more high-citation papers
  
  // Add them to pivotal papers
  for (const paper of highCitationPapers) {
    analysis.pivotalPapers.push({
      paperId: paper.id,
      title: paper.title,
      reason: `Highly cited paper with ${paper.citation_count} citations`,
      citationCount: paper.citation_count,
      evidenceType: 'citation_count'
    })
  }
  
  // Update citation counts for LLM-identified papers
  for (const pivotal of analysis.pivotalPapers) {
    if (!pivotal.citationCount && citationMap.has(pivotal.paperId)) {
      pivotal.citationCount = citationMap.get(pivotal.paperId)
    }
  }
  
  // Sort by citation count (descending), then by evidence strength
  analysis.pivotalPapers.sort((a, b) => {
    // Papers with citation counts first
    if (a.citationCount && !b.citationCount) return -1
    if (!a.citationCount && b.citationCount) return 1
    if (a.citationCount && b.citationCount) {
      return b.citationCount - a.citationCount
    }
    return 0
  })
  
  return analysis
}

// ──────────────────────────────────────────────────────────────────────────────
// Fallback Analysis
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Generate a minimal fallback analysis when extraction fails.
 */
function getFallbackThemeAnalysis(paperCount: number, topic: string): ThemeAnalysis {
  warn({ paperCount, topic }, 'Using fallback theme analysis')
  
  return {
    analyzedAt: new Date().toISOString(),
    papersAnalyzed: paperCount,
    papersWithFullText: 0,
    emergentThemes: [
      {
        name: `Current Research in ${topic}`,
        description: 'General theme covering the main topic area',
        supportingPaperIds: [],
        strength: 'dominant'
      }
    ],
    debates: [],
    gaps: [
      {
        description: 'Theme analysis was not available - gaps should be identified manually',
        relatedThemes: [],
        significance: 'notable'
      }
    ],
    pivotalPapers: [],
    methodologicalApproaches: [],
    organizationSuggestion: {
      approach: 'thematic',
      rationale: 'Thematic organization is generally suitable for most literature reviews'
    },
    confidence: 0.2,
    limitations: ['Theme extraction failed - using fallback analysis']
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// JSON Schema for LLM Response
// ──────────────────────────────────────────────────────────────────────────────

const THEME_ANALYSIS_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    emergentThemes: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          description: { type: 'string' as const },
          supportingPaperIds: { type: 'array' as const, items: { type: 'string' as const } },
          strength: { type: 'string' as const, enum: ['dominant', 'moderate', 'emerging'] },
          keyTerms: { type: 'array' as const, items: { type: 'string' as const } }
        },
        required: ['name', 'description', 'supportingPaperIds', 'strength', 'keyTerms'],
        additionalProperties: false
      }
    },
    debates: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          topic: { type: 'string' as const },
          positions: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                stance: { type: 'string' as const },
                supportingPaperIds: { type: 'array' as const, items: { type: 'string' as const } }
              },
              required: ['stance', 'supportingPaperIds'],
              additionalProperties: false
            }
          },
          significance: { type: 'string' as const }
        },
        required: ['topic', 'positions', 'significance'],
        additionalProperties: false
      }
    },
    gaps: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          description: { type: 'string' as const },
          relatedThemes: { type: 'array' as const, items: { type: 'string' as const } },
          significance: { type: 'string' as const, enum: ['critical', 'notable', 'minor'] },
          potentialDirections: { type: 'array' as const, items: { type: 'string' as const } }
        },
        required: ['description', 'relatedThemes', 'significance', 'potentialDirections'],
        additionalProperties: false
      }
    },
    pivotalPapers: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          paperId: { type: 'string' as const },
          title: { type: 'string' as const },
          reason: { type: 'string' as const },
          citationCount: { type: 'number' as const },
          evidenceType: { 
            type: 'string' as const, 
            enum: ['citation_count', 'frequently_referenced', 'foundational_methods', 'field_defining'] 
          }
        },
        required: ['paperId', 'title', 'reason', 'citationCount', 'evidenceType'],
        additionalProperties: false
      }
    },
    methodologicalApproaches: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          paperIds: { type: 'array' as const, items: { type: 'string' as const } },
          prevalence: { type: 'string' as const, enum: ['common', 'moderate', 'rare'] }
        },
        required: ['name', 'paperIds', 'prevalence'],
        additionalProperties: false
      }
    },
    organizationSuggestion: {
      type: 'object' as const,
      properties: {
        approach: { 
          type: 'string' as const, 
          enum: ['thematic', 'chronological', 'methodological', 'theoretical', 'hybrid'] 
        },
        rationale: { type: 'string' as const },
        hybridComponents: { 
          type: 'array' as const, 
          items: { type: 'string' as const } 
        },
        suggestedSections: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              title: { type: 'string' as const },
              description: { type: 'string' as const },
              relatedThemes: { type: 'array' as const, items: { type: 'string' as const } }
            },
            required: ['title', 'description', 'relatedThemes'],
            additionalProperties: false
          }
        }
      },
      required: ['approach', 'rationale', 'hybridComponents', 'suggestedSections'],
      additionalProperties: false
    },
    temporalSpan: {
      type: 'object' as const,
      properties: {
        earliest: { type: 'number' as const },
        latest: { type: 'number' as const },
        concentrationPeriod: { type: 'string' as const }
      },
      required: ['earliest', 'latest', 'concentrationPeriod'],
      additionalProperties: false
    },
    confidence: { type: 'number' as const },
    limitations: { type: 'array' as const, items: { type: 'string' as const } }
  },
  required: [
    'emergentThemes', 
    'debates', 
    'gaps', 
    'pivotalPapers', 
    'methodologicalApproaches',
    'organizationSuggestion',
    'temporalSpan',
    'confidence',
    'limitations'
  ],
  additionalProperties: false
}

// ──────────────────────────────────────────────────────────────────────────────
// Profile Enhancement
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Merge theme analysis results back into the paper profile.
 * This enriches the profile with emergent themes and other insights
 * discovered from actual literature.
 * 
 * @param profile - The original paper profile
 * @param analysis - Theme analysis from collected papers
 * @returns Enhanced profile with emergent themes merged in
 */
export function mergeThemeAnalysisIntoProfile(
  profile: PaperProfile,
  analysis: ThemeAnalysis
): PaperProfile {
  const enhanced = { ...profile }
  
  // Replace guessed themes with emergent themes from actual literature
  const emergentThemeNames = analysis.emergentThemes.map(t => t.name)
  
  // Keep required themes that overlap with emergent themes
  const overlappingRequired = enhanced.coverage.requiredThemes.filter(theme => 
    emergentThemeNames.some(emergent => 
      themeNamesOverlap(theme, emergent)
    )
  )
  
  // Add dominant emergent themes to required themes
  const dominantThemes = analysis.emergentThemes
    .filter(t => t.strength === 'dominant')
    .map(t => t.name)
  
  enhanced.coverage.requiredThemes = [
    ...new Set([...overlappingRequired, ...dominantThemes])
  ]
  
  // Add moderate/emerging themes to recommended
  const otherThemes = analysis.emergentThemes
    .filter(t => t.strength !== 'dominant')
    .map(t => t.name)
  
  enhanced.coverage.recommendedThemes = [
    ...new Set([...enhanced.coverage.recommendedThemes, ...otherThemes])
  ]
  
  // Add debates from analysis
  const debateDescriptions = analysis.debates.map(d => d.topic)
  enhanced.coverage.debates = [
    ...new Set([...enhanced.coverage.debates, ...debateDescriptions])
  ]
  
  // Add methodological considerations
  const methodNames = analysis.methodologicalApproaches
    .filter(m => m.prevalence === 'common' || m.prevalence === 'moderate')
    .map(m => `${m.name} approach`)
  
  enhanced.coverage.methodologicalConsiderations = [
    ...new Set([...enhanced.coverage.methodologicalConsiderations, ...methodNames])
  ]
  
  // Add gap-related pitfalls
  const gapWarnings = analysis.gaps
    .filter(g => g.significance === 'critical' || g.significance === 'notable')
    .map(g => `Address gap: ${g.description}`)
  
  // Don't overwhelm pitfalls, add top 2 critical gaps
  enhanced.coverage.commonPitfalls = [
    ...enhanced.coverage.commonPitfalls,
    ...gapWarnings.slice(0, 2)
  ]
  
  info({
    originalRequiredThemes: profile.coverage.requiredThemes.length,
    newRequiredThemes: enhanced.coverage.requiredThemes.length,
    debatesAdded: debateDescriptions.length,
    methodsAdded: methodNames.length
  }, 'Profile enhanced with theme analysis')
  
  return enhanced
}

/**
 * Check if two theme names refer to similar concepts.
 */
function themeNamesOverlap(theme1: string, theme2: string): boolean {
  const words1 = theme1.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  const words2 = theme2.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  
  // Check if at least 40% of significant words overlap
  const matches = words1.filter(w => words2.some(w2 => w2.includes(w) || w.includes(w2)))
  return matches.length >= Math.min(2, Math.ceil(words1.length * 0.4))
}

// ──────────────────────────────────────────────────────────────────────────────
// AnalysisResult-based helpers (preferred for hybrid pipeline)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Merge cross-document AnalysisResult into the paper profile.
 * This is the preferred path for the hybrid synthesis pipeline (no ThemeAnalysis adapter).
 */
export function mergeAnalysisResultIntoProfile(
  profile: PaperProfile,
  analysis: AnalysisResult
): PaperProfile {
  const enhanced = { ...profile }

  // Treat patterns as emergent themes (use the specific pattern claim)
  const emergentThemeNames = (analysis.patterns || []).map(p => p.claim)

  // Keep required themes that overlap with emergent themes
  const overlappingRequired = enhanced.coverage.requiredThemes.filter(theme =>
    emergentThemeNames.some(emergent => themeNamesOverlap(theme, emergent))
  )

  // Strong patterns become required; others become recommended
  const strongThemes = (analysis.patterns || [])
    .filter(p => p.strength === 'strong')
    .map(p => p.claim)

  enhanced.coverage.requiredThemes = [...new Set([...overlappingRequired, ...strongThemes])]

  const otherThemes = (analysis.patterns || [])
    .filter(p => p.strength !== 'strong')
    .map(p => p.claim)

  enhanced.coverage.recommendedThemes = [
    ...new Set([...(enhanced.coverage.recommendedThemes || []), ...otherThemes])
  ]

  // Debates from contradictions
  const debateDescriptions = (analysis.contradictions || []).map(c => c.description)
  enhanced.coverage.debates = [...new Set([...(enhanced.coverage.debates || []), ...debateDescriptions])]

  // Methodological considerations: contradictions explicitly marked methodological
  const methodNotes = (analysis.contradictions || [])
    .filter(c => c.contradictionType === 'methodological')
    .map(c => `Methodological inconsistency: ${c.description}`)

  enhanced.coverage.methodologicalConsiderations = [
    ...new Set([...(enhanced.coverage.methodologicalConsiderations || []), ...methodNotes])
  ]

  // Gap-related pitfalls (cap to avoid overwhelming)
  const gapWarnings = (analysis.gaps || [])
    .filter(g => g.priority !== 'low') // include undefined + medium/high
    .map(g => `Address gap: ${g.description}`)

  enhanced.coverage.commonPitfalls = [
    ...(enhanced.coverage.commonPitfalls || []),
    ...gapWarnings.slice(0, 2)
  ]

  info(
    {
      originalRequiredThemes: profile.coverage.requiredThemes.length,
      newRequiredThemes: enhanced.coverage.requiredThemes.length,
      patterns: analysis.patterns?.length || 0,
      contradictions: analysis.contradictions?.length || 0,
      gaps: analysis.gaps?.length || 0
    },
    'Profile enhanced with cross-document analysis'
  )

  return enhanced
}

/**
 * Build outline guidance text directly from AnalysisResult.
 * Kept close to the ThemeAnalysis guidance format so existing outline prompting remains effective.
 */
export function buildAnalysisGuidanceForOutline(analysis: AnalysisResult): string {
  const patterns = analysis.patterns || []
  const contradictions = analysis.contradictions || []
  const gaps = analysis.gaps || []

  // Compute a rough confidence (0-1) from top signals
  const patternConf = patterns.length ? patterns.slice(0, 5).reduce((s, p) => s + (p.confidence || 0), 0) / Math.min(5, patterns.length) : 0.5
  const contraConf = contradictions.length ? contradictions.slice(0, 5).reduce((s, c) => s + (c.confidence || 0), 0) / Math.min(5, contradictions.length) : 0.5
  const gapConf = gaps.length ? gaps.slice(0, 5).reduce((s, g) => s + (g.confidence || 0), 0) / Math.min(5, gaps.length) : 0.5
  const confidence = Math.max(0, Math.min(1, (patternConf + contraConf + gapConf) / 3))

  const themesText = patterns
    .map(p => {
      const strength = p.strength === 'strong' ? '***' : p.strength === 'moderate' ? '**' : '*'
      const total = p.support?.total || analysis.analyzedPapers || 0
      const count = p.support?.count || (p.support?.papers?.length || 0)
      const pct = total > 0 ? Math.round((count / total) * 100) : 0
      const desc = `${p.summary}. This pattern is supported by ${count} of ${total} papers (${pct}%).`
      return `${strength} ${p.claim}: ${desc} (${count} papers)`
    })
    .join('\n') || 'No major cross-paper patterns identified'

  const debatesText = contradictions.length > 0
    ? contradictions.map(c => `- ${c.description}`).join('\n')
    : 'No major debates identified'

  const gapLabel = (priority?: string) => {
    if (priority === 'high') return 'critical'
    if (priority === 'medium') return 'notable'
    if (priority === 'low') return 'minor'
    return 'notable'
  }

  const gapsText = gaps
    .filter(g => gapLabel(g.priority) !== 'minor')
    .map(g => `- [${gapLabel(g.priority)}] ${g.description}`)
    .join('\n') || 'No critical gaps identified'

  // Pivotal papers: most frequently referenced in pattern supports (paperTitle is included in supports)
  const paperCounts = new Map<string, { title: string; count: number }>()
  for (const p of patterns) {
    for (const sup of p.support?.papers || []) {
      const existing = paperCounts.get(sup.paperId)
      if (existing) {
        existing.count++
      } else {
        paperCounts.set(sup.paperId, { title: sup.paperTitle || 'Unknown', count: 1 })
      }
    }
  }
  const pivotalText = [...paperCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([paperId, meta]) => `- ${meta.title} (Supports ${meta.count} pattern(s) | ${paperId})`)
    .join('\n') || 'No pivotal publications identified'

  // Organizational suggestion (simple heuristic)
  let approach: 'thematic' | 'hybrid' = 'thematic'
  let rationale = 'Thematic organization allows for clear synthesis of findings across papers.'
  if (patterns.length >= 3) {
    approach = 'thematic'
    rationale = `Analysis identified ${patterns.length} distinct patterns that can serve as organizing themes.`
  } else if (contradictions.length >= 2) {
    approach = 'hybrid'
    rationale = `With ${contradictions.length} scholarly debates, a hybrid thematic-argumentative structure is recommended.`
  }

  return `## THEME ANALYSIS FROM COLLECTED LITERATURE
**Confidence:** ${(confidence * 100).toFixed(0)}% | **Papers Analyzed:** ${analysis.analyzedPapers}

### Emergent Themes (from actual papers)
${themesText}

### Scholarly Debates
${debatesText}

### Literature Gaps to Address
${gapsText}

### Pivotal Publications to Highlight
${pivotalText}

### Organizational Approach
**Recommended:** ${approach}
**Rationale:** ${rationale}`
}

/**
 * Build guidance text from theme analysis for use in outline generation.
 * This helps the outline generator use emergent themes rather than guessing.
 */
export function buildThemeGuidanceForOutline(analysis: ThemeAnalysis): string {
  const themes = analysis.emergentThemes
    .map(t => {
      const strength = t.strength === 'dominant' ? '***' : t.strength === 'moderate' ? '**' : '*'
      return `${strength} ${t.name}: ${t.description} (${t.supportingPaperIds.length} papers)`
    })
    .join('\n')
  
  const debates = analysis.debates.length > 0
    ? analysis.debates.map(d => `- ${d.topic}`).join('\n')
    : 'No major debates identified'
  
  const gaps = analysis.gaps
    .filter(g => g.significance !== 'minor')
    .map(g => `- [${g.significance}] ${g.description}`)
    .join('\n') || 'No critical gaps identified'
  
  const pivotal = analysis.pivotalPapers
    .slice(0, 5)
    .map(p => `- ${p.title} (${p.reason})`)
    .join('\n')
  
  const orgApproach = analysis.organizationSuggestion
  let orgGuidance = `**Recommended:** ${orgApproach.approach}\n**Rationale:** ${orgApproach.rationale}`
  
  if (orgApproach.suggestedSections && orgApproach.suggestedSections.length > 0) {
    orgGuidance += '\n**Suggested Sections:**\n' + 
      orgApproach.suggestedSections.map(s => `- ${s.title}: ${s.description}`).join('\n')
  }
  
  return `## THEME ANALYSIS FROM COLLECTED LITERATURE
**Confidence:** ${(analysis.confidence * 100).toFixed(0)}% | **Papers Analyzed:** ${analysis.papersAnalyzed}

### Emergent Themes (from actual papers)
${themes}

### Scholarly Debates
${debates}

### Literature Gaps to Address
${gaps}

### Pivotal Publications to Highlight
${pivotal}

### Organizational Approach
${orgGuidance}

${analysis.limitations && analysis.limitations.length > 0 ? `\n**Limitations:** ${analysis.limitations.join('; ')}` : ''}`
}
