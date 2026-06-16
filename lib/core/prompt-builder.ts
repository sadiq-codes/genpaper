/**
 * @core/prompt-builder (Pure)
 * 
 * Pure prompt construction with no I/O or side effects.
 * Templates and context are passed as arguments for testability.
 */

import Mustache from 'mustache'
import type { PaperTypeKey } from '@/lib/prompts/types'
import type { CompleteCOStarContext } from '@/lib/prompts/costar-context'
import type { ChatAUTOMATContext } from '@/lib/prompts/automat-context'

/**
 * Voice data structure for template injection
 * Matches the TemplateVoiceData interface from voice-profiles.ts
 * with additional computed boolean flags for Mustache conditionals
 */
export interface PromptVoiceData {
  id: string
  name: string
  description: string
  literatureStance: 'descriptive' | 'evaluative' | 'adversarial'
  literatureStanceGuidance: string
  hedging: {
    density: 'high' | 'medium' | 'low'
    maxHedgePhrasesPerParagraph: number
    requiredAssertiveSentencesPerSection: number
    // Boolean flags for Mustache conditionals
    density_high?: boolean
    density_medium?: boolean
    density_low?: boolean
  }
  sentenceRhythm: {
    shortSentencePercentage: number
    maxConsecutiveLongSentences: number
    emphasisSentencesPerSection: number
  }
  citationPosture: {
    style: 'supportive' | 'contrastive' | 'mixed'
    minContrastiveCitationsPerSection: number
    allowExplicitDisagreement: boolean
    // Boolean flags for Mustache conditionals
    style_supportive?: boolean
    style_contrastive?: boolean
    style_mixed?: boolean
  }
  intellectualRisk: 'conservative' | 'moderate' | 'bold'
  intellectualRiskGuidance: string
  patterns: {
    hedgePhrases: string[]
    assertivePhrases: string[]
    contrastivePhrases: string[]
    evaluativePhrases: string[]
  }
}

export interface PromptData {
  // Paper-level context
  paperTitle: string
  paperObjectives: string
  outlineTree: string
  
  // Section coherence data
  previousSectionsSummary: string
  sectionPath: string
  sectionPurpose?: string
  exclusions?: string
  requiredPoints?: string
  qualityCriteria?: string
  customInstructions?: string
  
  // Writing task parameters
  targetWords: number
  minCitations?: number  // Optional - using semantic citation guidance instead of quantitative enforcement
  isRewrite: boolean
  currentText?: string

  // Optional subsection plan (for long-form sections)
  subsectionsPlan?: Array<{
    title: string
    expectedWords?: number
    keyPoints?: string[]
  }>
  
  // Evidence and context (pre-formatted)
  evidenceSnippets: string
  
  // Original research context (for empirical papers)
  hasOriginalResearch?: boolean
  researchQuestion?: string
  keyFindings?: string
  
  // Paper profile guidance (contextual intelligence from profile generation)
  // This is the SINGLE SOURCE OF TRUTH for paper-type specific guidance
  profileGuidance?: string
  
  // Voice/Authorial persona configuration
  // Controls hedging, confidence, citation posture, and intellectual risk
  // to produce authentic-feeling variation across papers
  voice?: PromptVoiceData
  
  // Quantification context for accurate claims about the literature base
  // Helps the LLM make specific claims like "X of Y studies found..."
  literatureStats?: {
    totalPapers: number
    usablePapers: number
    dateRange: { earliest: number; latest: number } | null
    hasSubstantialBase: boolean
  }
  
  // =============================================================================
  // Synthesis Engine Data (Phase 4)
  // Pre-analyzed patterns, contradictions, and gaps for data-driven writing
  // All fields are strings - LLM decides values, no hardcoded enums
  // =============================================================================
  
  // Pre-analyzed patterns from cross-document analysis
  synthesisPatterns?: Array<{
    claim: string                    // The pattern statement
    supportStatement: string         // "6 of 8 studies (75%) found..."
    valuesSummary?: string           // "ranging from 24% to 34%"
    presentationApproach: string     // LLM-decided, e.g., "Lead with statistics"
    importance: string               // LLM-decided, e.g., "central", "supporting"
    supportingPapers: string[]       // Paper titles/IDs for citation
  }>
  
  // Pre-analyzed contradictions
  synthesisContradictions?: Array<{
    description: string              // What the contradiction is
    presentationApproach: string     // How to present fairly
    resolutionStrategy?: string      // How to explain/resolve
    sides: Array<{
      position: string               // One side's position
      papers: string[]               // Papers supporting this side
    }>
  }>
  
  // Pre-analyzed gaps
  synthesisGaps?: Array<{
    description: string              // What's missing
    importance: string               // Why it matters
    suggestedFutureWork?: string     // Potential research to address it
  }>
  
  // Writing guidance from synthesis plan
  sectionWritingGuidance?: {
    approach: string                 // How to write this section
    tone: string                     // Tone to use
    keyPointsToMake: string[]        // Main takeaways
    transitionFrom?: string          // How to connect from previous
    transitionTo?: string            // How to lead into next
  }

  // Explicit citation density for this section (from paper profile)
  sectionCitationDensity?: 'none' | 'light' | 'moderate' | 'heavy'

  // Dynamic, section-specific table schema guidance (when tables are useful)
  tableSchemaGuidance?: string
  
  // Summary stats for the synthesis
  synthesisSummary?: {
    totalPapersAnalyzed: number
    patternsIdentified: number
    contradictionsFound: number
    gapsIdentified: number
    overallNarrative: string         // Brief summary of the literature
  }
}

export interface PromptTemplate {
  system: string
  user: string
  tools?: Record<string, any>
}

export interface BuiltPrompt {
  system: string
  user: string
  tools?: Record<string, any>
}

export interface TemplateOptions {
  model?: string
  temperature?: number
  maxTokens?: number
}

/**
 * Pure PromptBuilder - no file I/O, no network calls
 * All templates and context must be provided as arguments
 */
export class PromptBuilder {
  private constructor() {}

  /**
   * Build prompt from template and data (pure function)
   */
  static build(
    template: PromptTemplate,
    data: PromptData,
    options: TemplateOptions = {}
  ): BuiltPrompt {
    const contextData = {
      ...data,
      // Add computed fields
      hasCurrentText: !!data.currentText,
      isFirstDraft: !data.isRewrite,
      modelName: options.model || 'default',
      temperature: options.temperature || 0.4
    }

    return {
      system: Mustache.render(template.system, contextData),
      user: Mustache.render(template.user, contextData),
      tools: template.tools || {}
    }
  }

  /**
   * Build simple prompt without template (pure function)
   */
  static buildSimple(
    systemPrompt: string,
    userPrompt: string,
    data: Record<string, any>
  ): BuiltPrompt {
    return {
      system: Mustache.render(systemPrompt, data),
      user: Mustache.render(userPrompt, data)
    }
  }

  /**
   * Build planning prompt (pure function)
   */
  static buildPlanningPrompt(
    paperType: PaperTypeKey,
    section: string,
    topic: string,
    expectedWords: number,
    availablePapers: string[] = [],
    qualityCriteria: string[] = []
  ): BuiltPrompt {
    const data = {
      paperType,
      section,
      topic,
      expectedWords,
      availablePapers: availablePapers.slice(0, 5).join(', '),
      qualityCriteria: qualityCriteria.map(c => `• ${c}`).join('\n'),
      paperCount: availablePapers.length
    }

    const system = `You are an expert academic writing assistant specializing in {{paperType}} papers.
Your task is to create detailed, actionable plans for academic sections that meet discipline-specific quality standards.

Focus on:
- Clear logical structure and flow
- Evidence-based arguments with proper citation strategy
- Academic rigor appropriate for {{paperType}}
- Integration of available source materials`

    const user = `Create a detailed plan for the "{{section}}" section of a {{paperType}} about "{{topic}}".

AVAILABLE SOURCES: {{paperCount}} papers including {{availablePapers}}
TARGET LENGTH: {{expectedWords}} words

QUALITY CRITERIA:
{{qualityCriteria}}

Return a JSON plan with:
{
  "outline": ["Key point 1", "Key point 2", "Key point 3"],
  "citation_strategy": "How to integrate sources effectively",
  "quality_checks": "How quality criteria will be met",
  "estimated_words": {{expectedWords}}
}`

    return this.buildSimple(system, user, data)
  }

  /**
   * Build critique prompt (pure function)
   */
  static buildCritiquePrompt(
    content: string,
    paperType: PaperTypeKey,
    section: string,
    topic: string,
    qualityCriteria: string[] = []
  ): BuiltPrompt {
    const data = {
      content,
      paperType,
      section,
      topic,
      qualityCriteria: qualityCriteria.map(c => `• ${c}`).join('\n')
    }

    const system = `You are an expert academic reviewer specializing in {{paperType}} papers.
Provide constructive, specific critique that helps improve academic writing quality.

Focus on:
- Academic rigor and evidence support
- Clarity and organization
- Citation quality and integration
- Argument strength and logical flow`

    const user = `Review this {{section}} section of a {{paperType}} about "{{topic}}":

CONTENT TO REVIEW:
{{content}}

QUALITY CRITERIA:
{{qualityCriteria}}

Provide specific, actionable feedback on:
1. Strengths to maintain
2. Areas for improvement
3. Specific suggestions for enhancement
4. Citation and evidence assessment`

    return this.buildSimple(system, user, data)
  }

  // Pure utility functions (no I/O)
  static formatEvidenceSnippets(chunks: Array<{ 
    content: string
    paper_id: string
    title?: string
    evidence_strength?: 'full_text' | 'abstract' | 'title_only'
  }>): string {
    // Ensure paper diversity: select at least one chunk per unique paper first,
    // then fill remaining slots with highest-relevance chunks
    const MAX_CHUNKS = 24
    const MAX_CHARS_PER_CHUNK = 320
    const MAX_TOTAL_EVIDENCE_CHARS = 18_000
    const seenPapers = new Set<string>()
    const diverseChunks: typeof chunks = []
    const remainingChunks: typeof chunks = []
    
    // First pass: pick one chunk per unique paper
    for (const chunk of chunks) {
      if (!seenPapers.has(chunk.paper_id)) {
        seenPapers.add(chunk.paper_id)
        diverseChunks.push(chunk)
      } else {
        remainingChunks.push(chunk)
      }
    }
    
    // Second pass: fill remaining slots with additional chunks (already sorted by relevance)
    const slotsRemaining = MAX_CHUNKS - diverseChunks.length
    if (slotsRemaining > 0) {
      diverseChunks.push(...remainingChunks.slice(0, slotsRemaining))
    }
    
    const selectedChunks = diverseChunks.slice(0, MAX_CHUNKS)
    
    // Format as plain text blocks with prominent paper_id for easy copying into [@paper_id] markers.
    // No JSON wrapper — saves tokens and makes paper_id visually prominent.
    let usedChars = 0
    const lines: string[] = []
    for (const chunk of selectedChunks) {
      const strength = chunk.evidence_strength || 'full_text'
      const title = chunk.title || 'Source'
      const content = chunk.content.slice(0, MAX_CHARS_PER_CHUNK) + (chunk.content.length > MAX_CHARS_PER_CHUNK ? '...' : '')
      const block = `--- paper_id: ${chunk.paper_id} ---\nTitle: ${title}\nStrength: ${strength}\n${content}`
      if (usedChars + block.length > MAX_TOTAL_EVIDENCE_CHARS) {
        break
      }
      lines.push(block)
      usedChars += block.length + 2
    }
    return lines.join('\n\n')
  }

  static buildSectionPath(sections: string[], currentSection: string): string {
    const index = sections.indexOf(currentSection)
    if (index === -1) return currentSection
    
    const path = sections.slice(0, index + 1)
    return path.join(' → ')
  }

  /**
   * Build autocomplete system prompt from template and CO-STAR context
   */
  static buildCompletePrompt(
    template: PromptTemplate,
    context: CompleteCOStarContext
  ): string {
    return Mustache.render(template.system, context)
  }

  /**
   * Build chat system prompt from template and AUTOMAT context
   * AUTOMAT: Action, Usage, Target, Output, Method, Appearance, Tone
   */
  static buildChatAUTOMATPrompt(
    template: PromptTemplate,
    context: ChatAUTOMATContext
  ): string {
    // Add computed/helper fields for Mustache conditionals
    const templateData = {
      ...context,
      // Targeting strategy helpers for Mustache sections
      isBlockIdStrategy: context.method.targetingStrategy === 'blockId',
      isSelectionStrategy: context.method.targetingStrategy === 'selection',
      isTextSearchStrategy: context.method.targetingStrategy === 'textSearch',
    }
    return Mustache.render(template.system, templateData)
  }

  /**
   * Create default template for when no template file is available
   */
  static getDefaultTemplate(): PromptTemplate {
    return {
      system: `You are an expert academic writing assistant. Write clear, well-structured content appropriate for scholarly publication.

Guidelines:
- Use formal academic tone
- Support claims with evidence from provided sources
- Maintain logical flow and organization
- Follow discipline-specific conventions for {{paperType}}`,

      user: `Write the {{sectionPath}} section for a paper titled "{{paperTitle}}".

OBJECTIVES: {{paperObjectives}}

PREVIOUS SECTIONS SUMMARY:
{{previousSectionsSummary}}

TARGET LENGTH: {{targetWords}} words

CITATION GUIDANCE: Cite whenever you include statistics, findings, theories, methods, or specific claims from sources. Do not cite your own analysis or common knowledge.

AVAILABLE EVIDENCE:
{{evidenceSnippets}}

{{#isRewrite}}
CURRENT TEXT TO IMPROVE:
{{currentText}}

Instructions: Rewrite and improve the above text while maintaining key insights.
{{/isRewrite}}
{{^isRewrite}}
Instructions: Write a comprehensive {{sectionPath}} section that builds logically on previous sections.
{{/isRewrite}}

Requirements:
- Academic tone appropriate for {{paperType}}
- Clear structure with logical flow
- Evidence-based arguments with proper citations
- Meet the target word count of {{targetWords}} words`,

      tools: {}
    }
  }
}