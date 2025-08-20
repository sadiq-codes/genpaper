import 'server-only'
// R3.1: Remove direct DB client usage from PromptBuilder
// import { createClient } from '@/lib/supabase/server'
import { ContextRetrievalService } from '@/lib/generation/context-retrieval-service'
// R3.2: retrieval service is mandatory now
import { PaperTypeKey, SectionKey } from '../types'
import { GENERATION_DEFAULTS } from '@/lib/ai/generation-defaults'
import yaml from 'js-yaml'
import fs from 'fs/promises'
import path from 'path'
import Mustache from 'mustache'

/**
 * Unified prompt builder that creates contextual data for the single skeleton template
 * Replaces multiple hard-coded prompts with data-driven approach
 */

export interface UnifiedPromptData {
  // Paper-level context
  paperTitle: string
  paperObjectives: string
  outlineTree: string
  
  // Section coherence data
  previousSectionsSummary: string
  sectionPath: string
  
  // Writing task parameters
  targetWords: number
  minCitations: number
  isRewrite: boolean
  currentText?: string
  
  // Evidence and context
  evidenceSnippets: string // JSON string
}

export interface SectionContext {
  projectId: string
  sectionId: string
  // blockId removed in migration to document-level diffs
  paperType: PaperTypeKey
  sectionKey: SectionKey
  availablePapers: string[]
  contextChunks: Array<{
    paper_id: string
    content: string
    title?: string
    doi?: string
    score?: number
  }>
}

export interface BuildPromptOptions {
  targetWords?: number
  forceRewrite?: boolean
  sentenceMode?: boolean // For sentence-level edits
  model?: string
  temperature?: number
  maxTokens?: number
}

// Cache for loaded skeleton
let skeletonTemplate: string | null = null

/**
 * Main function: builds the unified prompt with contextual data
 */
export async function buildUnifiedPrompt(
  context: SectionContext,
  options: BuildPromptOptions = {}
): Promise<{ system: string; user: string; tools: any }> {
  
  // Load the skeleton template
  const skeleton = await loadSkeletonTemplate()
  
  // Generate all the contextual data
  const promptData = await generatePromptData(context, options)
  
  // Fill the skeleton with data
  const system = Mustache.render(skeleton.system, promptData)
  const user = Mustache.render(skeleton.user, promptData)
  
  return {
    system,
    user,
    tools: skeleton.tools
  }
}

/**
 * Generate all contextual data for the prompt
 */
async function generatePromptData(
  context: SectionContext,
  options: BuildPromptOptions
): Promise<UnifiedPromptData> {
  
  const {
    projectId,
    sectionId,
    availablePapers,
    contextChunks
  } = context
  
  // Get project metadata
  const projectData = await getProjectData(projectId)
  
  // Build outline tree representation
  const outlineTree = await buildOutlineTree(projectId)
  
  // Get summaries of previous approved sections
  const previousSummary = await buildPreviousSectionsSummary(projectId, sectionId)
  
  // Build section path (e.g., "Methods → Data Collection")
  const sectionPath = await buildSectionPath(projectId, sectionId)
  
  // Get current text if this is a rewrite
  const currentText = await getCurrentText(sectionId)
  
  // Calculate target parameters
  const targetWords = options.targetWords || 
    (options.sentenceMode ? 50 : await getExpectedWords(sectionId))
  
  const minCitations = Math.max(
    GENERATION_DEFAULTS.MIN_CITATION_FLOOR,
    Math.ceil(availablePapers.length * GENERATION_DEFAULTS.MIN_CITATION_COVERAGE)
  )
  
  // If no context provided, fetch relevant chunks via ContextRetrievalService
  let workingChunks = contextChunks
  if (!workingChunks || workingChunks.length === 0) {
    try {
      const retrieval = await ContextRetrievalService.retrieve({
        query: projectData.title || '',
        projectId,
        k: 20
      })
      workingChunks = retrieval.chunks.map(chunk => ({
        paper_id: chunk.paper_id,
        content: chunk.content,
        title: (chunk as any).metadata?.title || 'Source',
        doi: undefined
      }))
    } catch (e) {
      console.warn('Retrieval service failed, continuing without fetched context:', e)
      workingChunks = []
    }
  }

  // Format evidence snippets with clear paper_id tagging for citation tool
  // Use retriever score to sort; avoid ad-hoc keyword filtering
  const sortedChunks = (workingChunks || [])
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))

  const evidenceSnippets = sortedChunks.slice(0, 10).map(chunk => { // Limit to top 10 by score
    const content = chunk.content.substring(0, 300)
    return `[CONTEXT FROM: ${chunk.paper_id}]
Title: ${chunk.title || 'Unknown Title'}
DOI: ${chunk.doi || 'N/A'}
Content: ${content}${chunk.content.length > 300 ? '...' : ''}

`
  }).join('')
  
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

/**
 * Load the unified skeleton template
 */
async function loadSkeletonTemplate(): Promise<{ system: string; user: string; tools: any }> {
  if (skeletonTemplate) {
    return JSON.parse(skeletonTemplate)
  }
  
  try {
    const skeletonPath = path.join(process.cwd(), 'lib/prompts/unified/skeleton.yaml')
    const yamlContent = await fs.readFile(skeletonPath, 'utf-8')
    const parsed = yaml.load(yamlContent) as { system: string; user: string; tools: any }
    
    skeletonTemplate = JSON.stringify(parsed)
    return parsed
  } catch (error) {
    console.error('Failed to load skeleton template:', error)
    // Fallback to embedded template
    return {
      system: "You are drafting a scholarly paper. Adopt academic tone appropriate for scholarly writing.",
      user: "Write the {{sectionPath}} section for {{paperTitle}}. Target: {{targetWords}} words.",
      tools: {}
    }
  }
}

/**
 * Get project metadata (title, objectives)
 */
async function getProjectData(_projectId: string): Promise<{ title: string; objectives: string }> {
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
async function buildOutlineTree(_projectId: string): Promise<string> {
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
async function buildPreviousSectionsSummary(_projectId: string, _currentSectionId: string): Promise<string> {
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
async function buildSectionPath(_projectId: string, _sectionId: string): Promise<string> {
  // TODO: Replace with ProjectService.getSection(sectionId)
  const section = null as unknown as { title: string; parent_id?: string | null } | null
  if (!section) {
    return 'Unknown Section'
  }
  
  const path = [section.title]
  
  // Walk up the parent chain
  // Parent chain omitted without DB access
  
  return path.join(' → ')
}

/**
 * Get current text for rewrite operations
 */
async function getCurrentText(_sectionId: string): Promise<string | null> {
  // TODO: Replace with ProjectService.getSectionContent(sectionId)
  return null
}

/**
 * Get expected word count for a section
 */
async function getExpectedWords(_sectionId: string): Promise<number> {
  // TODO: Replace with ProjectService.getSectionMeta(sectionId)
  const section = null as unknown as { expected_words?: number; section_key?: string } | null
  if (section?.expected_words) return section.expected_words
  
  // Fallback based on section type
  const defaults: Record<string, number> = {
    introduction: 800,
    literatureReview: 1200,
    methodology: 1000,
    results: 1000,
    discussion: 1200,
    conclusion: 600,
    abstract: 300
  }
  
  return defaults[section?.section_key || 'introduction'] || 800
}

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
export function clearTemplateCache(): void {
  skeletonTemplate = null
}

// Removed unused getProjectSummaryForDrift placeholder to satisfy linter