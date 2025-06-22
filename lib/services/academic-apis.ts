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
  source: PaperSource
}

export interface SearchOptions {
  limit?: number
  fromYear?: number
  toYear?: number
  openAccessOnly?: boolean
  fastMode?: boolean
  desired?: number // Target number of results to collect before stopping
}

// Import shared hash utility
import { collisionResistantHash } from '@/lib/utils/hash'
import { PaperSource } from '@/types/simplified'
import { XMLParser } from 'fast-xml-parser'
import pLimit from 'p-limit'

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

interface OpenAlexResponse {
  results: OpenAlexWork[]
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

interface CrossrefResponse {
  message?: {
    items: CrossrefItem[]
  }
}

interface SemanticScholarPaper {
  title: string
  year?: number
  abstract?: string
  venue?: string
  doi?: string
  url?: string
  citationCount?: number
  authors?: Array<{ name: string }>
}

interface SemanticScholarResponse {
  data: SemanticScholarPaper[]
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

interface CoreResponse {
  results: CoreWork[]
}

interface ArxivAuthor {
  name: string
}

interface ArxivLink {
  '@_type': string
  '@_href': string
}

interface ArxivEntry {
  title: string
  summary: string
  published: string
  id: string
  author: ArxivAuthor | ArxivAuthor[]
  link: ArxivLink | ArxivLink[]
}

// Centralized HTTP helper with timeout and rate limit handling
async function fetchJSON<T>(
  url: string,
  opts: RequestInit & { timeout?: number; fastMode?: boolean } = {},
): Promise<T> {
  const { timeout = 12_000, fastMode, ...rest } = opts
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), fastMode ? 8_000 : timeout)
  
  try {
    const response = await fetch(url, { ...rest, signal: controller.signal })
    
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') ?? 0) * 1_000 || (fastMode ? 1_000 : 5_000)
      throw new Error(`429-${retryAfter}`)
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    return await response.json() as T
  } finally {
    clearTimeout(timeoutId)
  }
}

// Rate limit handling for retry logic
interface RetryOptions {
  retries: number
  factor: number
  minTimeout: number
  maxTimeout: number
  fastMode?: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = { retries: 3, factor: 2, minTimeout: 1000, maxTimeout: 10000, fastMode: false }
): Promise<T> {
  const { retries, factor, minTimeout, maxTimeout, fastMode = false } = options
  
  const actualRetries = retries
  const actualMinTimeout = fastMode ? 200 : minTimeout
  const actualMaxTimeout = fastMode ? 2000 : maxTimeout
  
  let lastError: Error
  
  for (let attempt = 0; attempt <= actualRetries; attempt++) {
    try {
      if (attempt > 0) {
        const timeout = Math.min(actualMinTimeout * Math.pow(factor, attempt - 1), actualMaxTimeout)
        console.log(`Retry attempt ${attempt}/${actualRetries} after ${timeout}ms`)
        await sleep(timeout)
      }
      
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      // Handle rate limit errors with encoded wait time
      if (error instanceof Error && error.message.startsWith('429-')) {
        const waitTime = parseInt(error.message.split('-')[1]) || (fastMode ? 1000 : 5000)
        console.warn(`Rate limit hit, attempt ${attempt + 1}/${actualRetries + 1}`)
        
        if (attempt < actualRetries) {
          await sleep(waitTime)
        }
        continue
      }
      
      // Don't retry client errors
      if (error instanceof Error && (
        error.message.includes('400') || 
        error.message.includes('401') || 
        error.message.includes('403')
      )) {
        throw error
      }
      
      if (attempt === actualRetries) {
        throw lastError
      }
    }
  }
  
  throw lastError!
}

// Improved date formatting
function formatDateForAPI(year: number, month = 1, day = 1): string {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toISOString().split('T')[0]
}

// Helper function to create canonical ID for deduplication
function createCanonicalId(title: string, year?: number, doi?: string, source?: string): string {
  let input: string
  
  if (doi) {
    input = doi
      .toLowerCase()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
      .trim()
  } else {
    const normalizedTitle = title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    input = `${normalizedTitle}${year || ''}${source || ''}`
  }
  
  return collisionResistantHash(input)
}

// Deduplication helper
function deduplicate(papers: AcademicPaper[]): AcademicPaper[] {
  const seen = new Set<string>()
  const deduped: AcademicPaper[] = []
  
  for (const paper of papers) {
    if (!seen.has(paper.canonical_id)) {
      seen.add(paper.canonical_id)
      deduped.push(paper)
    }
  }
  
  return deduped
}

// Helper function to de-invert OpenAlex abstract
function deInvertAbstract(invertedIndex: Record<string, number[]>): string {
  const words: Array<{word: string, positions: number[]}> = []
  
  for (const [word, positions] of Object.entries(invertedIndex)) {
    words.push({ word, positions })
  }
  
  words.sort((a, b) => Math.min(...a.positions) - Math.min(...b.positions))
  
  // Pre-size array to avoid memory issues
  const maxPos = Math.max(...words.flatMap(w => w.positions))
  const result = new Array<string>(maxPos + 1).fill('')
  
  for (const {word, positions} of words) {
    for (const pos of positions.sort((a, b) => a - b)) {
      result[pos] = word
    }
  }
  
  return result.join(' ').replace(/\s+/g, ' ').trim()
}

// OpenAlex API integration
export async function searchOpenAlex(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear, openAccessOnly, fastMode = false } = options
  
  return retryWithBackoff(async () => {
    let url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}&mailto=${process.env.CONTACT_EMAIL || 'research@example.com'}`
    
    const filters: string[] = []
    
    if (fromYear) {
      filters.push(`from_publication_date:${formatDateForAPI(fromYear)}`)
    }
    
    if (toYear) {
      filters.push(`to_publication_date:${formatDateForAPI(toYear, 12, 31)}`)
    }
    
    // Make article type configurable - include more publication types for better coverage
    filters.push('type:journal-article,type:preprint,type:proceedings-article')
    
    if (openAccessOnly) {
      filters.push('is_oa:true')
    }
    
    if (filters.length > 0) {
      url += `&filter=${filters.join(',')}`
    }
    
    url += '&sort=cited_by_count:desc'
    
    const data = await fetchJSON<OpenAlexResponse>(url, {
      fastMode,
      headers: {
        'User-Agent': `GenPaper/1.0 (mailto:${process.env.CONTACT_EMAIL || 'research@example.com'})`,
        'X-ABS-APP-ID': 'genpaper-dev'
      }
    })
    
    return data.results?.map((work: OpenAlexWork) => ({
      canonical_id: createCanonicalId(work.display_name, work.publication_year, work.doi, 'openalex'),
      title: work.display_name,
      abstract: work.abstract_inverted_index ? deInvertAbstract(work.abstract_inverted_index) : '',
      year: work.publication_year || 0,
      venue: work.primary_location?.source?.display_name,
      doi: work.doi,
      url: work.primary_location?.landing_page_url,
      citationCount: work.cited_by_count || 0,
      authors: work.authorships?.map((a) => a.author?.display_name).filter((name): name is string => Boolean(name)) || [],
      source: 'openalex' as const
    })) || []
  }, { retries: 1, factor: 2, minTimeout: 200, maxTimeout: 2000, fastMode })
}

// Crossref API integration
export async function searchCrossref(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear, openAccessOnly, fastMode = false } = options
  
  return retryWithBackoff(async () => {
    let url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${limit}&sort=score&order=desc`
    
    if (fromYear || toYear) {
      const from = fromYear ? formatDateForAPI(fromYear) : '1000-01-01'
      const to = toYear ? formatDateForAPI(toYear, 12, 31) : '3000-12-31'
      url += `&filter=from-pub-date:${from},until-pub-date:${to}`
    }
    
    if (openAccessOnly) {
      url += '&filter=has-full-text:true'
    }
    
    const data = await fetchJSON<CrossrefResponse>(url, {
      fastMode,
      headers: {
        'User-Agent': `GenPaper/1.0 (mailto:${process.env.CONTACT_EMAIL || 'research@example.com'})`
      }
    })
    
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
  }, { retries: 1, factor: 2, minTimeout: 200, maxTimeout: 2000, fastMode })
}

// Semantic Scholar API integration with API key guard
export async function searchSemanticScholar(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  // Guard against missing API key
  if (!process.env.SEMANTIC_API_KEY) {
    console.warn('SEMANTIC_API_KEY not set – skipping Semantic Scholar')
    return []
  }
  
  const { limit = 50, fromYear, toYear, openAccessOnly, fastMode = false } = options
  
  return retryWithBackoff(async () => {
    let url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=paperId,title,abstract,year,venue,doi,url,citationCount,authors`
    
    if (fromYear) {
      url += `&year=${fromYear}-`
    }
    if (toYear) {
      url += `${toYear || ''}`
    }
    
    if (openAccessOnly) {
      url += '&openAccessPdf'
    }
    
    const data = await fetchJSON<SemanticScholarResponse>(url, {
      fastMode,
      headers: {
        'x-api-key': process.env.SEMANTIC_API_KEY!
      }
    })
    
    return data.data?.map((paper: SemanticScholarPaper) => ({
      canonical_id: createCanonicalId(paper.title, paper.year, paper.doi, 'semanticscholar'),
      title: paper.title,
      abstract: paper.abstract || '',
      year: paper.year || 0,
      venue: paper.venue,
      doi: paper.doi,
      url: paper.url,
      citationCount: paper.citationCount || 0,
      authors: paper.authors?.map(a => a.name) || [],
      source: 'semantic_scholar' as const
    })) || []
  }, { retries: 1, factor: 2, minTimeout: 300, maxTimeout: 3000, fastMode })
}

// arXiv API integration with proper XML parsing
export async function searchArxiv(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear, fastMode = false } = options
  
  return retryWithBackoff(async () => {
    let searchQuery = `all:"${query}"`
    
    if (fromYear || toYear) {
      const from = fromYear || 1991
      const to = toYear || new Date().getFullYear()
      searchQuery += ` AND submittedDate:[${from} TO ${to}]`
    }
    
    const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}&start=0&max_results=${limit}&searchtype=all&sortBy=relevance&sortOrder=descending`
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), fastMode ? 8_000 : 12_000)
    
    try {
      const response = await fetch(url, { signal: controller.signal })
      
      if (!response.ok) {
        throw new Error(`arXiv API error: ${response.status} ${response.statusText}`)
      }
      
      const xmlText = await response.text()
      
      // Use fast-xml-parser instead of regex
      const parser = new XMLParser({ ignoreAttributes: false })
      const parsed = parser.parse(xmlText)
      
      const entries = Array.isArray(parsed.feed?.entry) ? parsed.feed.entry : 
                     parsed.feed?.entry ? [parsed.feed.entry] : []
      
             return entries.map((entry: ArxivEntry): AcademicPaper => {
         const title = entry.title?.replace(/\s+/g, ' ').trim() || ''
         const abstract = entry.summary?.replace(/\s+/g, ' ').trim() || ''
         
         let year = 0
         if (entry.published) {
           const publishedDate = new Date(entry.published)
           year = isNaN(publishedDate.getTime()) ? 0 : publishedDate.getFullYear()
         }
         
         const authors = Array.isArray(entry.author) ? 
           entry.author.map((a) => a.name || '') :
           entry.author?.name ? [entry.author.name] : []
         
         // Extract PDF URL from links
         const links = Array.isArray(entry.link) ? entry.link : [entry.link].filter(Boolean)
         const pdfLink = links.find((l) => l['@_type'] === 'application/pdf')
        
        return {
          canonical_id: createCanonicalId(title, year, undefined, 'arxiv'),
          title,
          abstract,
          year,
          venue: 'arXiv',
          url: entry.id || '',
          pdf_url: pdfLink?.['@_href'],
          citationCount: 0,
          authors: authors.filter(Boolean),
          source: 'arxiv' as const
        }
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }, { retries: 1, factor: 2, minTimeout: 300, maxTimeout: 3000, fastMode })
}

// CORE API integration with API key guard
export async function searchCore(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  // Guard against missing API key
  if (!process.env.CORE_API_KEY) {
    console.warn('CORE_API_KEY not set – skipping CORE')
    return []
  }
  
  const { limit = 50, fromYear, toYear, fastMode = false } = options
  
  return retryWithBackoff(async () => {
    let searchQuery = `title:"${query}" OR abstract:"${query}"`
    
    if (fromYear || toYear) {
      const from = fromYear || 1900
      const to = toYear || new Date().getFullYear()
      searchQuery += ` AND year:[${from} TO ${to}]`
    }
    
    const url = `https://api.core.ac.uk/v3/search/works`
    
    const data = await fetchJSON<CoreResponse>(url, {
      method: 'POST',
      fastMode,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CORE_API_KEY}`
      },
      body: JSON.stringify({
        q: searchQuery,
        limit,
        offset: 0
      })
    })
    
    return data.results?.map((work: CoreWork) => ({
      canonical_id: createCanonicalId(work.title, work.yearPublished, work.doi, 'core'),
      title: work.title,
      abstract: work.abstract || '',
      year: work.yearPublished || 0,
      venue: work.publisher,
      doi: work.doi,
      url: work.downloadUrl,
      pdf_url: work.downloadUrl,
      citationCount: 0,
      authors: work.authors?.map((a) => a.name).filter(Boolean) || [],
      source: 'core' as const
    })) || []
  }, { retries: 1, factor: 2, minTimeout: 200, maxTimeout: 2000, fastMode })
}

// Unpaywall integration for PDF access
export async function getOpenAccessPdf(doi: string): Promise<string | null> {
  if (!doi) return null
  
  return retryWithBackoff(async () => {
    const url = `https://api.unpaywall.org/v2/${doi}?email=${process.env.CONTACT_EMAIL || 'research@example.com'}`
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8_000)
    
    try {
      const response = await fetch(url, { signal: controller.signal })
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json()
      
      if (data.is_oa && data.best_oa_location?.url_for_pdf) {
        return data.best_oa_location.url_for_pdf
      }
      
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  }).catch(error => {
    console.error('Unpaywall error:', error)
    return null
  })
}

// Expand keywords for better search coverage
export function expandKeywords(query: string): string[] {
  const baseQuery = query.trim().toLowerCase()
  const expanded = [baseQuery]
  
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

// Main orchestrator function that stops when enough papers are collected
export async function searchAllSources(
  query: string,
  options: SearchOptions = {}
): Promise<AcademicPaper[]> {
  const { desired = 60, fastMode = false } = options
  const limit = pLimit(fastMode ? 3 : 2) // Concurrency control
  
  const searchFunctions = [
    () => searchOpenAlex(query, { ...options, limit: Math.ceil(desired / 3) }),
    () => searchCrossref(query, { ...options, limit: Math.ceil(desired / 3) }),
    () => searchSemanticScholar(query, { ...options, limit: Math.ceil(desired / 3) }),
    () => searchArxiv(query, { ...options, limit: Math.ceil(desired / 4) }),
    () => searchCore(query, { ...options, limit: Math.ceil(desired / 4) }),
  ]
  
  // Run searches with concurrency control
  const results = await Promise.allSettled(
    searchFunctions.map(fn => limit(fn))
  )
  
  // Collect successful results
  const allPapers: AcademicPaper[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allPapers.push(...result.value)
    } else {
      console.warn('Search source failed:', result.reason)
    }
  }
  
  // Deduplicate and limit results
  const deduped = deduplicate(allPapers)
  
  // Sort by citation count and recency
  const sorted = deduped.sort((a, b) => {
    const citationDiff = b.citationCount - a.citationCount
    if (citationDiff !== 0) return citationDiff
    return b.year - a.year
  })
  
  return sorted.slice(0, desired)
}

// Reference fetching interfaces and functions
export interface PaperReference {
  title?: string
  authors?: string[]
  year?: number
  doi?: string
  source?: 'crossref' | 'semanticscholar'
  raw?: unknown
}

interface CrossrefReference {
  'article-title'?: string
  'journal-title'?: string
  unstructured?: string
  author?: string
  year?: string
  DOI?: string
}

interface CrossrefWorkResponse {
  message?: {
    reference?: CrossrefReference[]
  }
}

interface SemanticScholarReferenceResponse {
  references?: Array<{
    title?: string
    year?: number
    authors?: Array<{ name: string }>
    externalIds?: { DOI?: string }
  }>
}

export async function fetchCrossrefReferences(doi: string): Promise<PaperReference[]> {
  try {
    const data = await fetchJSON<CrossrefWorkResponse>(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)
    const refs: PaperReference[] = (data?.message?.reference || []).map((r: CrossrefReference) => ({
      title: r['article-title'] || r['journal-title'] || r['unstructured'],
      authors: r.author ? [r.author] : undefined,
      year: r.year ? parseInt(r.year) : undefined,
      doi: r.DOI || undefined,
      source: 'crossref' as const,
      raw: r
    }))
    return refs
  } catch (e) {
    console.warn('Crossref reference fetch failed', e)
    return []
  }
}

export async function fetchSemanticScholarReferences(paperIdOrDoi: string): Promise<PaperReference[]> {
  try {
    const data = await fetchJSON<SemanticScholarReferenceResponse>(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperIdOrDoi)}?fields=references.title,references.year,references.authors,references.externalIds`)
    const refsRaw = data?.references || []
    const refs: PaperReference[] = refsRaw.map((r) => ({
      title: r.title,
      authors: (r.authors || []).map((a) => a.name),
      year: r.year,
      doi: r.externalIds?.DOI,
      source: 'semanticscholar' as const,
      raw: r
    }))
    return refs
  } catch (e) {
    console.warn('Semantic Scholar reference fetch failed', e)
    return []
  }
}

export async function getPaperReferences(doi?: string, fallbackId?: string): Promise<PaperReference[]> {
  let refs: PaperReference[] = []
  if (doi) {
    refs = await fetchCrossrefReferences(doi)
  }
  if (refs.length === 0 && fallbackId) {
    refs = await fetchSemanticScholarReferences(fallbackId)
  }
  return refs
} 