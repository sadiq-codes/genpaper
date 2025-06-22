import 'server-only'
import { streamText } from 'ai'
import { ai } from '@/lib/ai/vercel-client'
import { PaperTypeKey, SectionKey } from '@/lib/prompts/types'
import { calculateContentMetricsAsync } from './metrics-system'
import { estimateTokenCount } from '@/lib/utils/text'

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

export interface ReflectionResult {
  critique: ContentCritique
  needs_revision: boolean
  revision_priority: 'low' | 'medium' | 'high'
  suggested_actions: string[]
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
 * Run complete reflection cycle (critique + revision if needed) with enhanced stop criteria
 */
export async function runReflectionCycle(
  content: string,
  paperType: PaperTypeKey,
  section: SectionKey,
  topic: string,
  availablePapers: string[],
  contextChunks: string[],
  maxRevisions: number = 2
): Promise<{
  final_content: string
  revisions_made: number
  final_quality_score: number
  improvement_log: string[]
}> {
  let currentContent = content
  let revisionCount = 0
  const improvementLog: string[] = []
  const initialTokens = estimateTokenCount(content)

  for (let i = 0; i < maxRevisions; i++) {
    const reflection = await critiqueContentBestOfTwo(
      currentContent,
      paperType,
      section,
      topic,
      availablePapers,
      contextChunks
    )

    improvementLog.push(`Revision ${i + 1}: Quality score ${reflection.critique.overall_quality.score}`)

    if (!reflection.needs_revision || reflection.revision_priority === 'low') {
      improvementLog.push(`Stopping revisions: ${reflection.needs_revision ? 'Low priority issues only' : 'No issues found'}`)
      break
    }

    const revision = await reviseContent(
      currentContent,
      reflection.critique,
      paperType,
      section,
      topic,
      contextChunks
    )

    // Check token-based stop criteria
    const currentTokens = estimateTokenCount(revision.content)
    const tokenGrowth = (currentTokens - initialTokens) / initialTokens
    
    if (tokenGrowth > 0.8) { // Stop if content grew by >80%
      improvementLog.push(`Stopping revisions: Content growth exceeded threshold (${Math.round(tokenGrowth * 100)}%)`)
      break
    }

    currentContent = revision.content
    revisionCount++
    improvementLog.push(`Improvements: ${revision.improvements_made.join(', ')}`)

    if (revision.quality_improvement < 5) {
      improvementLog.push('Stopping revisions: Minimal improvement detected')
      break
    }
  }

  // Final quality assessment
  const finalReflection = await critiqueContent(
    currentContent,
    paperType,
    section,
    topic,
    availablePapers,
    contextChunks
  )

  return {
    final_content: currentContent,
    revisions_made: revisionCount,
    final_quality_score: finalReflection.critique.overall_quality.score,
    improvement_log: improvementLog
  }
}

export async function critiqueContentBestOfTwo(
  content: string,
  paperType: PaperTypeKey,
  section: SectionKey,
  topic: string,
  availablePapers: string[],
  contextChunks: string[]
): Promise<ReflectionResult> {
  const [c1, c2] = await Promise.all([
    critiqueContent(content, paperType, section, topic, availablePapers, contextChunks),
    critiqueContent(content, paperType, section, topic, availablePapers, contextChunks)
  ])
  return (c2.critique.overall_quality.score > c1.critique.overall_quality.score) ? c2 : c1
} 