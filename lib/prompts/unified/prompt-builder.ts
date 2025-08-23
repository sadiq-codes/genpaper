import 'server-only'
import { GENERATION_DEFAULTS } from '@/lib/ai/generation-defaults'
import type { SectionContext } from '../types'
import { PromptService, type PromptData, type TemplateOptions, type BuiltPrompt } from '@/lib/prompts/prompt-service'

/**
 * Unified prompt builder that assembles contextual PromptData and delegates
 * template loading + rendering to PromptService (pure builder under the hood).
 */

export type UnifiedPromptData = PromptData

export interface BuildPromptOptions extends TemplateOptions {
  targetWords?: number
  forceRewrite?: boolean
  sentenceMode?: boolean // For sentence-level edits
}

/**
 * Main function: builds the unified prompt with contextual data
 */
export async function buildUnifiedPrompt(
  context: SectionContext,
  options: BuildPromptOptions = {}
): Promise<BuiltPrompt> {

  // Assemble contextual data for template
  const promptData = await generatePromptData(context, options)

  // Delegate to PromptService for template loading + rendering
  const built = await PromptService.buildUnified(promptData, {
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens
  })

  return built
}

/**
 * Generate all contextual data for the prompt
 */
async function generatePromptData(
  context: SectionContext,
  options: BuildPromptOptions
): Promise<UnifiedPromptData> {
  // Project-level metadata (defaults until service integration)
  const projectData = await getProjectData()

  // Document structure and prior coherence (defaults until service integration)
  const outlineTree = await buildOutlineTree()
  const previousSummary = await buildPreviousSectionsSummary()

  // Section path uses provided title when available
  const sectionPath = await buildSectionPath(context.title || String(context.sectionKey))

  // Current text (for rewrites) - default none
  const currentText = await getCurrentText()

  // Target words: prefer explicit option, then context expectation, then sentence mode, else fallback
  const targetWords = options.targetWords ?? (options.sentenceMode ? 50 : (context.expectedWords ?? 500))

  // Minimum citations based on available candidate papers
  const minCitations = Math.max(
    GENERATION_DEFAULTS.MIN_CITATION_FLOOR,
    Math.ceil((context.candidatePaperIds?.length || 0) * GENERATION_DEFAULTS.MIN_CITATION_COVERAGE)
  )

  // Use provided context chunks only; no hidden retrieval here
  const workingChunks = (context.contextChunks || [])
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))

  // JSON-format evidence for the template
  const evidenceSnippets = PromptService.formatEvidenceSnippets(workingChunks)

  return {
    paperTitle: projectData.title,
    paperObjectives: projectData.objectives,
    outlineTree,
    previousSectionsSummary: previousSummary,
    sectionPath,
    targetWords,
    minCitations,
    isRewrite: Boolean(currentText) || Boolean(options.forceRewrite),
    currentText: currentText || undefined,
    evidenceSnippets
  }
}

// Template loading is fully handled by PromptService

/**
 * Get project metadata (title, objectives)
 */
async function getProjectData(): Promise<{ title: string; objectives: string }> {
  // TODO: Wire via a service (e.g., ProjectService) — for now, return defaults to avoid DB access
  const project = null as unknown as { title?: string; description?: string; metadata?: any } | null
  if (!project) {
    return {
      title: 'Research Paper',
      objectives: 'Comprehensive analysis of the research topic with evidence-based conclusions.'
    }
  }
  
  // Extract objectives from description or metadata
  const objectives = project.metadata?.objectives || 
    project.description?.substring(0, 200) + '...' ||
    'Systematic investigation and analysis of the research topic.'
  
  return {
    title: project.title || 'Research Paper',
    objectives
  }
}

/**
 * Build a text representation of the document outline tree
 */
async function buildOutlineTree(): Promise<string> {
  // TODO: Replace with ProjectService.getOutline(projectId)
  const sections = null as unknown as Array<{ section_key: string; title: string; level: number; order_index: number }> | null
  if (!sections || sections.length === 0) {
    return '• Introduction\n• Methods\n• Results\n• Discussion\n• Conclusion'
  }
  
  // Build hierarchical tree representation
  let tree = ''
  for (const section of sections) {
    const indent = '  '.repeat(section.level || 0)
    tree += `${indent}• ${section.title}\n`
  }
  
  return tree.trim()
}

/**
 * Get summaries of all approved sections before the current one
 */
async function buildPreviousSectionsSummary(): Promise<string> {
  // TODO: Replace with ProjectService.getApprovedSections(projectId)
  const sections = [] as Array<{ id: string; title: string; content?: string | null; summary?: string | null }>
  if (!sections || sections.length === 0) {
    return 'No previous sections approved yet.'
  }
  
  // Build summary from stored summaries or generate them
  const summaries = await Promise.all(
    sections.map(async (section) => {
      if (section.summary) {
        return `**${section.title}:** ${section.summary}`
      }
      
      // Generate summary if not cached
      if (section.content) {
        const summary = await generateSectionSummary(section.content)
        // TODO: Optionally persist via service
        return `**${section.title}:** ${summary}`
      }
      
      return `**${section.title}:** Content approved but summary pending.`
    })
  )
  
  return summaries.join('\n\n')
}

/**
 * Build section path (e.g., "Methods → Data Collection → Survey Design")
 */
async function buildSectionPath(currentSectionTitle: string): Promise<string> {
  // TODO: Replace with ProjectService.getSection(sectionId)
  const section = { title: currentSectionTitle } as { title: string }
  const path = [section.title]
  
  // Walk up the parent chain
  // Parent chain omitted without DB access
  
  return path.join(' → ')
}

/**
 * Get current text for rewrite operations
 */
async function getCurrentText(): Promise<string | null> {
  // TODO: Replace with ProjectService.getSectionContent(sectionId)
  return null
}

/**
 * Get expected word count for a section
 */
// getExpectedWords removed; targetWords now comes from options/context

/**
 * Generate a 35-word summary of section content
 */
async function generateSectionSummary(content: string): Promise<string> {
  // Simple extractive summary for now
  // In production, this would use AI summarization
  
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20)
  if (sentences.length === 0) return 'Content summary not available.'
  
  // Take first sentence and truncate to ~35 words
  const firstSentence = sentences[0].trim()
  const words = firstSentence.split(' ')
  
  if (words.length <= 35) {
    return firstSentence + '.'
  } else {
    return words.slice(0, 35).join(' ') + '...'
  }
}

/**
 * Check for topic drift using embedding similarity
 */
export async function checkTopicDrift(
  newContent: string,
  previousSummary: string,
  threshold: number = 0.65
): Promise<{ isDrift: boolean; similarity: number; warning?: string }> {
  
  // Placeholder for embedding-based similarity check
  // In production, this would use pgvector or OpenAI embeddings
  
  const similarity = calculateSimpleTextSimilarity(newContent, previousSummary)
  const isDrift = similarity < threshold
  
  return {
    isDrift,
    similarity,
    warning: isDrift ? 
      `Possible topic drift detected (similarity: ${similarity.toFixed(2)}). Consider revising to maintain coherence with previous sections.` :
      undefined
  }
}

/**
 * Simple text similarity calculation (placeholder for embedding similarity)
 */
function calculateSimpleTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  
  const intersection = new Set([...words1].filter(x => words2.has(x)))
  const union = new Set([...words1, ...words2])
  
  return union.size > 0 ? intersection.size / union.size : 0
}

/**
 * Clear template cache (for development/testing)
 */
// No template cache in this module anymore

// Removed unused getProjectSummaryForDrift placeholder to satisfy linter