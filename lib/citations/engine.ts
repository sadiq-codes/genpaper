/**
 * Citation Engine
 * 
 * Handles citation processing, style management, and interactive citation rendering
 * Built on top of citation-js library with CSL style support
 */

import Cite from 'citation-js'
// citation-js lacks TypeScript typings; treat constructor generically
/* eslint-disable @typescript-eslint/no-explicit-any */
const CiteConstructor: any = (Cite as any)
import { styleRepository } from './style-repository'
import type { CSLItem } from '@/lib/utils/csl'

// Match citation tokens of the form [CITE:ID] where ID can be a UUID, DOI, or alphanumeric key
//  – allows optional whitespace after the colon
//  – supports dashes/underscores/dots/slashes inside the key for DOIs
const CITATION_TOKEN_REGEX = /\[CITE:\s*([a-f0-9\-]{36}|[A-Za-z0-9_\-\.\/]+)\]/g

// Supported output formats (matching citation-js)
export type CitationOutputFormat = 'html' | 'text'

// Citation style metadata
export interface CitationStyleInfo {
  id: string
  name: string
  category: 'author-date' | 'numeric' | 'note' | 'label'
  description?: string
  example?: string
}

// Interactive citation data
export interface InteractiveCitation {
  id: string
  csl: CSLItem
  inlineFormat: string
  bibliographyFormat: string
  isEditable: boolean
  position: {
    start: number
    end: number
  }
}

// Citation rendering options
export interface CitationRenderOptions {
  style: string
  format: CitationOutputFormat
  locale?: string
  interactive?: boolean
  highlightEditable?: boolean
}

// Document citation context
export interface DocumentCitationContext {
  documentId: string
  citations: Map<string, CSLItem>
  currentStyle: string
  locale: string
}

/**
 * Citation-Agnostic Engine
 * 
 * This engine provides:
 * 1. Support for 5000+ citation styles via CSL
 * 2. Interactive citation editing
 * 3. Dynamic style switching
 * 4. Clickable citation rendering
 */
export class CitationEngine {
  private styleCache = new Map<string, any>()
  private citationCache = new Map<string, InteractiveCitation>()
  private initialized = false

  constructor() {
    this.initialized = true
  }

  private async ensureInitialized() {
    if (!this.initialized) {
      throw new Error('Citation engine failed to initialize')
    }
  }

  /**
   * Get available citation styles from the style repository
   */
  async getAvailableStyles(): Promise<CitationStyleInfo[]> {
    try {
      return await styleRepository.getAvailableStyles()
    } catch (error) {
      console.error('Failed to get available styles:', error)
      // Return core styles as fallback
      return [
        { id: 'apa', name: 'APA 7th Edition', category: 'author-date', example: '(Smith, 2023)' },
        { id: 'mla', name: 'MLA 9th Edition', category: 'author-date', example: '(Smith 123)' },
        { id: 'chicago-author-date', name: 'Chicago Author-Date', category: 'author-date', example: '(Smith 2023)' },
        { id: 'ieee', name: 'IEEE', category: 'numeric', example: '[1]' },
      ]
    }
  }

  /**
   * Load a specific citation style
   */
  async loadStyle(styleId: string): Promise<void> {
    if (this.styleCache.has(styleId)) {
      return
    }

    try {
      // Use built-in citation-js styles for common formats
      this.styleCache.set(styleId, { id: styleId, loaded: true })
    } catch (error) {
      console.error(`Failed to load citation style: ${styleId}`, error)
      throw new Error(`Citation style '${styleId}' could not be loaded`)
    }
  }

  /**
   * Process document content and render citations
   */
  async renderDocument(
    content: string,
    context: DocumentCitationContext,
    options: CitationRenderOptions
  ): Promise<{
    renderedContent: string
    bibliography: string
    citations: InteractiveCitation[]
    missingCitations: string[]
  }> {
    await this.ensureInitialized()
    await this.loadStyle(options.style)

    const citations: InteractiveCitation[] = []
    const missingCitations: string[] = []
    const citationMatches: Array<{ match: string; id: string; start: number; end: number }> = []

    // Find all citation tokens
    let match
    while ((match = CITATION_TOKEN_REGEX.exec(content)) !== null) {
      citationMatches.push({
        match: match[0],
        id: match[1],
        start: match.index,
        end: match.index + match[0].length
      })
    }

    // Process each citation
    const processedCitations = new Map<string, string>()
    
    for (const citationMatch of citationMatches) {
      const { id, start, end } = citationMatch
      
      if (!context.citations.has(id)) {
        missingCitations.push(id)
        continue
      }

      const csl = context.citations.get(id)!
      
      try {
        // Generate citation using citation-js
        const cite = new CiteConstructor(csl)
        
        let inlineFormat: string
        let bibliographyFormat: string

        try {
          inlineFormat = cite.format('citation', {
            format: options.format,
            template: options.style,
            lang: options.locale || 'en-US'
          })

          bibliographyFormat = cite.format('bibliography', {
            format: options.format,
            template: options.style,
            lang: options.locale || 'en-US'
          })
        } catch (formatError) {
          console.warn(`Format error for citation ${id}, using fallback:`, formatError)
                     // Fallback to simple format
           inlineFormat = this.generateSimpleCitation(csl, options.style)
           bibliographyFormat = this.generateSimpleBibliography(csl)
        }

        // Create interactive citation
        const interactiveCitation: InteractiveCitation = {
          id,
          csl,
          inlineFormat,
          bibliographyFormat,
          isEditable: options.interactive ?? true,
          position: { start, end }
        }

        citations.push(interactiveCitation)
        
        // Generate clickable HTML if interactive
        if (options.interactive) {
          const clickableHtml = this.generateClickableCitation(
            id,
            inlineFormat,
            options.highlightEditable ?? true
          )
          processedCitations.set(id, clickableHtml)
        } else {
          processedCitations.set(id, inlineFormat)
        }

      } catch (error) {
        console.error(`Failed to process citation ${id}:`, error)
        // Generate a fallback citation
        const fallbackCitation = this.generateFallbackCitation(id, context.citations.get(id)!, options.style)
        processedCitations.set(id, fallbackCitation)
      }
    }

    // Replace citation tokens with rendered citations
    let renderedContent = content
    for (const [citationId, renderedCitation] of processedCitations) {
      // Allow optional whitespace around the key when performing replacement
      const escapedId = citationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex characters
      const tokenRegex = new RegExp(`\\[CITE:\\s*${escapedId}\\s*\\]`, 'g')
      renderedContent = renderedContent.replace(tokenRegex, renderedCitation)
    }

    // Generate bibliography
    const allCitations = Array.from(context.citations.values())
    const bibliography = await this.generateBibliography(allCitations, options)

    return {
      renderedContent,
      bibliography,
      citations,
      missingCitations
    }
  }

  /**
   * Generate a simple citation format as fallback
   */
  private generateSimpleCitation(csl: CSLItem, style: string): string {
    // Extract author names more robustly
    let authors = 'Anonymous'
    if (csl.author && csl.author.length > 0) {
      const authorNames = csl.author.map(a => {
        if (a.family) {
          return a.family
        } else if (a.literal) {
          return a.literal
        }
        // Handle any other cases
        return ''
      }).filter(Boolean)
      
      if (authorNames.length > 0) {
        if (authorNames.length === 1) {
          authors = authorNames[0]
        } else if (authorNames.length === 2) {
          authors = `${authorNames[0]} & ${authorNames[1]}`
        } else {
          authors = `${authorNames[0]} et al.`
        }
      }
    }
    
    const year = csl.issued?.['date-parts']?.[0]?.[0] || (csl.issued as any)?.literal || 'n.d.'
    
    if (style.includes('numeric') || style === 'ieee' || style === 'vancouver') {
      return '[1]' // Simple numeric style - could be enhanced with actual numbering
    } else {
      return `(${authors}, ${year})`
    }
  }

  /**
   * Generate a simple bibliography entry as fallback
   */
  private generateSimpleBibliography(csl: CSLItem): string {
    const authors = csl.author?.map(a => `${a.family}, ${a.given?.charAt(0)}.` || a.literal || '').filter(Boolean).join(', ') || 'Anonymous'
    const year = csl.issued?.['date-parts']?.[0]?.[0] || (csl.issued as any)?.literal || 'n.d.'
    const title = csl.title || 'Untitled'
    
    return `${authors} (${year}). ${title}.`
  }

  /**
   * Generate a fallback citation when processing fails
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private generateFallbackCitation(_id: string, csl: CSLItem, _style: string): string {
    // Use the same robust author extraction as generateSimpleCitation
    let authors = 'Anonymous'
    if (csl.author && csl.author.length > 0) {
      const authorNames = csl.author.map(a => {
        if (a.family) {
          return a.family
        } else if (a.literal) {
          return a.literal
        }
        return ''
      }).filter(Boolean)
      
      if (authorNames.length > 0) {
        if (authorNames.length === 1) {
          authors = authorNames[0]
        } else if (authorNames.length === 2) {
          authors = `${authorNames[0]} & ${authorNames[1]}`
        } else {
          authors = `${authorNames[0]} et al.`
        }
      }
    }
    
    const year = csl.issued?.['date-parts']?.[0]?.[0] || (csl.issued as any)?.literal || 'n.d.'
    
    return `(${authors}, ${year})`
  }

  /**
   * Generate clickable citation HTML
   */
  private generateClickableCitation(
    citationId: string,
    formattedCitation: string,
    highlight: boolean
  ): string {
    const baseClasses = 'citation-link inline-flex items-center cursor-pointer transition-colors'
    const highlightClasses = highlight 
      ? 'px-1 py-0.5 rounded text-blue-600 hover:text-blue-800 hover:bg-blue-50 border border-blue-200 hover:border-blue-300'
      : 'text-inherit hover:text-blue-600'

    return `<button 
      class="${baseClasses} ${highlightClasses}"
      data-citation-id="${citationId}"
      data-action="edit-citation"
      onclick="window.handleCitationClick && window.handleCitationClick('${citationId}')"
      title="Click to edit citation"
    >${formattedCitation}</button>`
  }

  /**
   * Generate bibliography for all citations
   */
  private async generateBibliography(
    citations: CSLItem[],
    options: CitationRenderOptions
  ): Promise<string> {
    if (citations.length === 0) {
      return ''
    }

    try {
      const cite = new CiteConstructor(citations)
      return cite.format('bibliography', {
        format: options.format,
        template: options.style,
        lang: options.locale || 'en-US'
      })
    } catch (error) {
      console.error('Failed to generate bibliography:', error)
      // Generate simple bibliography as fallback
      return citations.map(csl => this.generateSimpleBibliography(csl)).join('\n')
    }
  }

  /**
   * Update a single citation and re-render affected content
   */
  async updateCitation(
    citationId: string,
    newCsl: CSLItem,
    context: DocumentCitationContext,
    options: CitationRenderOptions
  ): Promise<InteractiveCitation> {
    // Update the citation in context
    context.citations.set(citationId, newCsl)
    
    // Clear cache for this citation
    this.citationCache.delete(citationId)
    
    // Re-process this specific citation
    const cite = new CiteConstructor(newCsl)
    
    const inlineFormat = cite.format('citation', {
      format: options.format,
      template: options.style,
      lang: options.locale || 'en-US'
    })

    const bibliographyFormat = cite.format('bibliography', {
      format: options.format,
      template: options.style,
      lang: options.locale || 'en-US'
    })

    const updatedCitation: InteractiveCitation = {
      id: citationId,
      csl: newCsl,
      inlineFormat,
      bibliographyFormat,
      isEditable: true,
      position: { start: 0, end: 0 } // Position will be updated by caller
    }

    this.citationCache.set(citationId, updatedCitation)
    return updatedCitation
  }

  /**
   * Change citation style for entire document
   */
  async changeDocumentStyle(
    content: string,
    context: DocumentCitationContext,
    newStyle: string,
    options: Omit<CitationRenderOptions, 'style'>
  ): Promise<{
    renderedContent: string
    bibliography: string
    citations: InteractiveCitation[]
  }> {
    // Clear style cache to force reload
    this.styleCache.delete(context.currentStyle)
    this.citationCache.clear()
    
    // Update context
    context.currentStyle = newStyle
    
    // Re-render with new style
    const result = await this.renderDocument(content, context, {
      ...options,
      style: newStyle
    })

    return {
      renderedContent: result.renderedContent,
      bibliography: result.bibliography,
      citations: result.citations
    }
  }

  /**
   * Validate CSL-JSON citation data
   */
  validateCitation(csl: unknown): csl is CSLItem {
    try {
      new CiteConstructor(csl)
      return true
    } catch {
      return false
    }
  }

  /**
   * Search available citation styles
   */
  async searchStyles(query: string): Promise<CitationStyleInfo[]> {
    const allStyles = await this.getAvailableStyles()
    const lowercaseQuery = query.toLowerCase()
    
    return allStyles.filter(style => 
      style.name.toLowerCase().includes(lowercaseQuery) ||
      style.id.toLowerCase().includes(lowercaseQuery) ||
      style.category.toLowerCase().includes(lowercaseQuery)
    )
  }
}

// Singleton instance
export const citationEngine = new CitationEngine()

// Utility functions
export function extractCitationIds(content: string): string[] {
  const matches = content.match(CITATION_TOKEN_REGEX)
  return matches ? matches.map(match => match.replace(CITATION_TOKEN_REGEX, '$1')) : []
}

export function replaceCitationToken(content: string, citationId: string, replacement: string): string {
  const escapedId = citationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tokenRegex = new RegExp(`\\[CITE:\\s*${escapedId}\\s*\\]`, 'g')
  return content.replace(tokenRegex, replacement)
}

export function insertCitationToken(content: string, position: number, citationId: string): string {
  const token = `[CITE:${citationId}]`
  return content.slice(0, position) + token + content.slice(position)
} 