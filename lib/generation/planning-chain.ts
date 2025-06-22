import 'server-only'
import { streamText } from 'ai'
import { ai } from '@/lib/ai/vercel-client'
import { PaperTypeKey, SectionKey } from '@/lib/prompts/types'
import { type SectionContext } from '@/lib/prompts/unified/prompt-builder'
import { generateWithUnifiedTemplate } from './unified-generator'
import { estimateTokenCount } from '@/lib/utils/text'

/**
 * Two-step planning chain for better content generation
 * Now uses the unified template system instead of registry
 * Step 1: Model creates a JSON plan with outline and citation strategy
 * Step 2: Model writes content using the unified template with plan guidance
 */

export interface SectionPlan {
  outline: string[]
  citation_plan: Array<{
    placeholder: string
    need: string
    target_papers?: string[]
  }>
  key_arguments: string[]
  estimated_paragraphs: number
  quality_checks: string[]
}

export interface PlanningResult {
  plan: SectionPlan
  isValid: boolean
  validationErrors: string[]
}

export interface WritingResult {
  content: string
  citations: Array<{
    paperId: string
    citationText: string
    positionStart?: number
    positionEnd?: number
  }>
  qualityMetrics: {
    outlineAdherence: number
    citationCoverage: number
    argumentStrength: number
  }
}

/**
 * Clean and parse JSON response with robust error handling
 */
function parseJsonResponse(text: string): SectionPlan {
  let cleanText = text.trim()
  
  // Remove BOM if present
  if (cleanText.charCodeAt(0) === 0xFEFF) {
    cleanText = cleanText.substr(1)
  }
  
  // Handle markdown code blocks
  if (cleanText.startsWith('```json')) {
    cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
  } else if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '')
  }
  
  // Remove trailing comma before closing brace
  cleanText = cleanText.replace(/,(\s*})/, '$1')
  cleanText = cleanText.replace(/,(\s*])/, '$1')
  
  return JSON.parse(cleanText) as SectionPlan
}

/**
 * Step 1: Generate a structured plan for the section
 */
export async function generateSectionPlan(
  paperType: PaperTypeKey,
  section: SectionKey,
  topic: string,
  contextChunks: string[],
  expectedWords: number,
  availablePapers: string[]
): Promise<PlanningResult> {
  
  const planningPrompt = {
    system: `You are an expert academic writer creating a structured plan for a ${section} section.

Your task is to respond with NOTHING BUT a single, valid JSON object. No explanatory text, markdown, or anything else.

The JSON must include:
1. "outline": Array of 3-6 main points/subsections
2. "citation_plan": Array of objects with "placeholder", "need", and optional "target_papers"
3. "key_arguments": Array of main arguments to develop
4. "estimated_paragraphs": Number of paragraphs needed
5. "quality_checks": Array of quality criteria to verify

Use placeholders like [A], [B], [C] for citations. Ensure the plan is feasible given the available papers and context.`,

    user: `Create a structured plan for the ${section} section on "${topic}".

Available papers: ${availablePapers.join(', ')}
Context snippets: ${contextChunks.slice(0, 3).join('; ')}
Target length: ${expectedWords} words

Respond with valid JSON only.`
  }

  try {
    const result = await streamText({
      model: ai('gpt-4o'),
      system: planningPrompt.system,
      prompt: planningPrompt.user,
      temperature: 0.2,
      maxTokens: Math.ceil(expectedWords / 1.33) + 400 // GPT-4o token estimation: ~1.33 words/token
    })

    let planText = ''
    for await (const delta of result.textStream) {
      planText += delta
    }
    
    // Capture token usage for metrics
    let tokensUsed = estimateTokenCount(planText)
    try {
      const usage = await result.usage
      tokensUsed = usage?.totalTokens || tokensUsed
      console.log(`Planning tokens used: ${tokensUsed} (estimated: ${estimateTokenCount(planText)})`)
    } catch {
      // Usage not available, keep estimate
    }
    
    const plan = parseJsonResponse(planText)
    const validation = validatePlan(plan, availablePapers)

    return {
      plan,
      isValid: validation.isValid,
      validationErrors: validation.errors
    }

  } catch (error) {
    console.error('Error generating section plan:', error)
    return {
      plan: createFallbackPlan(section, expectedWords, topic),
      isValid: false,
      validationErrors: [`Planning failed: ${error}`]
    }
  }
}

/**
 * Step 2: Write content using the unified template system with plan guidance
 */
export async function writeFromPlan(
  paperType: PaperTypeKey,
  section: SectionKey,
  topic: string,
  plan: SectionPlan,
  contextChunks: string[],
  availablePapers: string[],
  projectId?: string,
  sectionId?: string
): Promise<WritingResult> {

  // Create context for unified generator
  const context: SectionContext = {
    projectId: projectId || 'temp-project',
    sectionId: sectionId || 'temp-section',
    paperType,
    sectionKey: section,
    availablePapers,
    contextChunks: contextChunks.map(chunk => ({
      paper_id: 'temp-paper',
      content: chunk,
      title: 'Research Paper',
      doi: undefined
    }))
  }

  try {
    // Use unified generator with plan-enhanced prompting
    const result = await generateWithUnifiedTemplate({
      context,
      options: {
        targetWords: plan.estimated_paragraphs * 120, // Rough estimate
        forceRewrite: false
      },
      enableReflection: true,
      enableDriftDetection: false, // Skip drift detection for planned content
      onProgress: (stage, progress, message) => {
        console.log(`Planning Chain - ${stage}: ${message}`)
      }
    })

    // Extract citations from the result
    const citations = result.citations || []
    
    // Calculate quality metrics based on plan adherence
    const qualityMetrics = calculateWritingQuality(result.content, plan, citations)

    return {
      content: result.content,
      citations,
      qualityMetrics
    }

  } catch (error) {
    console.error('Error writing from plan:', error)
    
    // Fallback to basic content generation
    return {
      content: `# ${section}\n\nContent generation failed. Please retry.`,
      citations: [],
      qualityMetrics: {
        outlineAdherence: 0,
        citationCoverage: 0,
        argumentStrength: 0
      }
    }
  }
}

/**
 * Enhanced unified planning chain that combines planning + writing
 */
export async function generateWithPlanningChain(
  context: SectionContext,
  topic: string,
  expectedWords: number = 800,
  onProgress?: (stage: string, progress: number, message: string) => void
): Promise<WritingResult> {
  
  // Step 1: Generate plan
  onProgress?.('planning', 20, 'Creating section plan...')
  
  const planningResult = await generateSectionPlan(
    context.paperType,
    context.sectionKey,
    topic,
    context.contextChunks.map(c => c.content),
    expectedWords,
    context.availablePapers
  )
  
  if (!planningResult.isValid) {
    console.warn('Plan validation failed:', planningResult.validationErrors)
  }
  
  onProgress?.('planning', 40, 'Plan created, generating content...')
  
  // Step 2: Write from plan
  const writingResult = await writeFromPlan(
    context.paperType,
    context.sectionKey,
    topic,
    planningResult.plan,
    context.contextChunks.map(c => c.content),
    context.availablePapers,
    context.projectId,
    context.sectionId
  )
  
  onProgress?.('complete', 100, 'Planning chain completed')
  
  return writingResult
}

/**
 * Validate a generated plan for feasibility and completeness (enhanced validation)
 */
function validatePlan(
  plan: SectionPlan, 
  availablePapers: string[]
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check required fields
  if (!plan.outline || plan.outline.length < 2) {
    errors.push('Outline must have at least 2 points')
  }
  if (!plan.citation_plan || plan.citation_plan.length < 3) {
    errors.push('Citation plan must include at least 3 citations')
  }
  if (!plan.key_arguments || plan.key_arguments.length < 2) {
    errors.push('Must have at least 2 key arguments')
  }
  if (!plan.estimated_paragraphs || plan.estimated_paragraphs < 3) {
    errors.push('Must estimate at least 3 paragraphs')
  }

  // Validate citation placeholders
  const placeholders = plan.citation_plan.map(c => c.placeholder)
  const validPlaceholderPattern = /^\[[A-Z]\]$/
  const invalidPlaceholders = placeholders.filter(p => !validPlaceholderPattern.test(p))
  if (invalidPlaceholders.length > 0) {
    errors.push(`Invalid citation placeholders: ${invalidPlaceholders.join(', ')} (should be [A], [B], etc.)`)
  }
  
  const duplicatePlaceholders = placeholders.filter((p, i) => placeholders.indexOf(p) !== i)
  if (duplicatePlaceholders.length > 0) {
    errors.push(`Duplicate citation placeholders: ${duplicatePlaceholders.join(', ')}`)
  }

  // Check if citation plan is feasible given available papers
  const requestedPapers = plan.citation_plan.flatMap(c => c.target_papers || [])
  const unavailablePapers = requestedPapers.filter(id => !availablePapers.includes(id))
  if (unavailablePapers.length > 0) {
    errors.push(`Plan references unavailable papers: ${unavailablePapers.join(', ')}`)
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}

/**
 * Create a fallback plan when JSON planning fails (enhanced with topic keywords)
 */
function createFallbackPlan(section: SectionKey, expectedWords: number, topic: string): SectionPlan {
  const baseParagraphs = Math.max(3, Math.ceil(expectedWords / 150))
  const topicKeywords = topic.split(' ').slice(0, 2).join(' ') // Use first two words of topic
  
  return {
    outline: [
      `Introduction to ${topicKeywords} ${section} scope and context`,
      `Analysis of key ${topicKeywords} research findings`,
      `Critical evaluation and synthesis of ${topicKeywords}`,
      `Implications and conclusions for ${topicKeywords}`
    ].slice(0, Math.min(6, baseParagraphs)),
    citation_plan: [
      { placeholder: '[A]', need: `foundational ${topicKeywords} research` },
      { placeholder: '[B]', need: `supporting ${topicKeywords} evidence` },
      { placeholder: '[C]', need: `comparative ${topicKeywords} studies` }
    ],
    key_arguments: [
      `Establish ${topicKeywords} theoretical foundation`,
      `Present evidence-based ${topicKeywords} analysis`
    ],
    estimated_paragraphs: baseParagraphs,
    quality_checks: [
      'Clear logical flow',
      'Adequate citation support',
      'Strong evidence base'
    ]
  }
}

/**
 * Calculate quality metrics for the written content
 */
function calculateWritingQuality(
  content: string,
  plan: SectionPlan,
  citations: Array<{ paperId: string; citationText: string }>
): WritingResult['qualityMetrics'] {
  
  // Outline adherence - check if main points are covered
  const outlineAdherence = plan.outline.reduce((score, point) => {
    const keywords = point.toLowerCase().split(' ').filter(w => w.length > 3)
    const covered = keywords.some(keyword => content.toLowerCase().includes(keyword))
    return score + (covered ? 1 : 0)
  }, 0) / plan.outline.length

  // Citation coverage - compare planned vs actual citations
  const citationCoverage = Math.min(1, citations.length / plan.citation_plan.length)

  // Argument strength - rough metric based on transition words and depth cues
  const transitionWords = ['however', 'furthermore', 'additionally', 'in contrast', 'moreover', 'consequently']
  const depthCues = ['analysis', 'synthesis', 'comparison', 'evaluation', 'implication', 'significance']
  
  const transitionCount = transitionWords.reduce((count, word) => 
    count + (content.toLowerCase().split(word).length - 1), 0)
  const depthCueCount = depthCues.reduce((count, cue) =>
    count + (content.toLowerCase().split(cue).length - 1), 0)
  
  const argumentStrength = Math.min(1, (transitionCount + depthCueCount) / 10)

  return {
    outlineAdherence,
    citationCoverage,
    argumentStrength
  }
} 