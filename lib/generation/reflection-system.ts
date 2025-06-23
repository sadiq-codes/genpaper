import 'server-only'
import { streamText } from 'ai'
import { ai } from '@/lib/ai/vercel-client'
import { PaperTypeKey, SectionKey } from '@/lib/prompts/types'
import { calculateContentMetricsAsync } from './metrics-system'
import { estimateTokenCount } from '@/lib/utils/text'
import type { ReflectionResult } from './production-generator'
import type { PaperWithAuthors } from '@/types/simplified'

// Configurable thresholds (can be overridden via environment)
const REFLECTION_CONFIG = {
  MIN_WORDS_FOR_REFLECTION: parseInt(process.env.MIN_WORDS_FOR_REFLECTION || '300'),
  MIN_WORDS_FOR_FULL_REFLECTION: parseInt(process.env.MIN_WORDS_FOR_FULL_REFLECTION || '800'),
  MAX_REFLECTION_CYCLES_SHORT: parseInt(process.env.MAX_REFLECTION_CYCLES_SHORT || '1'),
  MAX_REFLECTION_CYCLES_LONG: parseInt(process.env.MAX_REFLECTION_CYCLES_LONG || '2'),
  COMPLEXITY_THRESHOLD: parseFloat(process.env.COMPLEXITY_THRESHOLD || '0.6')
}

/**
 * Self-critique and reflection system for content improvement
 * After generating content, model critiques its own work and suggests improvements
 */

export interface ContentCritique {
  factual_errors: Array<{
    error: string
    severity: 'low' | 'medium' | 'high'
    suggestion: string
    location?: string
  }>
  missing_citations: Array<{
    claim: string
    severity: 'low' | 'medium' | 'high'
    suggested_sources: string[]
  }>
  vague_claims: Array<{
    claim: string
    specificity_needed: string
    improvement_suggestion: string
  }>
  structural_issues: Array<{
    issue: string
    severity: 'low' | 'medium' | 'high'
    solution: string
  }>
  overall_quality: {
    score: number // 0-100
    strengths: string[]
    weaknesses: string[]
    priority_improvements: string[]
  }
}

export interface RevisedContent {
  content: string
  improvements_made: string[]
  remaining_issues: string[]
  quality_improvement: number // percentage improvement
}

/**
 * Raw critique interface for validation
 */
interface RawCritique {
  factual_errors?: unknown
  missing_citations?: unknown
  vague_claims?: unknown
  structural_issues?: unknown
  overall_quality?: {
    score?: number
    strengths?: unknown
    weaknesses?: unknown
    priority_improvements?: unknown
  }
}

/**
 * Validate critique elements structure
 */
function validateCritiqueElements(elements: unknown[]): boolean {
  return elements.every(element => {
    if (typeof element !== 'object' || element === null) return false
    
    // Check if element has required string properties (basic validation)
    const obj = element as Record<string, unknown>
    return typeof obj.error === 'string' || 
           typeof obj.claim === 'string' || 
           typeof obj.issue === 'string'
  })
}

/**
 * Ensure critique data structure is valid and safe to use
 */
function validateAndNormalizeCritique(critique: RawCritique): ContentCritique {
  return {
    factual_errors: Array.isArray(critique.factual_errors) && validateCritiqueElements(critique.factual_errors) ? 
                   critique.factual_errors : [],
    missing_citations: Array.isArray(critique.missing_citations) && validateCritiqueElements(critique.missing_citations) ? 
                      critique.missing_citations : [],
    vague_claims: Array.isArray(critique.vague_claims) && validateCritiqueElements(critique.vague_claims) ? 
                 critique.vague_claims : [],
    structural_issues: Array.isArray(critique.structural_issues) && validateCritiqueElements(critique.structural_issues) ? 
                      critique.structural_issues : [],
    overall_quality: {
      score: typeof critique.overall_quality?.score === 'number' ? critique.overall_quality.score : 70,
      strengths: Array.isArray(critique.overall_quality?.strengths) ? critique.overall_quality.strengths : ['Content generated successfully'],
      weaknesses: Array.isArray(critique.overall_quality?.weaknesses) ? critique.overall_quality.weaknesses : 
                  typeof critique.overall_quality?.weaknesses === 'string' ? [critique.overall_quality.weaknesses] : 
                  ['Automated critique unavailable'],
      priority_improvements: Array.isArray(critique.overall_quality?.priority_improvements) ? critique.overall_quality.priority_improvements : 
                            typeof critique.overall_quality?.priority_improvements === 'string' ? [critique.overall_quality.priority_improvements] : 
                            ['Manual review recommended']
    }
  }
}

/**
 * Generate critique of the content
 */
export async function critiqueContent(
  content: string,
  paperType: PaperTypeKey,
  section: SectionKey,
  topic: string,
  availablePapers: string[],
  contextChunks: string[]
): Promise<ReflectionResult> {
  
  const critiquePrompt = {
    system: `You are an expert academic reviewer critiquing a ${section} section of a ${paperType}.

Analyze the content thoroughly and respond with NOTHING BUT a single, valid JSON object.

The JSON must include:
1. "factual_errors": Array of potential errors with severity and suggestions
2. "missing_citations": Array of claims that need citations
3. "vague_claims": Array of claims that need more specificity
4. "structural_issues": Array of organizational or flow problems
5. "overall_quality": Object with score (0-100), strengths (array), weaknesses (array), and priority_improvements (array)

CRITICAL: All arrays must be actual arrays, not strings. Be critical but constructive.`,

    user: `Critique this ${section} section on "${topic}":

${content}

Available papers for citation: ${availablePapers.join(', ')}
Context available: ${contextChunks.slice(0, 2).join('; ')}

Provide detailed JSON critique focusing on:
- Factual accuracy and evidence support
- Citation adequacy and placement
- Claim specificity and vagueness
- Structural coherence and flow
- Overall academic quality

IMPORTANT: Ensure strengths, weaknesses, and priority_improvements are arrays of strings.
Respond with valid JSON only.`
  }

  try {
    const result = await streamText({
      model: ai('gpt-4o'),
      system: critiquePrompt.system,
      prompt: critiquePrompt.user,
      temperature: 0.1, // Low temperature for consistent critique
      maxTokens: 1500
    })

    let critiqueText = ''
    for await (const delta of result.textStream) {
      critiqueText += delta
    }

    let cleanCritiqueText = critiqueText.trim()
    
    // Handle markdown code blocks that AI might return
    if (cleanCritiqueText.startsWith('```json')) {
      cleanCritiqueText = cleanCritiqueText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (cleanCritiqueText.startsWith('```')) {
      cleanCritiqueText = cleanCritiqueText.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    const rawCritique = JSON.parse(cleanCritiqueText)
    const critique = validateAndNormalizeCritique(rawCritique)
    
    // Analyze critique to determine revision needs
    const analysis = analyzeCritique(critique)

    return {
      critique,
      needs_revision: analysis.needs_revision,
      revision_priority: analysis.priority,
      suggested_actions: analysis.actions
    }

  } catch (error) {
    console.error('Error generating critique:', error)
    return {
      critique: createFallbackCritique(),
      needs_revision: false,
      revision_priority: 'low',
      suggested_actions: ['Manual review recommended due to critique system error']
    }
  }
}

/**
 * Revise content based on critique (with preservation constraints)
 */
export async function reviseContent(
  originalContent: string,
  critique: ContentCritique,
  paperType: PaperTypeKey,
  section: SectionKey,
  topic: string,
  contextChunks: string[]
): Promise<RevisedContent> {
  
  // Token-based stop criteria
  const originalTokens = estimateTokenCount(originalContent)
  const maxTokenDiff = Math.min(originalTokens * 0.5, 1000) // Max 50% change or 1000 tokens
  
  // Focus on high-severity issues first
  const highPriorityIssues = [
    ...critique.factual_errors.filter(e => e.severity === 'high'),
    ...critique.missing_citations.filter(c => c.severity === 'high'),
    ...critique.structural_issues.filter(s => s.severity === 'high')
  ]

  const revisionPrompt = {
    system: `You are revising a ${section} section of a ${paperType} based on expert critique.

CRITICAL CONSTRAINTS:
- You must preserve >70% of original sentences unless correcting errors
- Make targeted improvements without completely rewriting the content
- Focus only on the most critical problems identified
- Do not exceed ${maxTokenDiff} tokens of changes from the original

Address the identified issues while maintaining the original content's strengths.`,

    user: `Revise this ${section} section on "${topic}" to address the following issues:

ORIGINAL CONTENT:
${originalContent}

HIGH PRIORITY ISSUES TO FIX:
${highPriorityIssues.map((issue, i) => `${i + 1}. ${JSON.stringify(issue)}`).join('\n')}

OVERALL QUALITY ISSUES:
- Weaknesses: ${critique.overall_quality.weaknesses.join(', ')}
- Priority improvements: ${critique.overall_quality.priority_improvements.join(', ')}

AVAILABLE CONTEXT:
${contextChunks.slice(0, 3).join('\n\n')}

Provide the revised content that addresses these issues while maintaining academic rigor.`
  }

  try {
    const result = await streamText({
      model: ai('gpt-4o'),
      system: revisionPrompt.system,
      prompt: revisionPrompt.user,
      temperature: 0.2,
      maxTokens: originalTokens + maxTokenDiff // Limit based on original content
    })

    let revisedContent = ''
    for await (const delta of result.textStream) {
      revisedContent += delta
    }

    // Check token difference as stop criteria
    const revisedTokens = estimateTokenCount(revisedContent)
    const tokenDiff = Math.abs(revisedTokens - originalTokens)
    
    if (tokenDiff > maxTokenDiff) {
      console.warn(`Revision exceeded token limit: ${tokenDiff} > ${maxTokenDiff}`)
    }

    // Analyze improvements made
    const improvements = analyzeImprovements(originalContent, revisedContent, critique)

    return {
      content: revisedContent,
      improvements_made: improvements.made,
      remaining_issues: improvements.remaining,
      quality_improvement: improvements.percentage
    }

  } catch (error) {
    console.error('Error revising content:', error)
    return {
      content: originalContent,
      improvements_made: [],
      remaining_issues: ['Revision system error - manual review needed'],
      quality_improvement: 0
    }
  }
}

/**
 * Analyze critique to determine revision needs
 */
function analyzeCritique(critique: ContentCritique): {
  needs_revision: boolean
  priority: 'low' | 'medium' | 'high'
  actions: string[]
} {
  const highSeverityCount = [
    ...critique.factual_errors.filter(e => e.severity === 'high'),
    ...critique.missing_citations.filter(c => c.severity === 'high'),
    ...critique.structural_issues.filter(s => s.severity === 'high')
  ].length

  const mediumSeverityCount = [
    ...critique.factual_errors.filter(e => e.severity === 'medium'),
    ...critique.missing_citations.filter(c => c.severity === 'medium'),
    ...critique.structural_issues.filter(s => s.severity === 'medium')
  ].length

  const qualityScore = critique.overall_quality.score

  // Determine revision needs
  let needs_revision = false
  let priority: 'low' | 'medium' | 'high' = 'low'
  const actions: string[] = []

  if (highSeverityCount > 0 || qualityScore < 60) {
    needs_revision = true
    priority = 'high'
    actions.push('Address high-severity issues immediately')
  } else if (mediumSeverityCount > 2 || qualityScore < 75) {
    needs_revision = true
    priority = 'medium'
    actions.push('Improve medium-severity issues')
  } else if (mediumSeverityCount > 0 || qualityScore < 85) {
    needs_revision = true
    priority = 'low'
    actions.push('Polish minor issues for quality improvement')
  }

  // Add specific actions based on critique
  if (critique.missing_citations.length > 0) {
    actions.push('Add missing citations for unsupported claims')
  }
  if (critique.vague_claims.length > 0) {
    actions.push('Improve specificity of vague claims')
  }
  if (critique.structural_issues.length > 0) {
    actions.push('Enhance structural coherence and flow')
  }

  return { needs_revision, priority, actions }
}

/**
 * Analyze improvements made during revision
 */
function analyzeImprovements(
  original: string,
  revised: string,
  critique: ContentCritique
): {
  made: string[]
  remaining: string[]
  percentage: number
} {
  const improvements: string[] = []
  const remaining: string[] = []

  // Simple heuristic analysis
  const originalLength = original.length
  const revisedLength = revised.length
  const lengthChange = Math.abs(revisedLength - originalLength) / originalLength

  // Check if citations were added
  const originalCitations = (original.match(/\[CITE:/g) || []).length
  const revisedCitations = (revised.match(/\[CITE:/g) || []).length
  
  if (revisedCitations > originalCitations) {
    improvements.push(`Added ${revisedCitations - originalCitations} citations`)
  }

  // Check if structural words were added
  const structuralWords = ['however', 'furthermore', 'therefore', 'consequently', 'moreover']
  const originalStructural = structuralWords.reduce((count, word) => 
    count + (original.toLowerCase().split(word).length - 1), 0)
  const revisedStructural = structuralWords.reduce((count, word) => 
    count + (revised.toLowerCase().split(word).length - 1), 0)
  
  if (revisedStructural > originalStructural) {
    improvements.push('Improved structural coherence with transition words')
  }

  // Estimate overall improvement percentage
  let percentage = 0
  if (lengthChange > 0.1) percentage += 10
  if (revisedCitations > originalCitations) percentage += 20
  if (revisedStructural > originalStructural) percentage += 15

  // Check for remaining issues (simplified)
  if (critique.factual_errors.length > 0) {
    remaining.push('Potential factual errors still need verification')
  }
  if (critique.missing_citations.length > revisedCitations - originalCitations) {
    remaining.push('Some claims may still need citations')
  }

  return {
    made: improvements,
    remaining,
    percentage: Math.min(percentage, 100)
  }
}

/**
 * Create fallback critique when system fails
 */
function createFallbackCritique(): ContentCritique {
  return {
    factual_errors: [],
    missing_citations: [{
      claim: 'General content review needed',
      severity: 'medium',
      suggested_sources: []
    }],
    vague_claims: [],
    structural_issues: [],
    overall_quality: {
      score: 70,
      strengths: ['Content generated successfully'],
      weaknesses: ['Automated critique unavailable'],
      priority_improvements: ['Manual review recommended']
    }
  }
}

/**
 * Determine if reflection should be used based on content length and complexity
 */
export function shouldUseReflection(
  content: string,
  section: SectionKey,
  complexity?: number
): { 
  useReflection: boolean;
  maxCycles: number;
  reason: string;
} {
  const wordCount = content.split(/\s+/).length
  
  // Always skip reflection for very short sections
  if (wordCount < REFLECTION_CONFIG.MIN_WORDS_FOR_REFLECTION) {
    return {
      useReflection: false,
      maxCycles: 0,
      reason: `Section too short (${wordCount} words) for reflection`
    }
  }

  // Certain sections always get reflection due to their importance
  const criticalSections: SectionKey[] = ['results', 'discussion', 'conclusion']
  if (criticalSections.includes(section)) {
    return {
      useReflection: true,
      maxCycles: wordCount >= REFLECTION_CONFIG.MIN_WORDS_FOR_FULL_REFLECTION 
        ? REFLECTION_CONFIG.MAX_REFLECTION_CYCLES_LONG 
        : REFLECTION_CONFIG.MAX_REFLECTION_CYCLES_SHORT,
      reason: `Critical section (${section}) requires reflection`
    }
  }

  // For other sections, use complexity to decide
  const contentComplexity = complexity || estimateComplexity(content)
  if (contentComplexity >= REFLECTION_CONFIG.COMPLEXITY_THRESHOLD) {
    return {
      useReflection: true,
      maxCycles: wordCount >= REFLECTION_CONFIG.MIN_WORDS_FOR_FULL_REFLECTION 
        ? REFLECTION_CONFIG.MAX_REFLECTION_CYCLES_LONG 
        : REFLECTION_CONFIG.MAX_REFLECTION_CYCLES_SHORT,
      reason: `High complexity content (${contentComplexity.toFixed(2)}) requires reflection`
    }
  }

  // Default case - use limited reflection for medium-length content
  return {
    useReflection: wordCount >= REFLECTION_CONFIG.MIN_WORDS_FOR_FULL_REFLECTION,
    maxCycles: REFLECTION_CONFIG.MAX_REFLECTION_CYCLES_SHORT,
    reason: `Standard reflection based on length (${wordCount} words)`
  }
}

/**
 * Estimate content complexity based on various factors
 */
function estimateComplexity(content: string): number {
  // Count technical indicators
  const technicalTerms = content.match(/(?:analysis|methodology|framework|hypothesis|correlation|significant|theoretical|empirical|paradigm|implementation)/gi) || []
  const citations = content.match(/\[CITE:[^\]]+\]/g) || []
  const equations = content.match(/\$[^$]+\$/g) || [] // LaTeX equations
  const longSentences = content.split(/[.!?]+/).filter(s => s.split(/\s+/).length > 20).length
  
  // Calculate complexity score (0-1)
  const wordCount = content.split(/\s+/).length
  const complexityScore = (
    (technicalTerms.length / wordCount) * 0.3 +
    (citations.length / Math.ceil(wordCount / 200)) * 0.3 + // Expect ~1 citation per 200 words
    (equations.length > 0 ? 0.2 : 0) +
    (longSentences / Math.ceil(wordCount / 100)) * 0.2 // Complex sentence density
  )
  
  return Math.min(1, complexityScore)
}

/**
 * Run a reflection cycle to improve content quality
 */
export async function runReflectionCycle(
  content: string,
  paperType: PaperTypeKey,
  section: SectionKey,
  topic: string,
  availablePapers: PaperWithAuthors[],
  contextChunks: string[],
  maxCycles: number
): Promise<ReflectionResult> {
  // Initialize reflection state
  let currentContent = content
  let currentQuality = 0
  const improvementLog: string[] = []
  let revisionsCount = 0

  // Run reflection cycles
  for (let cycle = 0; cycle < maxCycles; cycle++) {
    // Analyze current content
    const analysis = await analyzeContent(
      currentContent,
      paperType,
      section,
      topic,
      availablePapers,
      contextChunks
    )

    // If quality is good enough, stop early
    if (analysis.quality_score > 90) {
      improvementLog.push(`Cycle ${cycle + 1}: Quality threshold met (${analysis.quality_score}), stopping early`)
      currentQuality = analysis.quality_score
      break
    }

    // Generate improvements
    const improvements = await generateImprovements(
      currentContent,
      analysis.issues,
      paperType,
      section,
      topic,
      availablePapers,
      contextChunks
    )

    // Apply improvements
    if (improvements.revised_content) {
      currentContent = improvements.revised_content
      currentQuality = improvements.quality_score
      revisionsCount++
      improvementLog.push(
        `Cycle ${cycle + 1}: Applied ${improvements.changes_made} improvements, new quality score: ${improvements.quality_score}`
      )
    } else {
      improvementLog.push(`Cycle ${cycle + 1}: No improvements needed`)
      break
    }
  }

  return {
    final_content: currentContent,
    final_quality_score: currentQuality,
    revisions_made: revisionsCount,
    improvement_log: improvementLog
  }
}

/**
 * Analyze content for potential improvements
 */
async function analyzeContent(
  content: string,
  paperType: PaperTypeKey,
  section: SectionKey,
  topic: string,
  availablePapers: PaperWithAuthors[],
  contextChunks: string[]
): Promise<{
  quality_score: number
  issues: Array<{
    type: string
    description: string
    severity: number
  }>
}> {
  // Placeholder for actual analysis logic
  return {
    quality_score: 85,
    issues: []
  }
}

/**
 * Generate improvements based on analysis
 */
async function generateImprovements(
  content: string,
  issues: Array<{
    type: string
    description: string
    severity: number
  }>,
  paperType: PaperTypeKey,
  section: SectionKey,
  topic: string,
  availablePapers: PaperWithAuthors[],
  contextChunks: string[]
): Promise<{
  revised_content?: string
  quality_score: number
  changes_made: number
}> {
  // Placeholder for actual improvement logic
  return {
    quality_score: 85,
    changes_made: 0
  }
} 