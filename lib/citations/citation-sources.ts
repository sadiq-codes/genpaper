// Citation Source Architecture - Pluggable adapters for different sources

export interface Citation {
  id?: string
  type: 'article' | 'book' | 'website' | 'conference' | 'thesis'
  title: string
  authors: Array<{ given: string; family: string; orcid?: string }>
  year?: number
  journal?: string
  volume?: string
  issue?: string
  pages?: string
  doi?: string
  url?: string
  abstract?: string
}

export interface CitationSource {
  name: string
  search(query: string, maxResults?: number): Promise<Citation[]>
  fetchByIdentifier(id: string, type: 'doi' | 'pmid' | 'arxiv'): Promise<Citation | null>
}

export class CrossRefAdapter implements CitationSource {
  name = 'CrossRef'
  
  async search(query: string, maxResults = 10): Promise<Citation[]> {
    try {
      const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${maxResults}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'GenPaper/1.0 (mailto:support@genpaper.ai)'
        }
      })
      
      if (!response.ok) return []
      
      const data = await response.json()
      const items = data.message?.items || []
      
      return items.map(this.transformCrossRefItem).filter(Boolean) as Citation[]
    } catch (error) {
      console.error('CrossRef search error:', error)
      return []
    }
  }
  
  async fetchByIdentifier(doi: string, type: 'doi'): Promise<Citation | null> {
    if (type !== 'doi') return null
    
    try {
      const url = `https://api.crossref.org/works/${doi}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'GenPaper/1.0 (mailto:support@genpaper.ai)'
        }
      })
      
      if (!response.ok) return null
      
      const data = await response.json()
      return this.transformCrossRefItem(data.message)
    } catch (error) {
      console.error('CrossRef DOI fetch error:', error)
      return null
    }
  }
  
  private transformCrossRefItem(item: any): Citation | null {
    if (!item || !item.title?.[0]) return null
    
    return {
      type: this.mapCrossRefType(item.type),
      title: item.title[0],
      authors: (item.author || []).map((author: any) => ({
        given: author.given || '',
        family: author.family || author.name || 'Unknown'
      })),
      year: item.published?.['date-parts']?.[0]?.[0],
      journal: item['container-title']?.[0],
      volume: item.volume,
      issue: item.issue,
      pages: item.page,
      doi: item.DOI,
      url: item.URL,
      abstract: item.abstract
    }
  }
  
  private mapCrossRefType(crossRefType: string): Citation['type'] {
    const typeMap: Record<string, Citation['type']> = {
      'journal-article': 'article',
      'book': 'book',
      'book-chapter': 'book',
      'proceedings-article': 'conference',
      'dissertation': 'thesis'
    }
    return typeMap[crossRefType] || 'article'
  }
}

export class ArxivAdapter implements CitationSource {
  name = 'arXiv'
  
  async search(query: string, maxResults = 10): Promise<Citation[]> {
    try {
      const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${maxResults}`
      const response = await fetch(url)
      
      if (!response.ok) return []
      
      const xmlText = await response.text()
      const parser = new DOMParser()
      const doc = parser.parseFromString(xmlText, 'text/xml')
      const entries = doc.getElementsByTagName('entry')
      
      const citations: Citation[] = []
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        const citation = this.transformArxivEntry(entry)
        if (citation) citations.push(citation)
      }
      
      return citations
    } catch (error) {
      console.error('arXiv search error:', error)
      return []
    }
  }
  
  async fetchByIdentifier(id: string, type: 'arxiv'): Promise<Citation | null> {
    if (type !== 'arxiv') return null
    
    try {
      const url = `https://export.arxiv.org/api/query?id_list=${id}`
      const response = await fetch(url)
      
      if (!response.ok) return null
      
      const xmlText = await response.text()
      const parser = new DOMParser()
      const doc = parser.parseFromString(xmlText, 'text/xml')
      const entry = doc.getElementsByTagName('entry')[0]
      
      return entry ? this.transformArxivEntry(entry) : null
    } catch (error) {
      console.error('arXiv ID fetch error:', error)
      return null
    }
  }
  
  private transformArxivEntry(entry: Element): Citation | null {
    const title = entry.getElementsByTagName('title')[0]?.textContent?.trim()
    if (!title) return null
    
    const authors = Array.from(entry.getElementsByTagName('author')).map(author => {
      const name = author.getElementsByTagName('name')[0]?.textContent || 'Unknown'
      const parts = name.split(' ')
      return {
        given: parts.slice(0, -1).join(' '),
        family: parts[parts.length - 1] || 'Unknown'
      }
    })
    
    const published = entry.getElementsByTagName('published')[0]?.textContent
    const year = published ? new Date(published).getFullYear() : undefined
    
    const id = entry.getElementsByTagName('id')[0]?.textContent
    const arxivId = id?.split('/').pop()?.split('v')[0]
    
    return {
      type: 'article' as const,
      title,
      authors,
      year,
      url: id,
      abstract: entry.getElementsByTagName('summary')[0]?.textContent?.trim(),
      // Store arXiv ID in a custom field
      ...(arxivId && { arxivId })
    }
  }
}

export class LocalLibraryAdapter implements CitationSource {
  name = 'Library'
  
  constructor(private citations: Citation[]) {}
  
  async search(query: string, maxResults = 10): Promise<Citation[]> {
    const normalizedQuery = query.toLowerCase()
    
    const matches = this.citations.filter(citation => {
      const searchFields = [
        citation.title,
        citation.authors.map(a => `${a.given} ${a.family}`).join(' '),
        citation.journal,
        citation.abstract
      ].filter(Boolean).join(' ').toLowerCase()
      
      return searchFields.includes(normalizedQuery)
    })
    
    return matches.slice(0, maxResults)
  }
  
  async fetchByIdentifier(id: string, type: 'doi' | 'pmid' | 'arxiv'): Promise<Citation | null> {
    return this.citations.find(citation => {
      switch (type) {
        case 'doi':
          return citation.doi === id
        case 'arxiv':
          return (citation as any).arxivId === id
        default:
          return citation.id === id
      }
    }) || null
  }
}

// Citation Source Registry
export class CitationSourceRegistry {
  private sources: Map<string, CitationSource> = new Map()
  
  register(source: CitationSource) {
    this.sources.set(source.name, source)
  }
  
  async searchAll(query: string, maxResults = 10): Promise<Array<{ source: string; citations: Citation[] }>> {
    const promises = Array.from(this.sources.entries()).map(async ([name, source]) => {
      try {
        const citations = await source.search(query, Math.ceil(maxResults / this.sources.size))
        return { source: name, citations }
      } catch (error) {
        console.error(`Error searching ${name}:`, error)
        return { source: name, citations: [] }
      }
    })
    
    return Promise.all(promises)
  }
  
  async fetchByIdentifier(id: string, type: 'doi' | 'pmid' | 'arxiv'): Promise<Citation | null> {
    for (const source of this.sources.values()) {
      try {
        const citation = await source.fetchByIdentifier(id, type)
        if (citation) return citation
      } catch (error) {
        console.error(`Error fetching from ${source.name}:`, error)
      }
    }
    return null
  }
  
  getSource(name: string): CitationSource | undefined {
    return this.sources.get(name)
  }
  
  getAllSources(): CitationSource[] {
    return Array.from(this.sources.values())
  }
} 