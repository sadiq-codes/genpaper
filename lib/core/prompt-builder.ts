/**
 * @core/prompt-builder (Pure)
 * 
 * Pure prompt construction with no I/O or side effects.
 * Templates and context are passed as arguments for testability.
 */

import Mustache from 'mustache'
import type { PaperTypeKey, SectionKey } from '@/lib/prompts/types'

export interface PromptData {
  // Paper-level context
  paperTitle: string
  paperObjectives: string
  outlineTree: string
  
  // Section coherence data
  previousSectionsSummary: string
  alreadyCovered?: string
  sectionPath: string
  sectionPurpose?: string
  exclusions?: string
  requiredPoints?: string
  qualityCriteria?: string
  
  // Writing task parameters
  targetWords: number
  minCitations: number
  isRewrite: boolean
  currentText?: string
  
  // Evidence and context (pre-formatted)
  evidenceSnippets: string
  usedEvidenceLedger?: string
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
      modelName: options.model || 'gpt-4o',
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
    section: SectionKey,
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
    section: SectionKey,
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
  static formatEvidenceSnippets(chunks: Array<{ content: string; paper_id: string; title?: string }>): string {
    return JSON.stringify(
      chunks.slice(0, 10).map((chunk, i) => ({
        id: i + 1,
        paper_id: chunk.paper_id,
        title: chunk.title || 'Source',
        content: chunk.content.slice(0, 500) + (chunk.content.length > 500 ? '...' : '')
      })),
      null,
      2
    )
  }

  static buildSectionPath(sections: string[], currentSection: string): string {
    const index = sections.indexOf(currentSection)
    if (index === -1) return currentSection
    
    const path = sections.slice(0, index + 1)
    return path.join(' → ')
  }

  static estimateTargetWords(paperType: PaperTypeKey, sectionKey: SectionKey): number {
    // Keep only keys that exist in PaperTypeKey union from prompts/types
    const wordEstimates: Partial<Record<PaperTypeKey, Record<string, number>>> = {
      researchArticle: {
        introduction: 400,
        methods: 600,
        results: 800,
        discussion: 700,
        conclusion: 300
      },
      literatureReview: {
        introduction: 500,
        background: 1000,
        analysis: 1200,
        synthesis: 800,
        conclusion: 400
      },
      capstoneProject: {
        introduction: 300,
        methodology: 800,
        discussion: 600,
        conclusion: 300
      },
      mastersThesis: {
        introduction: 600,
        methodology: 1200,
        results: 1200,
        discussion: 1000,
        conclusion: 500
      },
      phdDissertation: {
        introduction: 800,
        methodology: 1500,
        results: 1600,
        discussion: 1400,
        conclusion: 600
      }
    }

    return wordEstimates[paperType]?.[sectionKey] || 500
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
MINIMUM CITATIONS: {{minCitations}}

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