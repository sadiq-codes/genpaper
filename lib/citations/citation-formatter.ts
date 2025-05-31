// Citation Format Engine - Generate citations in any style

import type { Citation } from './citation-sources'

export type CitationStyle = 'apa7' | 'mla9' | 'chicago17' | 'ieee' | 'harvard'

export interface InTextOptions {
  includeAllAuthors?: boolean
  pageNumbers?: string
  suppressAuthor?: boolean
  year?: string
}

export interface CitationFormatter {
  style: CitationStyle
  formatInText(citation: Citation, options?: InTextOptions): string
  formatBibliography(citation: Citation): string
  formatAuthorList(authors: Citation['authors'], style?: 'full' | 'short' | 'last-first'): string
}

export class APAFormatter implements CitationFormatter {
  style: CitationStyle = 'apa7'

  formatInText(citation: Citation, options: InTextOptions = {}): string {
    const { includeAllAuthors = false, pageNumbers, suppressAuthor = false } = options
    
    if (suppressAuthor) {
      return `(${citation.year || 'n.d.'}${pageNumbers ? `, p. ${pageNumbers}` : ''})`
    }

    const authors = this.formatInTextAuthors(citation.authors, includeAllAuthors)
    const year = citation.year || 'n.d.'
    
    return `(${authors}, ${year}${pageNumbers ? `, p. ${pageNumbers}` : ''})`
  }

  formatBibliography(citation: Citation): string {
    const authors = this.formatBibliographyAuthors(citation.authors)
    const year = citation.year ? `(${citation.year})` : '(n.d.)'
    const title = this.formatTitle(citation.title, citation.type)
    
    switch (citation.type) {
      case 'article':
        return this.formatJournalArticle(authors, year, title, citation)
      case 'book':
        return this.formatBook(authors, year, title, citation)
      case 'conference':
        return this.formatConferenceProceeding(authors, year, title, citation)
      case 'website':
        return this.formatWebsite(authors, year, title, citation)
      case 'thesis':
        return this.formatThesis(authors, year, title, citation)
      default:
        return this.formatJournalArticle(authors, year, title, citation)
    }
  }

  formatAuthorList(authors: Citation['authors'], style: 'full' | 'short' | 'last-first' = 'full'): string {
    switch (style) {
      case 'short':
        return this.formatInTextAuthors(authors, false)
      case 'last-first':
        return this.formatBibliographyAuthors(authors)
      default:
        return this.formatInTextAuthors(authors, true)
    }
  }

  private formatInTextAuthors(authors: Citation['authors'], includeAll: boolean): string {
    if (!authors || authors.length === 0) return 'Unknown'
    
    if (authors.length === 1) {
      return authors[0].family
    }
    
    if (authors.length === 2) {
      return `${authors[0].family} & ${authors[1].family}`
    }
    
    if (includeAll || authors.length <= 2) {
      const lastAuthor = authors[authors.length - 1]
      const otherAuthors = authors.slice(0, -1).map(a => a.family)
      return `${otherAuthors.join(', ')}, & ${lastAuthor.family}`
    }
    
    return `${authors[0].family} et al.`
  }

  private formatBibliographyAuthors(authors: Citation['authors']): string {
    if (!authors || authors.length === 0) return 'Unknown.'
    
    if (authors.length === 1) {
      const author = authors[0]
      const initials = author.given.split(' ').map(name => name.charAt(0).toUpperCase() + '.').join(' ')
      return `${author.family}, ${initials}`
    }
    
    const authorList = authors.map((author, index) => {
      const initials = author.given.split(' ').map(name => name.charAt(0).toUpperCase() + '.').join(' ')
      
      if (index === 0) {
        return `${author.family}, ${initials}`
      } else if (index === authors.length - 1) {
        return `& ${initials} ${author.family}`
      } else {
        return `${initials} ${author.family}`
      }
    })
    
    return authorList.join(', ')
  }

  private formatTitle(title: string, type: Citation['type']): string {
    if (type === 'article') {
      return title // Article titles are not italicized in APA
    }
    return `*${title}*` // Books, theses, etc. are italicized
  }

  private formatJournalArticle(authors: string, year: string, title: string, citation: Citation): string {
    let result = `${authors} ${year}. ${title}.`
    
    if (citation.journal) {
      result += ` *${citation.journal}*`
      
      if (citation.volume) {
        result += `, *${citation.volume}*`
        
        if (citation.issue) {
          result += `(${citation.issue})`
        }
      }
      
      if (citation.pages) {
        result += `, ${citation.pages}`
      }
    }
    
    if (citation.doi) {
      result += `. https://doi.org/${citation.doi}`
    } else if (citation.url) {
      result += `. ${citation.url}`
    }
    
    return result + '.'
  }

  private formatBook(authors: string, year: string, title: string, citation: Citation): string {
    let result = `${authors} ${year}. ${title}`
    
    // Add edition, publisher, etc. if available
    return result + '.'
  }

  private formatConferenceProceeding(authors: string, year: string, title: string, citation: Citation): string {
    let result = `${authors} ${year}. ${title}`
    
    if (citation.journal) { // Using journal field for conference name
      result += `. In *${citation.journal}*`
    }
    
    if (citation.pages) {
      result += ` (pp. ${citation.pages})`
    }
    
    return result + '.'
  }

  private formatWebsite(authors: string, year: string, title: string, citation: Citation): string {
    let result = `${authors} ${year}. ${title}`
    
    if (citation.journal) { // Using journal field for website name
      result += `. *${citation.journal}*`
    }
    
    if (citation.url) {
      result += `. ${citation.url}`
    }
    
    return result + '.'
  }

  private formatThesis(authors: string, year: string, title: string, citation: Citation): string {
    let result = `${authors} ${year}. ${title}`
    
    if (citation.type === 'thesis') {
      result += ' [Doctoral dissertation'
      
      if (citation.journal) { // Using journal field for institution
        result += `, ${citation.journal}`
      }
      
      result += ']'
    }
    
    if (citation.url) {
      result += `. ${citation.url}`
    }
    
    return result + '.'
  }
}

export class MLAFormatter implements CitationFormatter {
  style: CitationStyle = 'mla9'

  formatInText(citation: Citation, options: InTextOptions = {}): string {
    const { pageNumbers } = options
    const firstAuthor = citation.authors[0]
    
    if (!firstAuthor) return '(Unknown)'
    
    let result = `(${firstAuthor.family}`
    
    if (pageNumbers) {
      result += ` ${pageNumbers}`
    }
    
    return result + ')'
  }

  formatBibliography(citation: Citation): string {
    const authors = this.formatMLAAuthors(citation.authors)
    const title = `"${citation.title}"`
    
    let result = `${authors}. ${title}`
    
    if (citation.journal) {
      result += ` *${citation.journal}*,`
    }
    
    if (citation.year) {
      result += ` ${citation.year}`
    }
    
    if (citation.pages) {
      result += `, pp. ${citation.pages}`
    }
    
    return result + '.'
  }

  formatAuthorList(authors: Citation['authors'], style: 'full' | 'short' | 'last-first' = 'full'): string {
    return this.formatMLAAuthors(authors)
  }

  private formatMLAAuthors(authors: Citation['authors']): string {
    if (!authors || authors.length === 0) return 'Unknown'
    
    if (authors.length === 1) {
      const author = authors[0]
      return `${author.family}, ${author.given}`
    }
    
    const firstAuthor = authors[0]
    if (authors.length === 2) {
      const secondAuthor = authors[1]
      return `${firstAuthor.family}, ${firstAuthor.given}, and ${secondAuthor.given} ${secondAuthor.family}`
    }
    
    return `${firstAuthor.family}, ${firstAuthor.given}, et al.`
  }
}

export class ChicagoFormatter implements CitationFormatter {
  style: CitationStyle = 'chicago17'

  formatInText(citation: Citation, options: InTextOptions = {}): string {
    const { pageNumbers } = options
    const firstAuthor = citation.authors[0]
    
    if (!firstAuthor) return '(Unknown)'
    
    let result = `(${firstAuthor.family} ${citation.year || 'n.d.'}`
    
    if (pageNumbers) {
      result += `, ${pageNumbers}`
    }
    
    return result + ')'
  }

  formatBibliography(citation: Citation): string {
    const authors = this.formatChicagoAuthors(citation.authors)
    const title = citation.type === 'article' ? `"${citation.title}"` : `*${citation.title}*`
    
    let result = `${authors}. ${title}`
    
    if (citation.journal) {
      result += ` *${citation.journal}*`
    }
    
    if (citation.volume && citation.issue) {
      result += ` ${citation.volume}, no. ${citation.issue}`
    } else if (citation.volume) {
      result += ` ${citation.volume}`
    }
    
    if (citation.year) {
      result += ` (${citation.year})`
    }
    
    if (citation.pages) {
      result += `: ${citation.pages}`
    }
    
    return result + '.'
  }

  formatAuthorList(authors: Citation['authors'], style: 'full' | 'short' | 'last-first' = 'full'): string {
    return this.formatChicagoAuthors(authors)
  }

  private formatChicagoAuthors(authors: Citation['authors']): string {
    if (!authors || authors.length === 0) return 'Unknown'
    
    if (authors.length === 1) {
      const author = authors[0]
      return `${author.family}, ${author.given}`
    }
    
    const firstAuthor = authors[0]
    if (authors.length === 2) {
      const secondAuthor = authors[1]
      return `${firstAuthor.family}, ${firstAuthor.given}, and ${secondAuthor.given} ${secondAuthor.family}`
    }
    
    return `${firstAuthor.family}, ${firstAuthor.given}, et al.`
  }
}

// Citation Formatter Factory
export class CitationFormatterFactory {
  static createFormatter(style: CitationStyle): CitationFormatter {
    switch (style) {
      case 'apa7':
        return new APAFormatter()
      case 'mla9':
        return new MLAFormatter()
      case 'chicago17':
        return new ChicagoFormatter()
      default:
        return new APAFormatter()
    }
  }

  static getSupportedStyles(): CitationStyle[] {
    return ['apa7', 'mla9', 'chicago17']
  }

  static getStyleDisplayName(style: CitationStyle): string {
    const names: Record<CitationStyle, string> = {
      'apa7': 'APA 7th Edition',
      'mla9': 'MLA 9th Edition',
      'chicago17': 'Chicago 17th Edition',
      'ieee': 'IEEE',
      'harvard': 'Harvard'
    }
    return names[style] || style
  }
} 