import 'server-only'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { generateObject } from 'ai'
import { z } from 'zod'
import { getSB } from '@/lib/supabase/server'
import { getClaimsForPaper, type ExtractedClaim } from './claim-extractor'

/**
 * Gap Finder - Identifies research gaps from extracted claims
 * 
 * Analyzes claims across papers to find:
 * - Unstudied areas (topics not covered by any paper)
 * - Contradictions (conflicting findings between papers)
 * - Methodological limitations (shared weaknesses across studies)
 */

export type GapType = 'unstudied' | 'contradiction' | 'limitation'

// Schema for identified gaps
const GapSchema = z.object({
  gap_type: z.enum(['unstudied', 'contradiction', 'limitation']),
  description: z.string().describe('Clear description of the research gap'),
  evidence: z.array(z.object({
    paper_id: z.string(),
    claim_text: z.string(),
    relevance: z.string().describe('How this claim relates to the gap')
  })).describe('Claims that support the identification of this gap'),
  confidence: z.number().min(0).max(1).describe('Confidence in this gap identification'),
  research_opportunity: z.string().optional().describe('Potential research direction to address this gap')
})

const GapsResponseSchema = z.object({
  gaps: z.array(GapSchema).describe('List of identified research gaps'),
  synthesis_notes: z.string().optional().describe('Overall observations about the research landscape')
})

export interface ResearchGap {
  id?: string
  project_id?: string
  gap_type: GapType
  description: string
  evidence: Array<{
    paper_id: string
    claim_text: string
    relevance: string
  }>
  supporting_paper_ids: string[]
  confidence: number
  research_opportunity?: string
}

export interface GapAnalysisResult {
  gaps: ResearchGap[]
  synthesis_notes?: string
  processing_time_ms: number
  error?: string
}

/**
 * Analyze claims to find research gaps
 */
export async function findResearchGaps(
  projectId: string,
  paperIds: string[],
  topic: string
): Promise<GapAnalysisResult> {
  const startTime = Date.now()
  
  try {
    // Get all claims for the papers
    const allClaims: ExtractedClaim[] = []
    for (const paperId of paperIds) {
      const claims = await getClaimsForPaper(paperId)
      allClaims.push(...claims)
    }

    if (allClaims.length === 0) {
      return {
        gaps: [],
        processing_time_ms: Date.now() - startTime,
        error: 'No claims found for analysis. Extract claims first.'
      }
    }

    // Group claims by type for analysis
    const claimsByType = groupClaimsByType(allClaims)
    const claimsByPaper = groupClaimsByPaper(allClaims)

    // Build context for LLM analysis
    const analysisContext = buildAnalysisContext(topic, claimsByType, claimsByPaper)

    // Use GPT to identify gaps
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: GapsResponseSchema,
      prompt: buildGapAnalysisPrompt(topic, analysisContext),
      temperature: 0.2,
    })

    // Process gaps and add metadata
    const gaps: ResearchGap[] = object.gaps.map(gap => ({
      ...gap,
      project_id: projectId,
      gap_type: gap.gap_type as GapType,
      supporting_paper_ids: [...new Set(gap.evidence.map(e => e.paper_id))]
    }))

    return {
      gaps,
      synthesis_notes: object.synthesis_notes,
      processing_time_ms: Date.now() - startTime
    }
  } catch (error) {
    console.error('Gap analysis failed:', error)
    return {
      gaps: [],
      processing_time_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Store identified gaps in database
 */
export async function storeResearchGaps(
  projectId: string,
  gaps: ResearchGap[]
): Promise<{ success: boolean; error?: string }> {
  const supabase = await getSB()
  
  if (gaps.length === 0) {
    return { success: true }
  }

  const { error } = await supabase
    .from('research_gaps')
    .insert(
      gaps.map(gap => ({
        project_id: projectId,
        gap_type: gap.gap_type,
        description: gap.description,
        evidence: gap.evidence,
        supporting_paper_ids: gap.supporting_paper_ids,
        confidence: gap.confidence
      }))
    )

  if (error) {
    console.error('Failed to store gaps:', error)
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Get gaps for a project
 */
export async function getGapsForProject(projectId: string): Promise<ResearchGap[]> {
  const supabase = await getSB()
  
  const { data, error } = await supabase
    .from('research_gaps')
    .select('*')
    .eq('project_id', projectId)
    .order('confidence', { ascending: false })

  if (error) {
    console.error('Failed to fetch gaps:', error)
    return []
  }

  return data || []
}

/**
 * Find contradictions between specific papers
 */
export async function findContradictions(
  paperIds: string[]
): Promise<ResearchGap[]> {
  const allClaims: ExtractedClaim[] = []
  for (const paperId of paperIds) {
    const claims = await getClaimsForPaper(paperId)
    allClaims.push(...claims)
  }

  // Filter to findings only (most likely to contradict)
  const findings = allClaims.filter(c => c.claim_type === 'finding')
  
  if (findings.length < 2) {
    return []
  }

  // Use GPT to find contradictions
  const { object } = await generateObject({
    model: getLanguageModel(),
    schema: z.object({
      contradictions: z.array(z.object({
        claim_a: z.string(),
        claim_b: z.string(),
        paper_a_id: z.string(),
        paper_b_id: z.string(),
        explanation: z.string(),
        confidence: z.number()
      }))
    }),
    prompt: buildContradictionPrompt(findings),
    temperature: 0.1,
  })

  return object.contradictions.map(c => ({
    gap_type: 'contradiction' as GapType,
    description: c.explanation,
    evidence: [
      { paper_id: c.paper_a_id, claim_text: c.claim_a, relevance: 'First claim' },
      { paper_id: c.paper_b_id, claim_text: c.claim_b, relevance: 'Contradicting claim' }
    ],
    supporting_paper_ids: [c.paper_a_id, c.paper_b_id],
    confidence: c.confidence
  }))
}

// Helper functions

function groupClaimsByType(claims: ExtractedClaim[]): Record<string, ExtractedClaim[]> {
  const groups: Record<string, ExtractedClaim[]> = {
    finding: [],
    method: [],
    limitation: [],
    future_work: [],
    background: []
  }
  
  for (const claim of claims) {
    if (groups[claim.claim_type]) {
      groups[claim.claim_type].push(claim)
    }
  }
  
  return groups
}

function groupClaimsByPaper(claims: ExtractedClaim[]): Record<string, ExtractedClaim[]> {
  const groups: Record<string, ExtractedClaim[]> = {}
  
  for (const claim of claims) {
    if (!groups[claim.paper_id]) {
      groups[claim.paper_id] = []
    }
    groups[claim.paper_id].push(claim)
  }
  
  return groups
}

function buildAnalysisContext(
  topic: string,
  claimsByType: Record<string, ExtractedClaim[]>,
  claimsByPaper: Record<string, ExtractedClaim[]>
): string {
  let context = `Topic: ${topic}\n\n`
  context += `Papers analyzed: ${Object.keys(claimsByPaper).length}\n`
  context += `Total claims extracted: ${Object.values(claimsByType).flat().length}\n\n`
  
  // Summarize findings
  context += `KEY FINDINGS (${claimsByType.finding.length} claims):\n`
  for (const claim of claimsByType.finding.slice(0, 20)) {
    context += `- [Paper ${claim.paper_id.slice(0, 8)}] ${claim.claim_text}\n`
  }
  
  context += `\nMETHODS USED (${claimsByType.method.length} claims):\n`
  for (const claim of claimsByType.method.slice(0, 10)) {
    context += `- [Paper ${claim.paper_id.slice(0, 8)}] ${claim.claim_text}\n`
  }
  
  context += `\nSTATED LIMITATIONS (${claimsByType.limitation.length} claims):\n`
  for (const claim of claimsByType.limitation.slice(0, 10)) {
    context += `- [Paper ${claim.paper_id.slice(0, 8)}] ${claim.claim_text}\n`
  }
  
  context += `\nFUTURE WORK SUGGESTIONS (${claimsByType.future_work.length} claims):\n`
  for (const claim of claimsByType.future_work.slice(0, 10)) {
    context += `- [Paper ${claim.paper_id.slice(0, 8)}] ${claim.claim_text}\n`
  }
  
  return context
}

function buildGapAnalysisPrompt(topic: string, context: string): string {
  return `You are a research analyst identifying gaps in the current literature.

Given the following analysis of papers on "${topic}", identify:

1. UNSTUDIED AREAS: Topics, questions, or aspects that none of the papers address but are relevant to the topic.

2. CONTRADICTIONS: Cases where different papers report conflicting findings or conclusions.

3. METHODOLOGICAL LIMITATIONS: Common weaknesses or limitations shared across multiple studies.

${context}

For each gap:
- Provide a clear, specific description
- Reference the relevant claims as evidence
- Rate your confidence (1.0 = very clear gap, 0.5 = possible gap)
- Suggest a potential research opportunity to address it

Focus on significant, actionable gaps that would inform future research.
Aim to identify 3-10 gaps total, prioritizing the most important ones.`
}

function buildContradictionPrompt(findings: ExtractedClaim[]): string {
  let prompt = `Analyze these research findings for contradictions:\n\n`
  
  for (const finding of findings) {
    prompt += `[Paper ${finding.paper_id}]: ${finding.claim_text}\n`
  }
  
  prompt += `\nIdentify any pairs of findings that directly contradict each other.
A contradiction occurs when:
- Two papers report opposite results
- One paper's finding invalidates another's conclusion
- Methodological differences lead to incompatible findings

Only report clear contradictions, not just differences in scope or focus.`
  
  return prompt
}

/**
 * Analyze how user's original research addresses identified gaps
 */
export interface UserClaim {
  id: string
  claim_text: string
  claim_type: string
}

export interface GapAddressingResult {
  gap_id: string
  addressed_status: 'fully_addressed' | 'partially_addressed' | 'not_addressed'
  user_contribution?: string
}

const GapAddressingSchema = z.object({
  results: z.array(z.object({
    gap_id: z.string(),
    addressed_status: z.enum(['fully_addressed', 'partially_addressed', 'not_addressed']),
    user_contribution: z.string().optional().describe('How the user research addresses this gap')
  }))
})

export async function analyzeGapAddressing(
  gaps: ResearchGap[],
  userClaims: UserClaim[]
): Promise<GapAddressingResult[]> {
  if (gaps.length === 0 || userClaims.length === 0) {
    return gaps.map(g => ({
      gap_id: g.id || '',
      addressed_status: 'not_addressed' as const
    }))
  }

  try {
    // Build context for analysis
    const userClaimsSummary = userClaims
      .map(c => `- [${c.claim_type}] ${c.claim_text}`)
      .join('\n')
    
    const gapsSummary = gaps
      .map(g => `ID: ${g.id}\nType: ${g.gap_type}\nDescription: ${g.description}`)
      .join('\n\n')

    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: GapAddressingSchema,
      prompt: buildGapAddressingPrompt(userClaimsSummary, gapsSummary),
      temperature: 0.1,
    })

    return object.results
  } catch (error) {
    console.error('Gap addressing analysis failed:', error)
    return gaps.map(g => ({
      gap_id: g.id || '',
      addressed_status: 'not_addressed' as const
    }))
  }
}

function buildGapAddressingPrompt(userClaimsSummary: string, gapsSummary: string): string {
  return `You are analyzing how a researcher's original work addresses identified gaps in the literature.

THE RESEARCHER'S CLAIMS (from their original research):
${userClaimsSummary}

RESEARCH GAPS IDENTIFIED IN THE LITERATURE:
${gapsSummary}

For each gap, determine:
1. Does the researcher's work address this gap?
   - "fully_addressed": The research directly and completely addresses this gap
   - "partially_addressed": The research partially addresses or is related to this gap
   - "not_addressed": The research does not address this gap

2. If addressed (fully or partially), briefly explain HOW the researcher's work contributes to filling this gap.

Be generous but accurate - if the researcher's work is even tangentially related to a gap, consider it "partially_addressed".
Focus on substantive connections, not superficial topic overlap.`
}
