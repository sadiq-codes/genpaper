import 'server-only'
import yaml from 'js-yaml'
import fs from 'fs/promises'
import path from 'path'
import { PromptBuilder, type PromptTemplate } from '@/lib/core/prompt-builder'
import type { PaperTypeKey, SectionKey } from './types'
import type { PromptData, BuiltPrompt, TemplateOptions } from '@/lib/core/prompt-builder'
import type { ChatCOStarContext, CompleteCOStarContext } from './costar-context'

/**
 * PromptService - Template Loading Wrapper
 * 
 * Handles template loading and delegates to pure PromptBuilder.
 * Separates I/O concerns from pure prompt construction logic.
 * 
 * Note: Paper-type specific guidance is now provided by the dynamic Paper Profile system,
 * not by static rubrics in skeleton.yaml. This service focuses on core template loading.
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

  /**
   * Build chat system prompt using CO-STAR framework
   */
  static async buildChatPrompt(context: ChatCOStarContext): Promise<string> {
    const template = await this.loadTemplate('chat')
    return PromptBuilder.buildChatPrompt(template, context)
  }

  /**
   * Build autocomplete system prompt using CO-STAR framework
   */
  static async buildCompletePrompt(context: CompleteCOStarContext): Promise<string> {
    const template = await this.loadTemplate('complete')
    return PromptBuilder.buildCompletePrompt(template, context)
  }

  /**
   * Load suggestion objectives for autocomplete
   */
  static async loadSuggestionObjectives(): Promise<Record<string, { objective: string }>> {
    const cacheKey = 'complete-objectives'
    
    if (this.templateCache.has(cacheKey)) {
      return this.templateCache.get(cacheKey) as unknown as Record<string, { objective: string }>
    }

    try {
      const objectivesPath = path.join(process.cwd(), 'lib/prompts/complete/objectives.yaml')
      const yamlContent = await fs.readFile(objectivesPath, 'utf-8')
      const objectives = yaml.load(yamlContent) as Record<string, { objective: string }>
      
      this.templateCache.set(cacheKey, objectives as unknown as PromptTemplate)
      return objectives
    } catch (error) {
      console.warn('Failed to load suggestion objectives:', error)
      // Return default objectives
      return {
        contextual: { objective: 'Provide an appropriate continuation based on context.' },
        opening_sentence: { objective: 'Write an opening sentence for this paragraph.' },
        complete_sentence: { objective: 'Complete the unfinished sentence.' },
        next_sentence: { objective: 'Write the next logical sentence.' },
        provide_examples: { objective: 'Provide concrete examples from sources.' },
        contrast_point: { objective: 'Present a contrasting perspective.' },
      }
    }
  }

  /**
   * Get objective for a specific suggestion type
   */
  static async getSuggestionObjective(suggestionType: string): Promise<string> {
    const objectives = await this.loadSuggestionObjectives()
    return objectives[suggestionType]?.objective || objectives['contextual']?.objective || 'Continue appropriately.'
  }

  static buildSimple(
    systemPrompt: string,
    userPrompt: string,
    data: Record<string, any> = {}
  ): BuiltPrompt {
    return PromptBuilder.buildSimple(systemPrompt, userPrompt, data)
  }

  private static async loadTemplate(templateName: string): Promise<PromptTemplate> {
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName)!
    }

    try {
      // Determine template path based on template name
      let templatePath: string
      
      switch (templateName) {
        case 'chat':
          templatePath = path.join(process.cwd(), 'lib/prompts/chat/system.yaml')
          break
        case 'complete':
          templatePath = path.join(process.cwd(), 'lib/prompts/complete/system.yaml')
          break
        case 'unified':
        default:
          templatePath = path.join(process.cwd(), 'lib/prompts/unified/skeleton.yaml')
          break
      }
      
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
  static formatEvidenceSnippets(chunks: Array<{ 
    content: string
    paper_id: string
    title?: string
    evidence_strength?: 'full_text' | 'abstract' | 'title_only'
  }>): string {
    return PromptBuilder.formatEvidenceSnippets(chunks)
  }

  static buildSectionPath(sections: string[], currentSection: string): string {
    return PromptBuilder.buildSectionPath(sections, currentSection)
  }

  static estimateTargetWords(paperType: PaperTypeKey, sectionKey: SectionKey): number {
    return PromptBuilder.estimateTargetWords(paperType, sectionKey)
  }
}
