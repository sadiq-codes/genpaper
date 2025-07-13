import 'server-only'
import { streamText } from 'ai'
import { ai } from '@/lib/ai/vercel-client'
import { PaperTypeKey, SectionKey } from '@/lib/prompts/types'
import { type SectionContext } from '@/lib/prompts/unified/prompt-builder'
import { generateWithUnifiedTemplate } from './unified-generator'
import { getTokenCount } from '@/lib/utils/text'

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
  quality_criteria?: string[]
  context_factor?: number
  scaled_words?: number
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
 * Generate a detailed section plan with context-aware scaling
 */
export async function generateSectionPlan(
  paperType: PaperTypeKey,
  section: SectionKey,
  topic: string,
  contextChunks: string[],
  expectedWords: number,
  availablePapers: string[]
): Promise<PlanningResult> {
  
  // SURGICAL FIX: Scale word targets based on available context
  const chunkFactor = Math.min(1, contextChunks.length / 50) // 0-1 scaling
  const scaledWords = (target: number) => Math.round(target * Math.max(chunkFactor, 0.25)) || 250 // Min 250 words
  
  const contextAwareWords = scaledWords(expectedWords)
  
  console.log(`📊 Context-Aware Planning:`)
  console.log(`   📚 Available Chunks: ${contextChunks.length}`)
  console.log(`   📊 Chunk Factor: ${chunkFactor.toFixed(2)}`)
  console.log(`   🎯 Original Target: ${expectedWords} words`)
  console.log(`   🎯 Scaled Target: ${contextAwareWords} words`)
  
  if (chunkFactor < 0.3) {
    console.warn(`⚠️ WARNING: Very low context availability (${(chunkFactor * 100).toFixed(1)}%). Scaling down expectations.`)
  }

  // Generate quality criteria specific to this section and topic
  const { generateQualityCriteria } = await import('@/lib/prompts/generators')
  let qualityCriteria: string[] = []
  
  try {
    qualityCriteria = await generateQualityCriteria(
      topic,
      section,
      paperType
    )
    console.log(`✨ Generated quality criteria for ${section}: [`, qualityCriteria.map(c => `'${c}'`).join(', '), ']')
  } catch (error) {
    console.warn('Failed to generate quality criteria, using defaults:', error)
    qualityCriteria = ['evidence-based reasoning', 'logical coherence', 'scholarly depth']
  }
  
  const planningPrompt = {
    system: `You are an expert academic writer creating a detailed plan for the "${section}" section of a ${paperType} about "${topic}".

CONTEXT CONSTRAINTS:
- Available evidence chunks: ${contextChunks.length}
- Context richness: ${chunkFactor < 0.3 ? 'LOW' : chunkFactor < 0.6 ? 'MODERATE' : 'HIGH'}
- Target word count: ${contextAwareWords} words (scaled based on available context)

Your plan should ensure the content will meet these quality criteria:
${qualityCriteria.map(c => `• ${c}`).join('\n')}

${chunkFactor < 0.3 ? 'NOTE: With limited context, focus on synthesis and high-level analysis rather than detailed evidence.' : ''}

Respond with NOTHING BUT a valid JSON object.`,

    user: `Create a detailed plan for the "${section}" section (target: ${contextAwareWords} words).

Available evidence chunks: ${contextChunks.length}
${contextChunks.slice(0, 3).map((chunk, i) => `${i + 1}. ${chunk.substring(0, 200)}...`).join('\n')}

Available papers for citation: ${availablePapers.length} papers

Your JSON response must match this structure:
{
  "outline": ["First main point", "Second main point", "Third main point"],
  "citation_plan": [
    {
      "placeholder": "CITE_INTRO_CLAIM",
      "need": "Evidence for opening claim about...",
      "target_papers": ["paper-id-1", "paper-id-2"]
    }
  ],
  "key_arguments": ["Primary argument 1", "Primary argument 2"],
  "estimated_paragraphs": ${Math.max(2, Math.ceil(contextAwareWords / 200))},
  "quality_checks": ["How to ensure criterion 1", "How to ensure criterion 2"],
  "context_factor": ${chunkFactor},
  "scaled_words": ${contextAwareWords}
}`
  }

  try {
    const result = await streamText({
      model: ai('gpt-4o'),
      system: planningPrompt.system,
      prompt: planningPrompt.user,
      temperature: 0.2,
      maxTokens: Math.ceil(contextAwareWords / 1.33) + 400 // GPT-4o token estimation: ~1.33 words/token
    })

    let planText = ''
    for await (const delta of result.textStream) {
      planText += delta
    }
    
    // Capture token usage for metrics using the proper async function
    let tokensUsed = await getTokenCount(planText)
    try {
      const usage = await result.usage
      tokensUsed = usage?.totalTokens || tokensUsed
      console.log(`Planning tokens used: ${tokensUsed} (calculated: ${await getTokenCount(planText)})`)
    } catch {
      // Usage not available, keep calculated count
    }
    
    const plan = parseJsonResponse(planText)
    
    // Ensure the plan includes the quality criteria and context info for later use
    if (!plan.quality_criteria) {
      plan.quality_criteria = qualityCriteria
    }
    plan.context_factor = chunkFactor
    plan.scaled_words = contextAwareWords
    
    const validation = validatePlan(plan, availablePapers)

    return {
      plan,
      isValid: validation.isValid,
      validationErrors: validation.errors
    }

  } catch (error) {
    console.error('Error generating section plan:', error)
    return {
      plan: createFallbackPlan(section, contextAwareWords, topic, qualityCriteria, chunkFactor),
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
 * Create fallback plan when AI planning fails, with context awareness
 */
function createFallbackPlan(
  section: SectionKey, 
  expectedWords: number, 
  topic: string, 
  qualityCriteria: string[],
  chunkFactor: number = 0.5
): SectionPlan {
  const paragraphs = Math.max(2, Math.ceil(expectedWords / 200))
  
  return {
    outline: [
      `Introduction to ${topic} in context of ${section}`,
      `Key findings and evidence`,
      `Analysis and implications`,
      `Summary and connections`
    ].slice(0, paragraphs),
    citation_plan: [
      {
        placeholder: "CITE_MAIN_EVIDENCE",
        need: `Supporting evidence for ${section} discussion`,
        target_papers: []
      }
    ],
    key_arguments: [
      `Primary analysis of ${topic}`,
      `Supporting evidence and context`
    ],
    estimated_paragraphs: paragraphs,
    quality_checks: qualityCriteria,
    quality_criteria: qualityCriteria,
    context_factor: chunkFactor,
    scaled_words: expectedWords
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