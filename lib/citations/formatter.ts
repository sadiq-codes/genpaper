// Bibliography formatting with citation-js for proper CSL support
// Install: npm install @citation-js/core @citation-js/plugin-csl

import { Cite } from '@citation-js/core'
import '@citation-js/plugin-csl'

export type CitationStyle = 'apa' | 'mla' | 'chicago' | 'ieee' | 'harvard' | 'nature'

// Cache for loaded CSL styles
const cslStyleCache = new Map<string, string>()

// Load CSL style from public directory
async function loadCslStyle(style: CitationStyle): Promise<string> {
  if (cslStyleCache.has(style)) {
    return cslStyleCache.get(style)!
  }

  try {
    // In a real implementation, you'd store CSL files in public/csl/
    // For now, we'll use the built-in styles from citation-js
    const styleMap: Record<CitationStyle, string> = {
      apa: 'apa',
      mla: 'modern-language-association',
      chicago: 'chicago-author-date',
      ieee: 'ieee',
      harvard: 'harvard-cite-them-right',
      nature: 'nature'
    }

    const cslStyle = styleMap[style] || 'apa'
    cslStyleCache.set(style, cslStyle)
    return cslStyle
  } catch (error) {
    console.error(`Error loading CSL style ${style}:`, error)
    return 'apa' // Fallback to APA
  }
}

export interface FormattedCitation {
  inText: string
  bibliography: string
  key: string
}

export interface CitationFormatterOptions {
  style: CitationStyle
  locale?: string
  format?: 'text' | 'html'
}

export class CitationFormatter {
  private style: CitationStyle
  private locale: string
  private format: 'text' | 'html'

  constructor(options: CitationFormatterOptions = { style: 'apa' }) {
    this.style = options.style
    this.locale = options.locale || 'en-US'
    this.format = options.format || 'text'
  }

  /**
   * Format a single citation for in-text use
   */
  async formatInText(citationData: any, options?: { 
    suppressAuthor?: boolean
    pageNumbers?: string
    prefix?: string
    suffix?: string
  }): Promise<string> {
    try {
      const cslStyle = await loadCslStyle(this.style)
      const cite = new Cite(citationData)
      
      // Generate in-text citation
      const formatted = cite.format('citation', {
        template: cslStyle,
        lang: this.locale,
        format: this.format,
        ...options
      })

      return formatted
    } catch (error) {
      console.error('Error formatting in-text citation:', error)
      // Fallback formatting
      return this.fallbackInTextFormat(citationData)
    }
  }

  /**
   * Format a single citation for bibliography
   */
  async formatBibliography(citationData: any): Promise<string> {
    try {
      const cslStyle = await loadCslStyle(this.style)
      const cite = new Cite(citationData)
      
      const formatted = cite.format('bibliography', {
        template: cslStyle,
        lang: this.locale,
        format: this.format
      })

      return formatted
    } catch (error) {
      console.error('Error formatting bibliography citation:', error)
      return this.fallbackBibliographyFormat(citationData)
    }
  }

  /**
   * Format multiple citations into a complete bibliography
   */
  async formatBibliographyList(citations: any[]): Promise<string> {
    try {
      const cslStyle = await loadCslStyle(this.style)
      const cite = new Cite(citations)
      
      const formatted = cite.format('bibliography', {
        template: cslStyle,
        lang: this.locale,
        format: this.format
      })

      return formatted
    } catch (error) {
      console.error('Error formatting bibliography list:', error)
      // Fallback: format each citation individually
      const formattedCitations = await Promise.all(
        citations.map(citation => this.formatBibliography(citation))
      )
      return formattedCitations.join('\n\n')
    }
  }

  /**
   * Change the citation style
   */
  setStyle(style: CitationStyle) {
    this.style = style
  }

  /**
   * Get available citation styles
   */
  static getAvailableStyles(): CitationStyle[] {
    return ['apa', 'mla', 'chicago', 'ieee', 'harvard', 'nature']
  }

  /**
   * Fallback in-text formatting when citation-js fails
   */
  private fallbackInTextFormat(citationData: any): string {
    const author = citationData.author?.[0]?.family || 'Unknown'
    const year = citationData.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
    
    switch (this.style) {
      case 'apa':
        return `(${author}, ${year})`
      case 'mla':
        return `(${author})`
      case 'chicago':
        return `(${author} ${year})`
      default:
        return `(${author}, ${year})`
    }
  }

  /**
   * Fallback bibliography formatting when citation-js fails
   */
  private fallbackBibliographyFormat(citationData: any): string {
    const authors = citationData.author?.map((a: any) => `${a.given} ${a.family}`).join(', ') || 'Unknown Author'
    const year = citationData.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
    const title = citationData.title || 'Untitled'
    const journal = citationData['container-title'] || ''
    const volume = citationData.volume ? `, ${citationData.volume}` : ''
    const issue = citationData.issue ? `(${citationData.issue})` : ''
    const pages = citationData.page ? `, ${citationData.page}` : ''
    const doi = citationData.DOI ? ` https://doi.org/${citationData.DOI}` : ''
    
    switch (this.style) {
      case 'apa':
        return `${authors} (${year}). ${title}. ${journal}${volume}${issue}${pages}.${doi}`
      case 'mla':
        return `${authors}. "${title}" ${journal}${volume}${issue} (${year})${pages}.${doi}`
      case 'chicago':
        return `${authors}. "${title}" ${journal}${volume}, no. ${issue} (${year})${pages}.${doi}`
      default:
        return `${authors} (${year}). ${title}. ${journal}${volume}${issue}${pages}.${doi}`
    }
  }
}

// Utility function for quick formatting
export async function formatCitation(
  citationData: any, 
  type: 'inText' | 'bibliography', 
  style: CitationStyle = 'apa'
): Promise<string> {
  const formatter = new CitationFormatter({ style })
  
  if (type === 'inText') {
    return formatter.formatInText(citationData)
  } else {
    return formatter.formatBibliography(citationData)
  }
}

// Export default formatter instance
export const defaultFormatter = new CitationFormatter({ style: 'apa' }) 