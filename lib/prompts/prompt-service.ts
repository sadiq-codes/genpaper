import 'server-only'
import yaml from 'js-yaml'
import fs from 'fs/promises'
import path from 'path'
import { PromptBuilder, type PromptTemplate } from '@/lib/core/prompt-builder'
import type { PaperTypeKey, SectionKey } from './types'
import type { PromptData, BuiltPrompt, TemplateOptions } from '@/lib/core/prompt-builder'

/**
 * PromptService - Template Loading Wrapper
 * 
 * Handles template loading and delegates to pure PromptBuilder.
 * Separates I/O concerns from pure prompt construction logic.
 */

// Re-export types from pure PromptBuilder
export type { 
  PromptData, 
  BuiltPrompt, 
  TemplateOptions 
} from '@/lib/core/prompt-builder'

export class PromptService {
  private static templateCache = new Map<string, PromptTemplate>()
  
  private constructor() {}

  static async build(
    templateName: string,
    data: PromptData,
    options: TemplateOptions = {}
  ): Promise<BuiltPrompt> {
    const template = await this.loadTemplate(templateName)
    return PromptBuilder.build(template, data, options)
  }

  static async buildUnified(data: PromptData, options: TemplateOptions = {}): Promise<BuiltPrompt> {
    return this.build('unified', data, options)
  }

  static buildSimple(
    systemPrompt: string,
    userPrompt: string,
    data: Record<string, any> = {}
  ): BuiltPrompt {
    return PromptBuilder.buildSimple(systemPrompt, userPrompt, data)
  }

  static buildPlanningPrompt(
    paperType: PaperTypeKey,
    section: SectionKey,
    topic: string,
    availablePapers: string[],
    expectedWords: number,
    qualityCriteria: string[] = []
  ): BuiltPrompt {
    return PromptBuilder.buildPlanningPrompt(
      paperType,
      section,
      topic,
      expectedWords,
      availablePapers,
      qualityCriteria
    )
  }

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
- Logical flow and argumentation
- Citation adequacy and relevance
- Discipline-specific conventions`

    const user = `Review this "{{section}}" section from a {{paperType}} about "{{topic}}":

CONTENT TO REVIEW:
{{content}}

QUALITY CRITERIA TO CHECK:
{{qualityCriteria}}

Provide a JSON critique:
{
  "strengths": ["What works well"],
  "weaknesses": ["Specific issues to address"],
  "missing_citations": ["Where more evidence is needed"],
  "improvement_suggestions": ["Actionable recommendations"],
  "overall_quality": "A score from 1-10 with brief justification"
}`

    return this.buildSimple(system, user, data)
  }

  private static async loadTemplate(templateName: string): Promise<PromptTemplate> {
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName)!
    }

    try {
      const templatePath = path.join(process.cwd(), 'lib/prompts/unified/skeleton.yaml')
      const yamlContent = await fs.readFile(templatePath, 'utf-8')
      const template = yaml.load(yamlContent) as PromptTemplate
      
      this.templateCache.set(templateName, template)
      return template
      
    } catch (error) {
      console.warn(`Failed to load template ${templateName}:`, error)
      
      // Use default template from pure PromptBuilder
      const fallback = PromptBuilder.getDefaultTemplate()
      
      this.templateCache.set(templateName, fallback)
      return fallback
    }
  }

  static clearCache(): void {
    this.templateCache.clear()
  }

  // Delegate utility methods to pure PromptBuilder
  static formatEvidenceSnippets(chunks: Array<{ content: string; paper_id: string; title?: string }>): string {
    return PromptBuilder.formatEvidenceSnippets(chunks)
  }

  static buildSectionPath(sections: string[], currentSection: string): string {
    return PromptBuilder.buildSectionPath(sections, currentSection)
  }

  static estimateTargetWords(paperType: PaperTypeKey, sectionKey: SectionKey): number {
    return PromptBuilder.estimateTargetWords(paperType, sectionKey)
  }
}