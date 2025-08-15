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
  includeOtherTypes?: boolean // Include books, datasets, etc.
}

// Import shared hash utility
import { PaperSource } from '@/types/simplified'
import { XMLParser } from 'fast-xml-parser'
import pLimit from 'p-limit'
import { formatDateForAPI, createCanonicalId, deduplicate } from '@/lib/utils/paper-id'
import { openalexAdapter } from '@/lib/services/adapters/openalex'
import { crossrefAdapter } from '@/lib/services/adapters/crossref'
import { semanticScholarAdapter } from '@/lib/services/adapters/semantic_scholar'
import { arxivAdapter } from '@/lib/services/adapters/arxiv'
import { coreAdapter } from '@/lib/services/adapters/core'
import { googleScholarAdapter } from '@/lib/services/adapters/google_scholar'

// OpenAlex publication types - using correct names per API docs
// Note: OpenAlex uses different type names than Crossref
const PUBLICATION_TYPES = [
  'article',      // journal articles, conference papers
  'preprint',     // preprints and working papers
] as const;

const OTHER_PUBLICATION_TYPES = [
  'book',
  'book-chapter', 
  'dissertation',
  'dataset',
  'editorial',
  'erratum',
  'letter',
  'review'
] as const;

// Contact email validation
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || process.env.EMAIL;
if (!CONTACT_EMAIL) {
  console.warn('⚠️ CONTACT_EMAIL not set - OpenAlex searches may fail. Set CONTACT_EMAIL or EMAIL environment variable.');
}

// PDF URL Detection Utilities
function isDirectPdfUrl(url: string): boolean {
  if (!url) return false
  
  // Direct PDF patterns
  const pdfPatterns = [
    /\.pdf$/i,
    /arxiv\.org\/pdf\//i,
    /biorxiv\.org\/content\/.*\.full\.pdf/i,
    /medrxiv\.org\/content\/.*\.full\.pdf/i,
    /researchgate\.net\/.*\.pdf/i,
    /academia\.edu\/.*\.pdf/i,
    /core\.ac\.uk\/download\/pdf/i,
    /europepmc\.org\/.*\.pdf/i,
    /ncbi\.nlm\.nih\.gov\/pmc\/articles\/.*\/pdf/i,
    /pubmed\.ncbi\.nlm\.nih\.gov\/.*\.pdf/i,
    /pmc\.ncbi\.nlm\.nih\.gov\/.*\.pdf/i
  ]
  
  return pdfPatterns.some(pattern => pattern.test(url))
}

export function isPaywalledUrl(url: string): boolean {
  if (!url) return false
  
  // Known open access publishers/platforms (exclude from paywall detection)
  const openAccessPatterns = [
    /plos\.org/i,
    /elifesciences\.org/i,
    /peerj\.com/i,
    /frontiersin\.org/i,
    /mdpi\.com/i,
    /hindawi\.com/i,
    /biomedcentral\.com/i,
    /springeropen\.com/i,
    /nature\.com\/articles\/s41598/i, // Scientific Reports
    /journals\.plos\.org/i,
    /doaj\.org/i,
    /arxiv\.org/i,
    /biorxiv\.org/i,
    /medrxiv\.org/i,
    /ncbi\.nlm\.nih\.gov\/pmc/i
  ]
  
  // If it's a known OA publisher, not paywalled
  if (openAccessPatterns.some(pattern => pattern.test(url))) {
    return false
  }
  
  // Known paywall patterns
  const paywallPatterns = [
    /doi\.org/i,
    /dx\.doi\.org/i,
    /link\.springer\.com/i,
    /sciencedirect\.com/i,
    /wiley\.com/i,
    /nature\.com/i,
    /tandfonline\.com/i,
    /jstor\.org/i,
    /ieee\.org/i,
    /acm\.org/i,
    /sage\.com/i
  ]
  
  return paywallPatterns.some(pattern => pattern.test(url))
}

// Google Scholar Search Interface
interface GoogleScholarResult {
  title: string
  authors: string[]
  venue?: string
  year?: number
  citationCount?: number
  pdfUrl?: string
  url?: string
  snippet?: string
}

// Google Scholar scraping function (simplified approach)
export async function searchGoogleScholar(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 20, fromYear, toYear, fastMode = false } = options
  
  // Note: This is a simplified implementation. In production, you might want to use:
  // 1. SerpAPI (paid service) for reliable Google Scholar access
  // 2. Scholarly Python library with a proxy service
  // 3. Custom scraping with proper rate limiting and user agents
  
  console.warn('🎓 Google Scholar: Using simplified search (consider SerpAPI for production)')
  
  try {
    // Build search URL with academic-focused parameters
    let searchQuery = `"${query}" filetype:pdf`
    
    if (fromYear) {
      searchQuery += ` after:${fromYear}`
    }
    if (toYear) {
      searchQuery += ` before:${toYear}`
    }
    
    // Use Google Scholar search URL format
    const baseUrl = 'https://scholar.google.com/scholar'
    const params = new URLSearchParams({
      q: searchQuery,
      num: Math.min(limit, 20).toString(),
      as_vis: '1', // Include citations
      as_sdt: '1,5' // Include patents and citations
    })
    
    const url = `${baseUrl}?${params.toString()}`
    
    // Use academic-friendly headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; GenPaper Academic Research Tool; +mailto:' + (CONTACT_EMAIL || 'research@example.com') + ')',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive'
    }
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), fastMode ? 10_000 : 15_000)
    
    try {
      const response = await fetch(url, { 
        headers,
        signal: controller.signal 
      })
      
      if (!response.ok) {
        console.warn(`Google Scholar returned ${response.status}: ${response.statusText}`)
        return []
      }
      
      const html = await response.text()
      
      // Simple HTML parsing for PDF links (this is a basic implementation)
      const results = parseGoogleScholarHtml(html)
      
             return results.map((result) => ({
         canonical_id: createCanonicalId(result.title, result.year, undefined, 'google_scholar'),
         title: result.title,
         abstract: result.snippet || '',
         year: result.year || 0,
         venue: result.venue || '',
         url: result.url || '',
         pdf_url: result.pdfUrl || '',
         citationCount: result.citationCount || 0,
         authors: result.authors || [],
         source: 'google_scholar' as const
       }))
      
    } finally {
      clearTimeout(timeoutId)
    }
    
  } catch (error) {
    console.warn('Google Scholar search failed:', error)
    return []
  }
}

// Basic HTML parser for Google Scholar results
function parseGoogleScholarHtml(html: string): GoogleScholarResult[] {
  const results: GoogleScholarResult[] = []
  
  // Extract individual result blocks instead of separate arrays
  const resultBlocks = html.match(/<div class="gs_r[\s\S]*?<\/div>/g) || []
  
  for (const block of resultBlocks.slice(0, 10)) { // Limit to 10 results
    // Extract title from the block
    const titleMatch = block.match(/<h3[^>]*class="gs_rt"[^>]*>.*?<\/h3>/i)
    if (!titleMatch) continue
    
    const titleHtml = titleMatch[0]
    const titleTextMatch = titleHtml.match(/>([^<]+)</g)
    const title = titleTextMatch ? 
      titleTextMatch[titleTextMatch.length - 1].replace(/[><]/g, '').trim() : 
      ''
    
    if (!title) continue
    
    // Extract PDF URL from the same block
    const pdfMatch = block.match(/https?:\/\/[^\s"'<>]+\.pdf/i)
    const pdfUrl = pdfMatch ? pdfMatch[0] : ''
    
    // Extract year from citation info (look for patterns like "(2023)" or "- 2023 -")
    const yearMatch = block.match(/[\(\-\s](\d{4})[\)\-\s]/g)
    let year = 0
    if (yearMatch) {
      const yearStr = yearMatch[yearMatch.length - 1].match(/\d{4}/)
      year = yearStr ? parseInt(yearStr[0]) : 0
    }
    
    // Extract venue/journal info
    const venueMatch = block.match(/<div class="gs_a">([^<]+)</i)
    const venue = venueMatch ? venueMatch[1].split('-')[0].trim() : ''
    
    if (pdfUrl && isDirectPdfUrl(pdfUrl)) {
      results.push({
        title: title,
        authors: [], // Would need more complex parsing
        pdfUrl,
        url: pdfUrl,
        year: year || 0, // Use extracted year or 0
        venue,
        snippet: '' // Could extract from gs_rs div
      })
    }
  }
  
  return results
}

// ArXiv PDF finder
async function findArxivPdf(title: string): Promise<string | null> {
  try {
    // Search ArXiv for the paper
    const results = await searchArxiv(title, { limit: 5 })
    
    // Find best match by title similarity
    for (const result of results) {
      if (result.pdf_url && titleSimilarity(title, result.title) > 0.7) {
        return result.pdf_url
      }
    }
    
    return null
  } catch {
    return null
  }
}

// ResearchGate PDF finder (simplified)
async function findResearchGatePdf(): Promise<string | null> {
  // This would require web scraping or API access to ResearchGate
  // For now, return null (implement if needed)
  return null
}

// bioRxiv PDF finder
async function findBiorxivPdf(title: string): Promise<string | null> {
  try {
    // Search bioRxiv API for the paper
    const searchQuery = encodeURIComponent(title.substring(0, 100)) // Limit query length
    const apiUrl = `https://api.biorxiv.org/details/biorxiv/${searchQuery}`
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)
    
    try {
      const response = await fetch(apiUrl, { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'GenPaper Academic Research Tool',
          'Accept': 'application/json'
        }
      })
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json()
      
      // bioRxiv API returns collection of papers
      if (data.collection && data.collection.length > 0) {
        // Find best match by title similarity
        for (const paper of data.collection) {
          if (paper.title && titleSimilarity(title, paper.title) > 0.6) {
            // Construct PDF URL from DOI
            if (paper.doi) {
              const pdfUrl = `https://www.biorxiv.org/content/${paper.doi}v${paper.version || 1}.full.pdf`
              console.log(`✅ Found bioRxiv PDF: ${pdfUrl}`)
              return pdfUrl
            }
          }
        }
      }
      
      return null
      
    } finally {
      clearTimeout(timeoutId)
    }
    
  } catch (error) {
    console.warn('bioRxiv search failed:', error)
    return null
  }
}

// medRxiv PDF finder (same API as bioRxiv)
async function findMedrxivPdf(title: string): Promise<string | null> {
  try {
    // Search medRxiv API for the paper
    const searchQuery = encodeURIComponent(title.substring(0, 100))
    const apiUrl = `https://api.biorxiv.org/details/medrxiv/${searchQuery}`
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)
    
    try {
      const response = await fetch(apiUrl, { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'GenPaper Academic Research Tool',
          'Accept': 'application/json'
        }
      })
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json()
      
      if (data.collection && data.collection.length > 0) {
        for (const paper of data.collection) {
          if (paper.title && titleSimilarity(title, paper.title) > 0.6) {
            if (paper.doi) {
              const pdfUrl = `https://www.medrxiv.org/content/${paper.doi}v${paper.version || 1}.full.pdf`
              console.log(`✅ Found medRxiv PDF: ${pdfUrl}`)
              return pdfUrl
            }
          }
        }
      }
      
      return null
      
    } finally {
      clearTimeout(timeoutId)
    }
    
  } catch (error) {
    console.warn('medRxiv search failed:', error)
    return null
  }
}

// PubMed Central (PMC) PDF finder
async function findPmcPdf(title: string, doi?: string): Promise<string | null> {
  try {
    // First try searching by DOI if available
    if (doi) {
      const pmcUrl = `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${encodeURIComponent(doi)}&format=json`
      
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000) // Reduced from 8s to prevent frontend disconnection
      
      try {
              const response = await fetch(pmcUrl, { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'GenPaper Academic Research Tool',
            'Accept': 'application/json'
          }
        })
        
        if (response.ok) {
          const data = await response.json()
          
          if (data.records && data.records.length > 0) {
            const record = data.records[0]
            if (record.pmcid) {
              // Construct PDF URL from PMC ID
              const pdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${record.pmcid}/pdf/`
              console.log(`✅ Found PMC PDF: ${pdfUrl}`)
              return pdfUrl
            }
          }
        }
      } finally {
        clearTimeout(timeoutId)
      }
    }
    
    // If DOI search fails, try title search via PubMed API
    const searchQuery = encodeURIComponent(title.substring(0, 100))
    const pubmedUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=${searchQuery}&retmode=json&retmax=5`
    
    const controller2 = new AbortController()
    const timeoutId2 = setTimeout(() => controller2.abort(), 3000) // Reduced from 8s to prevent frontend disconnection
    
    try {
      const response = await fetch(pubmedUrl, { 
        signal: controller2.signal,
        headers: {
          'User-Agent': 'GenPaper Academic Research Tool',
          'Accept': 'application/json'
        }
      })
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json()
      
      if (data.esearchresult && data.esearchresult.idlist && data.esearchresult.idlist.length > 0) {
        // Get details for the first result
        const pmcId = data.esearchresult.idlist[0]
        const detailsUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${pmcId}&retmode=json`
        
        const detailsResponse = await fetch(detailsUrl, { 
          signal: controller2.signal,
          headers: {
            'User-Agent': 'GenPaper Academic Research Tool',
            'Accept': 'application/json'
          }
        })
        
        if (detailsResponse.ok) {
          const detailsData = await detailsResponse.json()
          
          if (detailsData.result && detailsData.result[pmcId]) {
            const paperDetails = detailsData.result[pmcId]
            
            // Check title similarity
            if (paperDetails.title && titleSimilarity(title, paperDetails.title) > 0.6) {
              const pdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/pdf/`
              console.log(`✅ Found PMC PDF via search: ${pdfUrl}`)
              return pdfUrl
            }
          }
        }
      }
      
      return null
      
    } finally {
      clearTimeout(timeoutId2)
    }
    
  } catch (error) {
    console.warn('PMC search failed:', error)
    return null
  }
}

// Improved title similarity with minimum threshold
function titleSimilarity(title1: string, title2: string): number {
  const normalize = (str: string) => str.toLowerCase().replace(/[^\w\s]/g, '').trim()
  const t1 = normalize(title1)
  const t2 = normalize(title2)
  
  const words1 = new Set(t1.split(/\s+/).filter(w => w.length > 2)) // Filter short words
  const words2 = new Set(t2.split(/\s+/).filter(w => w.length > 2))
  
  const intersection = new Set([...words1].filter(x => words2.has(x)))
  const union = new Set([...words1, ...words2])
  
  // Require minimum union size to avoid false positives with short titles
  if (union.size < 5) {
    return 0
  }
  
  return intersection.size / union.size
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

interface OpenAlexResponse {
  results: OpenAlexWork[]
  meta?: {
    count: number
    next_cursor?: string
  }
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

// Simple retry with basic delay
async function simpleRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 2,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retry attempt ${attempt}/${maxAttempts - 1} after ${delayMs}ms`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
      
      return await fn()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      lastError = error
      
      // Handle rate limits with simple delay
      if (error.message.startsWith('429-')) {
        const waitTime = parseInt(error.message.split('-')[1]) || 2000
        console.warn(`Rate limit hit, attempt ${attempt + 1}/${maxAttempts}`)
        
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
        continue
      }
      
      // Don't retry client errors
      if (error.message.includes('400') || 
          error.message.includes('401') || 
          error.message.includes('403')) {
        throw error
      }
      
      // On last attempt, throw the error
      if (attempt === maxAttempts - 1) {
        break
      }
    }
  }
  
  throw lastError || new Error('Retry failed with unknown error')
}

// Utility to reconstruct abstract from OpenAlex inverted index
function deInvertAbstract(invertedIndex: Record<string, number[]>): string {
  const words: Array<{ word: string; position: number }> = []
  
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of positions) {
      words.push({ word, position })
    }
  }
  
  return words
    .sort((a, b) => a.position - b.position)
    .map(item => item.word)
    .join(' ')
}

/**
 * Build OpenAlex filter string with proper syntax
 */
function buildOpenAlexFilter(options: SearchOptions): string {
  const parts: string[] = []
  
  if (options.fromYear) {
    parts.push(`from_publication_date:${formatDateForAPI(options.fromYear)}`)
  }
  
  if (options.toYear) {
    parts.push(`to_publication_date:${formatDateForAPI(options.toYear, 12, 31)}`)
  }
  
  // ONE type filter with pipe-separated values (OR logic)
  const types = options.includeOtherTypes 
    ? [...PUBLICATION_TYPES, ...OTHER_PUBLICATION_TYPES]
    : PUBLICATION_TYPES
  parts.push(`type:${types.join('|')}`)
  
  if (options.openAccessOnly) {
    parts.push('is_oa:true')
  }
  
  return parts.join(',')
}

// Environment variable validation
const validateEnvironment = () => {
  const missing: string[] = []
  
  if (!CONTACT_EMAIL) {
    missing.push('CONTACT_EMAIL (required for OpenAlex and Unpaywall)')
  }
  
  if (missing.length > 0) {
    console.warn('⚠️ Missing environment variables:', missing.join(', '))
    console.warn('Some search sources may be disabled or have reduced functionality')
  }
}

// Initialize environment check
validateEnvironment()

// Environment variable validation with proper error throwing
export async function searchOpenAlex(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  // Strict validation - throw error instead of warning
  if (!CONTACT_EMAIL) {
    throw new Error('CONTACT_EMAIL environment variable is required for OpenAlex API. Set CONTACT_EMAIL or EMAIL in your environment.')
  }
  
  const { limit = 50, fastMode = false } = options
  
  return simpleRetry(async () => {
    const perPage = Math.min(limit, 200) // OpenAlex limit
    const filters = buildOpenAlexFilter(options)
    const base = 'https://api.openalex.org/works'
    
    const url = `${base}?search=${encodeURIComponent(query)}` +
                `&per_page=${perPage}` +
                `&filter=${encodeURIComponent(filters)}` +
                `&sort=cited_by_count:desc` +
                `&mailto=${encodeURIComponent(CONTACT_EMAIL)}`
    
    const data = await fetchJSON<OpenAlexResponse>(url, {
      fastMode,
      headers: {
        'User-Agent': `GenPaper/1.0 (mailto:${CONTACT_EMAIL})`
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
      pdf_url: '', // Normalize - OpenAlex doesn't provide direct PDFs
      citationCount: work.cited_by_count || 0,
      authors: work.authorships?.map((a) => a.author?.display_name).filter((name): name is string => Boolean(name)) || [],
      source: 'openalex' as const
    })) || []
  })
}

// Crossref API integration with better error handling
export async function searchCrossref(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear, openAccessOnly, fastMode = false } = options
  
  return simpleRetry(async () => {
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
        'User-Agent': `GenPaper/1.0 (mailto:${CONTACT_EMAIL || 'research@example.com'})`
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
        pdf_url: '', // Normalize - Crossref typically provides publisher URLs, not PDFs
        citationCount: item['is-referenced-by-count'] || 0,
        authors: item.author?.map((a) => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean) || [],
        source: 'crossref' as const
      }
    }) || []
  })
}

// Semantic Scholar API integration with API key guard
export async function searchSemanticScholar(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  // Guard against missing API key - return empty instead of throwing
  if (!process.env.SEMANTIC_API_KEY) {
    console.warn('SEMANTIC_API_KEY not set – skipping Semantic Scholar')
    return []
  }
  
  const { limit = 50, fromYear, toYear, openAccessOnly, fastMode = false } = options
  
  return simpleRetry(async () => {
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
      pdf_url: '', // Normalize - Semantic Scholar doesn't provide direct PDFs
      citationCount: paper.citationCount || 0,
      authors: paper.authors?.map(a => a.name) || [],
      source: 'semantic_scholar' as const
    })) || []
  })
}

// Enhanced arXiv search with proper date filtering
export async function searchArxiv(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear, fastMode = false } = options
  
  return simpleRetry(async () => {
    let searchQuery = `all:"${query}"`
    
    // Use proper arXiv date format: YYYYMMDDHHMM
    if (fromYear || toYear) {
      const from = fromYear ? `${fromYear}01010000` : '19910101000'
      const to = toYear ? `${toYear}12312359` : `${new Date().getFullYear()}12312359`
      searchQuery += ` AND submittedDate:[${from} TO ${to}]`
    }
    
    const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`
    
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
         pdf_url: pdfLink?.['@_href'] || '', // Normalize to empty string
         citationCount: 0,
         authors: authors.filter(Boolean),
         source: 'arxiv' as const
       }
     })
    } finally {
      clearTimeout(timeoutId)
    }
  })
}

// CORE API integration with API key guard
export async function searchCore(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  // Guard against missing API key - return empty instead of throwing
  if (!process.env.CORE_API_KEY) {
    console.warn('CORE_API_KEY not set – skipping CORE')
    return []
  }
  
  const { limit = 50, fromYear, toYear, fastMode = false } = options
  
  return simpleRetry(async () => {
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
      pdf_url: work.downloadUrl || '', // CORE often provides direct PDFs
      citationCount: 0,
      authors: work.authors?.map((a) => a.name).filter(Boolean) || [],
      source: 'core' as const
    })) || []
  })
}

// Enhanced Unpaywall integration with proper OA checking
export async function getOpenAccessPdf(doi: string): Promise<string | null> {
  if (!doi) return null
  
  return simpleRetry(async () => {
    const url = `https://api.unpaywall.org/v2/${doi}?email=${process.env.CONTACT_EMAIL || 'research@example.com'}`
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8_000)
    
    try {
      const response = await fetch(url, { signal: controller.signal })
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json()
      
      // Validate response structure
      if (!data || typeof data !== 'object') {
        console.log(`⚠️ Invalid Unpaywall response structure for DOI: ${doi}`)
        return null
      }
      
      // Check if we have a valid open access location with PDF
      if (data.best_oa_location?.url_for_pdf && 
          data.best_oa_location.host_type && 
          (data.best_oa_location.host_type !== 'publisher' || 
           (data.best_oa_location.host_type === 'publisher' && data.journal_is_oa))) {
        console.log(`✅ Found Unpaywall PDF: ${data.best_oa_location.url_for_pdf}`)
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

// PDF Strategy Pattern Implementation
type PdfStrategy = {
  name: string
  fn: (paper: AcademicPaper) => Promise<string | null>
  available: boolean
}

const pdfStrategies: PdfStrategy[] = [
  {
    name: 'Unpaywall',
    fn: (paper) => getOpenAccessPdf(paper.doi || ''),
    available: true
  },
  {
    name: 'ArXiv',
    fn: (paper) => findArxivPdf(paper.title),
    available: true
  },
  {
    name: 'bioRxiv',
    fn: (paper) => findBiorxivPdf(paper.title),
    available: true
  },
  {
    name: 'medRxiv',
    fn: (paper) => findMedrxivPdf(paper.title),
    available: true
  },
  {
    name: 'PMC',
    fn: (paper) => findPmcPdf(paper.title, paper.doi),
    available: true
  },
  {
    name: 'ResearchGate',
    fn: () => findResearchGatePdf(),
    available: false // Disabled - requires scraping
  }
]

// Enhanced single-paper PDF enrichment with early exit
async function enrichPdf(paper: AcademicPaper): Promise<AcademicPaper> {
  // Skip if we already have a direct PDF URL
  if (isDirectPdfUrl(paper.pdf_url || '')) {
    return paper
  }

  // Try strategies sequentially with early exit
  for (const strategy of pdfStrategies) {
    if (!strategy.available) continue
    
    try {
      const pdfUrl = await strategy.fn(paper)
      if (pdfUrl && isDirectPdfUrl(pdfUrl)) {
        console.log(`✅ ${strategy.name} found PDF for "${paper.title.substring(0, 50)}..."`)
        return { ...paper, pdf_url: pdfUrl }
      }
    } catch (error) {
      console.warn(`${strategy.name} strategy failed:`, error)
      // Continue to next strategy
    }
  }
  
  return paper
}

// Enhanced PDF URL enhancement function using the new strategy pattern
export async function enhancePdfUrls(papers: AcademicPaper[]): Promise<AcademicPaper[]> {
  console.log(`🔍 Enhancing PDF URLs for ${papers.length} papers...`)
  
  const limit = pLimit(3) // Limit concurrent requests
  
  const enhancements = await Promise.allSettled(
    papers.map(paper => limit(() => enrichPdf(paper)))
  )
  
  // Collect successful enhancements
  const enhanced: AcademicPaper[] = []
  for (const result of enhancements) {
    if (result.status === 'fulfilled') {
      enhanced.push(result.value)
    } else {
      console.warn('PDF enhancement failed:', result.reason)
      // Add the original paper if enhancement failed
      const originalIndex = enhancements.indexOf(result)
      if (originalIndex >= 0 && originalIndex < papers.length) {
        enhanced.push(papers[originalIndex])
      }
    }
  }
  
  const pdfCount = enhanced.filter((p: AcademicPaper) => isDirectPdfUrl(p.pdf_url || '')).length
  console.log(`📄 PDF Enhancement: ${pdfCount}/${enhanced.length} papers now have direct PDF access`)
  
  return enhanced
}

// Main orchestrator function that stops when enough papers are collected
export async function searchAllSources(
  query: string,
  options: SearchOptions = {}
): Promise<AcademicPaper[]> {
  const { desired = 60, fastMode = false } = options
  const limit = pLimit(fastMode ? 3 : 2) // Concurrency control
  
  const searchFunctions = [
    () => searchOpenAlex(query, { ...options, limit: Math.ceil(desired / 4) }),
    () => searchCrossref(query, { ...options, limit: Math.ceil(desired / 4) }),
    () => searchSemanticScholar(query, { ...options, limit: Math.ceil(desired / 4) }),
    () => searchArxiv(query, { ...options, limit: Math.ceil(desired / 5) }),
    () => searchCore(query, { ...options, limit: Math.ceil(desired / 5) }),
    () => searchGoogleScholar(query, { ...options, limit: Math.ceil(desired / 6) }),
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
  
  // Sort by citation count and recency, but prioritize papers with direct PDF access
  const sorted = deduped.sort((a, b) => {
    // First priority: Direct PDF access
    const aPdf = isDirectPdfUrl(a.pdf_url || '') ? 1 : 0
    const bPdf = isDirectPdfUrl(b.pdf_url || '') ? 1 : 0
    if (aPdf !== bPdf) return bPdf - aPdf
    
    // Second priority: Citation count
    const citationDiff = b.citationCount - a.citationCount
    if (citationDiff !== 0) return citationDiff
    
    // Third priority: Recency
    return b.year - a.year
  })
  
  const limitedResults = sorted.slice(0, desired)
  
  // Enhance PDF URLs for papers without direct access
  console.log(`🔍 Enhancing PDF access for ${limitedResults.length} papers...`)
  const enhanced = await enhancePdfUrls(limitedResults)
  
  // Log final PDF access statistics
  const directPdfCount = enhanced.filter((p: AcademicPaper) => isDirectPdfUrl(p.pdf_url || '')).length
  const paywallCount = enhanced.filter((p: AcademicPaper) => !isDirectPdfUrl(p.pdf_url || '') && isPaywalledUrl(p.url || '')).length
  const noPdfCount = enhanced.filter((p: AcademicPaper) => !p.pdf_url && !p.url).length
  
  console.log(`📊 PDF Access Summary:`)
  console.log(`  ✅ Direct PDF access: ${directPdfCount}/${enhanced.length} (${Math.round(directPdfCount/enhanced.length*100)}%)`)
  console.log(`  🔒 Paywall URLs: ${paywallCount}/${enhanced.length} (${Math.round(paywallCount/enhanced.length*100)}%)`)
  console.log(`  ❌ No access: ${noPdfCount}/${enhanced.length} (${Math.round(noPdfCount/enhanced.length*100)}%)`)
  
  return enhanced
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

export const adapters = [
  openalexAdapter,
  crossrefAdapter,
  semanticScholarAdapter,
  arxivAdapter,
  coreAdapter,
  googleScholarAdapter
] as const; 