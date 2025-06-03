import * as crypto from 'crypto'

// Types for academic paper search results
export interface AcademicPaper {
  canonical_id: string
  title: string
  abstract: string
  year: number
  venue?: string
  doi?: string
  url?: string
  pdf_url?: string
  citationCount: number
  authors?: string[]
  source: 'openalex' | 'crossref' | 'semantic_scholar' | 'arxiv' | 'core'
}

export interface SearchOptions {
  limit?: number
  fromYear?: number
  toYear?: number
  openAccessOnly?: boolean
}

// API Response interfaces for better typing
interface OpenAlexWork {
  display_name: string
  publication_year?: number
  doi?: string
  abstract_inverted_index?: Record<string, number[]>
  primary_location?: {
    source?: { display_name: string }
    landing_page_url?: string
  }
  cited_by_count?: number
  authorships?: Array<{
    author?: { display_name: string }
  }>
}

interface CrossrefItem {
  title: string | string[]
  published?: { 'date-parts': Array<Array<number>> }
  DOI?: string
  abstract?: string
  'container-title'?: string[]
  URL?: string
  'is-referenced-by-count'?: number
  author?: Array<{
    given?: string
    family?: string
  }>
}

interface SemanticScholarPaper {
  title: string
  year?: number
  abstract?: string
  venue?: string
  url?: string
  citationCount?: number
  authors?: Array<{ name: string }>
}

interface CoreWork {
  title: string
  yearPublished?: number
  doi?: string
  abstract?: string
  publisher?: string
  downloadUrl?: string
  authors?: Array<{ name: string }>
}

// Fix: Add rate limiting and retry utilities
interface RetryOptions {
  retries: number
  factor: number
  minTimeout: number
  maxTimeout: number
}

// Helper function to sleep/delay execution
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Fix: Exponential backoff retry wrapper
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = { retries: 3, factor: 2, minTimeout: 1000, maxTimeout: 10000 }
): Promise<T> {
  const { retries, factor, minTimeout, maxTimeout } = options
  let lastError: Error
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Add small delay between requests to be respectful
      if (attempt > 0) {
        const timeout = Math.min(minTimeout * Math.pow(factor, attempt - 1), maxTimeout)
        console.log(`Retry attempt ${attempt}/${retries} after ${timeout}ms`)
        await sleep(timeout)
      }
      
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      // Check if it's a rate limit error
      if (error instanceof Error && error.message.includes('429')) {
        console.warn(`Rate limit hit, attempt ${attempt + 1}/${retries + 1}`)
        // Add extra delay for rate limit errors
        if (attempt < retries) {
          await sleep(Math.min(5000 * Math.pow(2, attempt), 30000))
        }
        continue
      }
      
      // For non-rate-limit errors, don't retry certain types
      if (error instanceof Error && (
        error.message.includes('400') || 
        error.message.includes('401') || 
        error.message.includes('403')
      )) {
        throw error // Don't retry client errors
      }
      
      if (attempt === retries) {
        throw lastError
      }
    }
  }
  
  throw lastError!
}

// Fix: Improved date formatting to avoid locale issues
function formatDateForAPI(year: number, month = 1, day = 1): string {
  // Use ISO format to avoid locale-dependent parsing
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toISOString().split('T')[0] // Returns YYYY-MM-DD
}

// Helper function to create canonical ID for deduplication
function createCanonicalId(title: string, year?: number, doi?: string, source?: string): string {
  if (doi) {
    return doi.toLowerCase().trim()
  }
  
  const normalizedTitle = title.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  
  // Fix: Include source in hash to prevent collisions across different APIs
  const input = `${normalizedTitle}${year || ''}${source || ''}`
  return crypto.createHash('md5').update(input).digest('hex')
}

// Helper function to de-invert OpenAlex abstract
function deInvertAbstract(invertedIndex: Record<string, number[]>): string {
  const words: Array<{word: string, positions: number[]}> = []
  
  for (const [word, positions] of Object.entries(invertedIndex)) {
    words.push({ word, positions })
  }
  
  // Sort by first position to reconstruct order
  words.sort((a, b) => Math.min(...a.positions) - Math.min(...b.positions))
  
  const result: string[] = []
  let currentPosition = 0
  
  for (const {word, positions} of words) {
    for (const pos of positions.sort((a, b) => a - b)) {
      // Fill gaps with spaces if needed
      while (result.length < pos) {
        result.push('')
      }
      result[pos] = word
      currentPosition = Math.max(currentPosition, pos + 1)
    }
  }
  
  return result.join(' ').replace(/\s+/g, ' ').trim()
}

// OpenAlex API integration with retry logic
export async function searchOpenAlex(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear, openAccessOnly } = options
  
  return retryWithBackoff(async () => {
    let url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}&mailto=${process.env.CONTACT_EMAIL || 'research@example.com'}`
    
    const filters: string[] = []
    
    if (fromYear) {
      filters.push(`from_publication_date:${formatDateForAPI(fromYear)}`)
    }
    
    if (toYear) {
      filters.push(`to_publication_date:${formatDateForAPI(toYear, 12, 31)}`)
    }
    
    filters.push('type:journal-article')
    
    if (openAccessOnly) {
      filters.push('is_oa:true')
    }
    
    if (filters.length > 0) {
      url += `&filter=${filters.join(',')}`
    }
    
    url += '&sort=cited_by_count:desc'
    
    // Add rate limiting delay
    await sleep(100)
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': `GenPaper/1.0 (mailto:${process.env.CONTACT_EMAIL || 'research@example.com'})`
      }
    })
    
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000
      throw new Error(`429 Rate limit exceeded. Retry after ${waitTime}ms`)
    }
    
    if (!response.ok) {
      throw new Error(`OpenAlex API error: ${response.status} ${response.statusText}`)
    }
    
    const data = await response.json()
    
    return data.results?.map((work: OpenAlexWork) => ({
      canonical_id: createCanonicalId(work.display_name, work.publication_year, work.doi, 'openalex'),
      title: work.display_name,
      abstract: work.abstract_inverted_index ? deInvertAbstract(work.abstract_inverted_index) : '',
      year: work.publication_year || 0,
      venue: work.primary_location?.source?.display_name,
      doi: work.doi,
      url: work.primary_location?.landing_page_url,
      citationCount: work.cited_by_count || 0,
      authors: work.authorships?.map((a) => a.author?.display_name).filter(Boolean) || [],
      source: 'openalex' as const
    })) || []
  })
}

// Fix: Crossref API integration with proper has-full-text handling
export async function searchCrossref(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear, openAccessOnly } = options
  
  return retryWithBackoff(async () => {
    let url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${limit}&sort=score&order=desc`
    
    if (fromYear || toYear) {
      const from = fromYear ? formatDateForAPI(fromYear) : '1000-01-01'
      const to = toYear ? formatDateForAPI(toYear, 12, 31) : '3000-12-31'
      url += `&filter=from-pub-date:${from},until-pub-date:${to}`
    }
    
    // Fix: Make has-full-text filter conditional based on openAccessOnly option
    if (openAccessOnly) {
      url += '&filter=has-full-text:true'
    }
    // Note: Removed the always-applied has-full-text filter as it removes many valid papers with DOIs
    
    // Add rate limiting delay
    await sleep(100)
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': `GenPaper/1.0 (mailto:${process.env.CONTACT_EMAIL || 'research@example.com'})`
      }
    })
    
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000
      throw new Error(`429 Rate limit exceeded. Retry after ${waitTime}ms`)
    }
    
    if (!response.ok) {
      throw new Error(`Crossref API error: ${response.status} ${response.statusText}`)
    }
    
    const data = await response.json()
    
    return data.message?.items?.map((item: CrossrefItem) => {
      const title = Array.isArray(item.title) ? item.title[0] : item.title || ''
      const year = item.published?.['date-parts']?.[0]?.[0] || 0
      const doi = item.DOI
      
      return {
        canonical_id: createCanonicalId(title, year, doi, 'crossref'),
        title,
        abstract: item.abstract || '',
        year,
        venue: item['container-title']?.[0] || '',
        doi,
        url: item.URL,
        citationCount: item['is-referenced-by-count'] || 0,
        authors: item.author?.map((a) => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean) || [],
        source: 'crossref' as const
      }
    }) || []
  })
}

// Fix: Semantic Scholar API integration with correct year parameter format
export async function searchSemanticScholar(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear } = options
  
  return retryWithBackoff(async () => {
    let url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=paperId,title,abstract,year,venue,citationCount,isOpenAccess,url,authors`
    
    // Fix: Use proper year parameter format according to Semantic Scholar API docs
    if (fromYear && toYear) {
      url += `&year=${fromYear}-${toYear}`
    } else if (fromYear) {
      url += `&year=${fromYear}-`
    } else if (toYear) {
      // Fix: Changed from &year=-YYYY to &year=1900-YYYY format
      url += `&year=1900-${toYear}`
    }
    
    // Add rate limiting delay
    await sleep(100)
    
    const headers: Record<string, string> = {}
    
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
      headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY
    }
    
    const response = await fetch(url, { headers })
    
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000
      throw new Error(`429 Rate limit exceeded. Retry after ${waitTime}ms`)
    }
    
    if (!response.ok) {
      throw new Error(`Semantic Scholar API error: ${response.status} ${response.statusText}`)
    }
    
    const data = await response.json()
    
    return data.data?.map((paper: SemanticScholarPaper) => ({
      canonical_id: createCanonicalId(paper.title, paper.year, undefined, 'semantic_scholar'),
      title: paper.title,
      abstract: paper.abstract || '',
      year: paper.year || 0,
      venue: paper.venue,
      url: paper.url,
      citationCount: paper.citationCount || 0,
      authors: paper.authors?.map((a) => a.name).filter(Boolean) || [],
      source: 'semantic_scholar' as const
    })) || []
  })
}

// Fix: arXiv API integration with correct search parameters
export async function searchArxiv(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear } = options
  
  return retryWithBackoff(async () => {
    let searchQuery = `all:"${query}"`
    
    if (fromYear || toYear) {
      const from = fromYear || 1991
      const to = toYear || new Date().getFullYear()
      searchQuery += ` AND submittedDate:[${from} TO ${to}]`
    }
    
    // Fix: Add searchtype=all parameter and proper sorting as per arXiv API docs
    const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}&start=0&max_results=${limit}&searchtype=all&sortBy=relevance&sortOrder=descending`
    
    // Add rate limiting delay (arXiv recommends 30s, but we'll use shorter with retry)
    await sleep(200)
    
    const response = await fetch(url)
    
    if (response.status === 429) {
      throw new Error(`429 Rate limit exceeded. arXiv recommends longer delays`)
    }
    
    if (!response.ok) {
      throw new Error(`arXiv API error: ${response.status} ${response.statusText}`)
    }
    
    const xmlText = await response.text()
    
    // Basic XML parsing for arXiv results
    const entries = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || []
    
    return entries.map(entry => {
      const titleMatch = entry.match(/<title>(.*?)<\/title>/)
      const summaryMatch = entry.match(/<summary>(.*?)<\/summary>/)
      const publishedMatch = entry.match(/<published>(.*?)<\/published>/)
      const idMatch = entry.match(/<id>(.*?)<\/id>/)
      const authorsMatches = entry.match(/<name>(.*?)<\/name>/g) || []
      
      const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim() || ''
      const abstract = summaryMatch?.[1]?.replace(/\s+/g, ' ').trim() || ''
      
      // Fix: Use proper date parsing to avoid locale issues
      let year = 0
      if (publishedMatch?.[1]) {
        const publishedDate = new Date(publishedMatch[1])
        year = isNaN(publishedDate.getTime()) ? 0 : publishedDate.getFullYear()
      }
      
      const url = idMatch?.[1] || ''
      const authors = authorsMatches.map(match => match.replace(/<name>(.*?)<\/name>/, '$1'))
      
      return {
        canonical_id: createCanonicalId(title, year, undefined, 'arxiv'),
        title,
        abstract,
        year,
        venue: 'arXiv',
        url,
        citationCount: 0, // arXiv doesn't provide citation counts
        authors,
        source: 'arxiv' as const
      }
    })
  })
}

// CORE API integration with retry logic
export async function searchCore(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear } = options
  
  return retryWithBackoff(async () => {
    let searchQuery = `title:"${query}" OR abstract:"${query}"`
    
    if (fromYear || toYear) {
      const from = fromYear || 1900
      const to = toYear || new Date().getFullYear()
      searchQuery += ` AND year:[${from} TO ${to}]`
    }
    
    const url = `https://api.core.ac.uk/v3/search/works`
    
    // Add rate limiting delay
    await sleep(100)
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CORE_API_KEY || ''}`
      },
      body: JSON.stringify({
        q: searchQuery,
        limit,
        offset: 0
      })
    })
    
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000
      throw new Error(`429 Rate limit exceeded. Retry after ${waitTime}ms`)
    }
    
    if (!response.ok) {
      throw new Error(`CORE API error: ${response.status} ${response.statusText}`)
    }
    
    const data = await response.json()
    
    return data.results?.map((work: CoreWork) => ({
      canonical_id: createCanonicalId(work.title, work.yearPublished, work.doi, 'core'),
      title: work.title,
      abstract: work.abstract || '',
      year: work.yearPublished || 0,
      venue: work.publisher,
      doi: work.doi,
      url: work.downloadUrl,
      pdf_url: work.downloadUrl,
      citationCount: 0, // CORE doesn't provide citation counts
      authors: work.authors?.map((a) => a.name).filter(Boolean) || [],
      source: 'core' as const
    })) || []
  })
}

// Unpaywall integration for PDF access with retry logic
export async function getOpenAccessPdf(doi: string): Promise<string | null> {
  if (!doi) return null
  
  return retryWithBackoff(async () => {
    const url = `https://api.unpaywall.org/v2/${doi}?email=${process.env.CONTACT_EMAIL || 'research@example.com'}`
    
    // Add rate limiting delay
    await sleep(100)
    
    const response = await fetch(url)
    
    if (response.status === 429) {
      throw new Error(`429 Rate limit exceeded`)
    }
    
    if (!response.ok) {
      return null // Don't throw for Unpaywall failures, just return null
    }
    
    const data = await response.json()
    
    if (data.is_oa && data.best_oa_location?.url_for_pdf) {
      return data.best_oa_location.url_for_pdf
    }
    
    return null
  }).catch(error => {
    console.error('Unpaywall error:', error)
    return null // Graceful failure for PDF lookup
  })
}

// Expand keywords for better search coverage
export function expandKeywords(query: string): string[] {
  const baseQuery = query.trim().toLowerCase()
  const expanded = [baseQuery]
  
  // Add common synonyms and variations
  const synonymMap: Record<string, string[]> = {
    'machine learning': ['ML', 'artificial intelligence', 'AI', 'deep learning'],
    'artificial intelligence': ['AI', 'machine learning', 'ML', 'deep learning'],
    'deep learning': ['neural networks', 'machine learning', 'AI'],
    'natural language processing': ['NLP', 'text processing', 'language models'],
    'computer vision': ['image processing', 'visual recognition', 'image analysis'],
    'climate change': ['global warming', 'environmental change', 'climate science'],
    'quantum computing': ['quantum information', 'quantum mechanics', 'quantum algorithms']
  }
  
  for (const [key, synonyms] of Object.entries(synonymMap)) {
    if (baseQuery.includes(key)) {
      expanded.push(...synonyms.map(s => baseQuery.replace(key, s)))
    }
  }
  
  return Array.from(new Set(expanded))
} 