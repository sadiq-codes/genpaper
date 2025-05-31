// Smart Citation Matcher - Better than string matching

import type { Citation } from './citation-sources'

export interface CitationMatch {
  citation: Citation
  confidence: number
  matchType: 'doi' | 'title' | 'author-year' | 'fuzzy'
  matchedText: string
}

export class CitationMatcher {
  private citationsByDoi: Map<string, Citation> = new Map()
  private citationsByTitle: Map<string, Citation> = new Map()
  private citationsByAuthorYear: Map<string, Citation> = new Map()
  private allCitations: Citation[] = []

  constructor(citations: Citation[]) {
    this.allCitations = citations
    this.buildIndexes(citations)
  }

  private buildIndexes(citations: Citation[]) {
    citations.forEach(citation => {
      // DOI index (most reliable)
      if (citation.doi) {
        this.citationsByDoi.set(citation.doi.toLowerCase(), citation)
      }

      // Normalized title index
      const normalizedTitle = this.normalizeTitle(citation.title)
      this.citationsByTitle.set(normalizedTitle, citation)

      // Author-year index
      const authorYearKey = this.createAuthorYearKey(citation)
      if (authorYearKey) {
        this.citationsByAuthorYear.set(authorYearKey, citation)
      }
    })
  }

  findBestMatch(text: string): CitationMatch | null {
    const matches: CitationMatch[] = []

    // 1. Try DOI matching first (highest confidence)
    const doiMatch = this.findDoiMatch(text)
    if (doiMatch) matches.push(doiMatch)

    // 2. Try author-year pattern matching
    const authorYearMatch = this.findAuthorYearMatch(text)
    if (authorYearMatch) matches.push(authorYearMatch)

    // 3. Try title matching
    const titleMatch = this.findTitleMatch(text)
    if (titleMatch) matches.push(titleMatch)

    // 4. Try fuzzy matching as fallback
    if (matches.length === 0) {
      const fuzzyMatch = this.findFuzzyMatch(text)
      if (fuzzyMatch) matches.push(fuzzyMatch)
    }

    // Return match with highest confidence
    return matches.sort((a, b) => b.confidence - a.confidence)[0] || null
  }

  findAllMatches(text: string, minConfidence = 0.6): CitationMatch[] {
    const matches: CitationMatch[] = []

    // Find all DOI matches
    matches.push(...this.findAllDoiMatches(text))

    // Find all author-year matches
    matches.push(...this.findAllAuthorYearMatches(text))

    // Find all title matches
    matches.push(...this.findAllTitleMatches(text))

    // Deduplicate and filter by confidence
    const uniqueMatches = this.deduplicateMatches(matches)
    return uniqueMatches.filter(match => match.confidence >= minConfidence)
  }

  private findDoiMatch(text: string): CitationMatch | null {
    const doiPattern = /10\.\d{4,}\/[-._;()\/:a-zA-Z0-9]+/g
    const match = doiPattern.exec(text)
    
    if (match) {
      const doi = match[0].toLowerCase()
      const citation = this.citationsByDoi.get(doi)
      
      if (citation) {
        return {
          citation,
          confidence: 0.95,
          matchType: 'doi',
          matchedText: match[0]
        }
      }
    }
    
    return null
  }

  private findAllDoiMatches(text: string): CitationMatch[] {
    const doiPattern = /10\.\d{4,}\/[-._;()\/:a-zA-Z0-9]+/g
    const matches: CitationMatch[] = []
    let match: RegExpExecArray | null

    while ((match = doiPattern.exec(text)) !== null) {
      const doi = match[0].toLowerCase()
      const citation = this.citationsByDoi.get(doi)
      
      if (citation) {
        matches.push({
          citation,
          confidence: 0.95,
          matchType: 'doi',
          matchedText: match[0]
        })
      }
    }

    return matches
  }

  private findAuthorYearMatch(text: string): CitationMatch | null {
    // Pattern: "Author et al. (2023)" or "Author (2023)" or "(Author, 2023)"
    const patterns = [
      /([A-Z][a-z]+)(?:\s+et\s+al\.?)?\s*\((\d{4})\)/g,
      /\(([A-Z][a-z]+)(?:\s+et\s+al\.?)?,?\s*(\d{4})\)/g,
      /([A-Z][a-z]+)(?:\s+et\s+al\.?)?,?\s*(\d{4})/g
    ]

    for (const pattern of patterns) {
      const match = pattern.exec(text)
      if (match) {
        const author = match[1].toLowerCase()
        const year = match[2]
        const key = `${author}_${year}`
        
        const citation = this.citationsByAuthorYear.get(key)
        if (citation) {
          return {
            citation,
            confidence: 0.85,
            matchType: 'author-year',
            matchedText: match[0]
          }
        }
      }
    }

    return null
  }

  private findAllAuthorYearMatches(text: string): CitationMatch[] {
    const patterns = [
      /([A-Z][a-z]+)(?:\s+et\s+al\.?)?\s*\((\d{4})\)/g,
      /\(([A-Z][a-z]+)(?:\s+et\s+al\.?)?,?\s*(\d{4})\)/g,
      /([A-Z][a-z]+)(?:\s+et\s+al\.?)?,?\s*(\d{4})/g
    ]

    const matches: CitationMatch[] = []

    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text)) !== null) {
        const author = match[1].toLowerCase()
        const year = match[2]
        const key = `${author}_${year}`
        
        const citation = this.citationsByAuthorYear.get(key)
        if (citation) {
          matches.push({
            citation,
            confidence: 0.85,
            matchType: 'author-year',
            matchedText: match[0]
          })
        }
      }
    }

    return matches
  }

  private findTitleMatch(text: string): CitationMatch | null {
    const normalizedText = this.normalizeTitle(text)
    
    for (const [titleKey, citation] of this.citationsByTitle) {
      if (normalizedText.includes(titleKey) || titleKey.includes(normalizedText)) {
        const confidence = this.calculateTitleSimilarity(normalizedText, titleKey)
        if (confidence > 0.7) {
          return {
            citation,
            confidence: confidence * 0.8, // Reduce confidence for title matches
            matchType: 'title',
            matchedText: citation.title
          }
        }
      }
    }

    return null
  }

  private findAllTitleMatches(text: string): CitationMatch[] {
    const normalizedText = this.normalizeTitle(text)
    const matches: CitationMatch[] = []
    
    for (const [titleKey, citation] of this.citationsByTitle) {
      if (normalizedText.includes(titleKey) || titleKey.includes(normalizedText)) {
        const confidence = this.calculateTitleSimilarity(normalizedText, titleKey)
        if (confidence > 0.7) {
          matches.push({
            citation,
            confidence: confidence * 0.8,
            matchType: 'title',
            matchedText: citation.title
          })
        }
      }
    }

    return matches
  }

  private findFuzzyMatch(text: string): CitationMatch | null {
    const normalizedText = this.normalizeTitle(text)
    let bestMatch: CitationMatch | null = null
    let bestSimilarity = 0

    for (const citation of this.allCitations) {
      const searchText = [
        citation.title,
        citation.authors.map(a => `${a.given} ${a.family}`).join(' '),
        citation.journal,
        citation.abstract?.substring(0, 200)
      ].filter(Boolean).join(' ')

      const normalizedSearchText = this.normalizeTitle(searchText)
      const similarity = this.calculateJaccardSimilarity(normalizedText, normalizedSearchText)

      if (similarity > bestSimilarity && similarity > 0.5) {
        bestSimilarity = similarity
        bestMatch = {
          citation,
          confidence: similarity * 0.6, // Lower confidence for fuzzy matches
          matchType: 'fuzzy',
          matchedText: text
        }
      }
    }

    return bestMatch
  }

  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private createAuthorYearKey(citation: Citation): string | null {
    const firstAuthor = citation.authors[0]
    if (!firstAuthor || !citation.year) return null

    const authorName = firstAuthor.family.toLowerCase()
    return `${authorName}_${citation.year}`
  }

  private calculateTitleSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(' ').filter(w => w.length > 2))
    const words2 = new Set(text2.split(' ').filter(w => w.length > 2))
    
    const intersection = new Set([...words1].filter(x => words2.has(x)))
    const union = new Set([...words1, ...words2])
    
    return intersection.size / union.size
  }

  private calculateJaccardSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(' ').filter(w => w.length > 2))
    const words2 = new Set(text2.split(' ').filter(w => w.length > 2))
    
    const intersection = new Set([...words1].filter(x => words2.has(x)))
    const union = new Set([...words1, ...words2])
    
    return union.size > 0 ? intersection.size / union.size : 0
  }

  private deduplicateMatches(matches: CitationMatch[]): CitationMatch[] {
    const seen = new Set<string>()
    const unique: CitationMatch[] = []

    for (const match of matches) {
      const key = match.citation.doi || match.citation.title
      if (!seen.has(key)) {
        seen.add(key)
        unique.push(match)
      } else {
        // If we've seen this citation before, keep the one with higher confidence
        const existingIndex = unique.findIndex(m => 
          (m.citation.doi && m.citation.doi === match.citation.doi) ||
          m.citation.title === match.citation.title
        )
        if (existingIndex >= 0 && match.confidence > unique[existingIndex].confidence) {
          unique[existingIndex] = match
        }
      }
    }

    return unique
  }

  // Update the citation database
  updateCitations(citations: Citation[]) {
    this.allCitations = citations
    this.citationsByDoi.clear()
    this.citationsByTitle.clear()
    this.citationsByAuthorYear.clear()
    this.buildIndexes(citations)
  }

  // Get citation statistics
  getStats() {
    return {
      totalCitations: this.allCitations.length,
      withDoi: this.citationsByDoi.size,
      indexedTitles: this.citationsByTitle.size,
      authorYearEntries: this.citationsByAuthorYear.size
    }
  }
} 