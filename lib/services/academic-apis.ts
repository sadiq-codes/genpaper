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
  // Additional bibliographic fields for complete citations
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
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

// Import shared utilities
import { PaperSource } from '@/types/simplified'
import { XMLParser } from 'fast-xml-parser'
import pLimit from 'p-limit'
import { formatDateForAPI, createCanonicalId } from '@/lib/utils/paper-id'
import { jaccardSimilarity } from '@/lib/utils/fuzzy-matching'

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

// Known paywall domains that will return 403/require tokens
// These should be filtered out to avoid wasting time on failed downloads
const PAYWALL_DOMAINS = [
  'api.elsevier.com',           // Requires API token
  'api.wiley.com',              // Requires TDM Client Token
  'onlinelibrary.wiley.com/doi/pdfdirect', // Often requires access
  'academic.oup.com',           // Oxford - often paywalled
  'www.aeaweb.org/articles/pdf', // AEA journals - paywalled
  'pubsonline.informs.org',     // INFORMS - paywalled
  'www.sciencedirect.com/science/article', // ScienceDirect landing pages
  'tandfonline.com',            // Taylor & Francis - often paywalled
  'journals.sagepub.com',       // SAGE - often paywalled
]

// Landing page patterns that look like PDF URLs but aren't
const LANDING_PAGE_PATTERNS = [
  /papers\.ssrn\.com\/sol3\/Delivery\.cfm/i,  // SSRN delivery - returns HTML
  /dspace\..*\/handle\//i,                     // DSpace repository handles
  /hdl\.handle\.net\//i,                       // Handle.net redirects
  /doi\.org\/(?!.*\.pdf)/i,                    // DOI resolvers (not ending in .pdf)
  /\/abstract\//i,                              // Abstract pages
  /\/abs\//i,                                   // ArXiv abstract pages (not /pdf/)
]

/**
 * Check if URL points to a known paywall domain
 */
function isPaywalledUrl(url: string): boolean {
  if (!url) return false
  return PAYWALL_DOMAINS.some(domain => url.includes(domain))
}

/**
 * Check if URL is a landing page rather than a direct PDF
 */
function isLandingPageUrl(url: string): boolean {
  if (!url) return false
  return LANDING_PAGE_PATTERNS.some(pattern => pattern.test(url))
}

/**
 * Check if URL is likely to be a direct, accessible PDF
 */
function isDirectPdfUrl(url: string): boolean {
  if (!url) return false
  
  // Reject known paywalls and landing pages
  if (isPaywalledUrl(url) || isLandingPageUrl(url)) {
    return false
  }
  
  // Direct PDF patterns - known good sources
  const pdfPatterns = [
    /\.pdf$/i,
    /arxiv\.org\/pdf\//i,
    /biorxiv\.org\/content\/.*\.full\.pdf/i,
    /medrxiv\.org\/content\/.*\.full\.pdf/i,
    /researchgate\.net\/.*\.pdf/i,
    /academia\.edu\/.*\.pdf/i,
    /core\.ac\.uk\/download/i,                  // CORE downloads (may not end in .pdf)
    /europepmc\.org\/.*\.pdf/i,
    /ncbi\.nlm\.nih\.gov\/pmc\/articles\/.*\/pdf/i,
    /pmc\.ncbi\.nlm\.nih\.gov\/.*\/pdf/i,
    /link\.springer\.com\/content\/pdf/i,        // Springer OA PDFs
    /biomedcentral\.com\/track\/pdf/i,           // BMC PDFs
    /mdpi\.com\/.*\/pdf/i,                       // MDPI OA PDFs
    /frontiersin\.org\/.*\/pdf/i,                // Frontiers OA PDFs
    /plos\.org\/.*\.pdf/i,                       // PLOS OA PDFs
    /nature\.com\/.*\.pdf/i,                     // Nature (some OA)
    /doi\.org\/.*\.pdf$/i,                       // DOI resolving to PDF
  ]
  
  return pdfPatterns.some(pattern => pattern.test(url))
}

/**
 * Filter PDF URL - returns empty string if URL is paywalled or landing page
 * This prevents attempting downloads that will fail
 */
function filterPdfUrl(url: string): string {
  if (!url) return ''
  if (isPaywalledUrl(url)) {
    // Don't log every rejection - too noisy
    return ''
  }
  if (isLandingPageUrl(url)) {
    return ''
  }
  return url
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

// DOI Resolver - follows redirects from doi.org to find final URL
// This is cheap (~200-400ms) and often yields direct PDF locations
async function resolveDoi(doi: string): Promise<string | null> {
  if (!doi) return null
  
  // Clean the DOI - remove URL prefix if present
  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '').trim()
  if (!cleanDoi) return null
  
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 6000)
    
    try {
      // Follow redirects but don't download body - just get final URL
      const response = await fetch(`https://doi.org/${cleanDoi}`, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'GenPaper Academic Research Tool',
          'Accept': 'application/pdf,text/html,*/*'
        }
      })
      
      const finalUrl = response.url
      
      // Check if the final URL looks like a direct PDF
      if (finalUrl && isDirectPdfUrl(finalUrl)) {
        console.log(`✅ DOI resolver found direct PDF: ${finalUrl}`)
        return finalUrl
      }
      
      // Try to extract PDF from the landing page URL using pattern matching
      const pdfFromUrl = tryExtractPdfFromLandingUrl(finalUrl)
      if (pdfFromUrl) {
        console.log(`✅ DOI resolver extracted PDF URL: ${pdfFromUrl}`)
        return pdfFromUrl
      }
      
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    // Don't spam logs for expected failures
    if (error instanceof Error && error.name !== 'AbortError') {
      console.warn('DOI resolution failed:', error.message)
    }
    return null
  }
}

// Try to convert a landing page URL into a direct PDF URL using known patterns
function tryExtractPdfFromLandingUrl(url: string): string | null {
  if (!url) return null
  
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname
    
    // Springer/Nature: /article/... -> /content/pdf/...
    if ((host.includes('link.springer.com') || host.includes('nature.com')) && path.includes('/article/')) {
      const pdfUrl = url.replace('/article/', '/content/pdf/') + '.pdf'
      return pdfUrl
    }
    
    // MDPI: /htm -> /pdf
    if (host.includes('mdpi.com') && path.includes('/htm')) {
      return url.replace('/htm', '/pdf')
    }
    
    // Frontiers: Add /pdf to article URL
    if (host.includes('frontiersin.org') && path.includes('/articles/')) {
      return url + '/pdf'
    }
    
    // PLoS: /article -> /article/file?id=...&type=printable
    if (host.includes('plos.org') || host.includes('journals.plos.org')) {
      const doiMatch = path.match(/10\.\d+\/[^\s\/]+/)
      if (doiMatch) {
        return `https://journals.plos.org/plosone/article/file?id=${doiMatch[0]}&type=printable`
      }
    }
    
    // Wiley: /doi/... -> /doi/pdf/...
    if (host.includes('onlinelibrary.wiley.com') && path.includes('/doi/') && !path.includes('/pdf/')) {
      return url.replace('/doi/', '/doi/pdf/')
    }
    
    // Taylor & Francis: /doi/full/ -> /doi/pdf/
    if (host.includes('tandfonline.com') && path.includes('/doi/full/')) {
      return url.replace('/doi/full/', '/doi/pdf/')
    }
    
    // SAGE: /doi/... -> /doi/pdf/...
    if (host.includes('journals.sagepub.com') && path.includes('/doi/') && !path.includes('/pdf/')) {
      return url.replace('/doi/', '/doi/pdf/')
    }
    
    // Cambridge University Press: Add /pdf
    if (host.includes('cambridge.org') && path.includes('/article/')) {
      return url + '/pdf'
    }
    
    // Oxford Academic: /doi/... -> /doi/.../pdf
    if (host.includes('academic.oup.com') && !path.endsWith('/pdf')) {
      return url + '/pdf'
    }
    
    // BMC/BioMed Central: /articles/ -> /track/pdf/
    if (host.includes('biomedcentral.com') && path.includes('/articles/')) {
      return url.replace('/articles/', '/track/pdf/')
    }
    
    // ScienceDirect: article page -> pdfft (may require OA)
    if (host.includes('sciencedirect.com') && path.includes('/article/')) {
      // ScienceDirect PDF URLs use a different pattern - pii based
      const piiMatch = path.match(/pii\/([A-Z0-9]+)/i)
      if (piiMatch) {
        return `https://www.sciencedirect.com/science/article/pii/${piiMatch[1]}/pdfft`
      }
    }
    
    // IEEE Xplore: /document/ -> /stampPDF.jsp
    if (host.includes('ieeexplore.ieee.org') && path.includes('/document/')) {
      const docIdMatch = path.match(/\/document\/(\d+)/)
      if (docIdMatch) {
        return `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=${docIdMatch[1]}`
      }
    }
    
    // ACM DL: /doi/ -> /doi/pdf/
    if (host.includes('dl.acm.org') && path.includes('/doi/') && !path.includes('/pdf/')) {
      return url.replace('/doi/', '/doi/pdf/')
    }
    
    // arXiv: /abs/ -> /pdf/
    if (host.includes('arxiv.org') && path.includes('/abs/')) {
      return url.replace('/abs/', '/pdf/') + '.pdf'
    }
    
    // bioRxiv/medRxiv: Add .full.pdf
    if ((host.includes('biorxiv.org') || host.includes('medrxiv.org')) && !path.includes('.pdf')) {
      return url + '.full.pdf'
    }
    
    return null
  } catch {
    return null
  }
}

// Deterministic URL builders for known open access patterns
// These are pure string transforms - very fast
function buildKnownPdfPatterns(paper: AcademicPaper): string[] {
  const candidates: string[] = []
  const url = paper.url || ''
  const doi = paper.doi || ''
  
  try {
    if (url) {
      const parsed = new URL(url)
      const host = parsed.hostname.toLowerCase()
      
      // arXiv patterns
      if (host.includes('arxiv.org')) {
        const arxivIdMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/i) || 
                            url.match(/arxiv\.org\/(?:abs|pdf)\/([a-z-]+\/\d+)/i)
        if (arxivIdMatch) {
          candidates.push(`https://arxiv.org/pdf/${arxivIdMatch[1]}.pdf`)
        }
      }
      
      // PMC patterns
      if (host.includes('ncbi.nlm.nih.gov') || host.includes('pmc')) {
        const pmcMatch = url.match(/PMC(\d+)/i) || url.match(/pmc\/articles\/(\d+)/i)
        if (pmcMatch) {
          const pmcId = pmcMatch[1].replace(/^PMC/i, '')
          candidates.push(`https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/pdf/`)
          candidates.push(`https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC${pmcId}&blobtype=pdf`)
        }
      }
      
      // Springer OA
      if (host.includes('link.springer.com') || host.includes('nature.com')) {
        const pdfUrl = tryExtractPdfFromLandingUrl(url)
        if (pdfUrl) candidates.push(pdfUrl)
      }
      
      // MDPI (always OA)
      if (host.includes('mdpi.com')) {
        const pdfUrl = url.replace('/htm', '/pdf')
        if (pdfUrl !== url) candidates.push(pdfUrl)
      }
      
      // Frontiers (always OA)
      if (host.includes('frontiersin.org')) {
        candidates.push(url + '/pdf')
      }
      
      // PLoS (always OA)
      if (host.includes('plos.org') || host.includes('journals.plos.org')) {
        const pdfUrl = tryExtractPdfFromLandingUrl(url)
        if (pdfUrl) candidates.push(pdfUrl)
      }
      
      // bioRxiv/medRxiv
      if (host.includes('biorxiv.org') || host.includes('medrxiv.org')) {
        if (!url.includes('.pdf')) {
          candidates.push(url + '.full.pdf')
        }
      }
      
      // BMC
      if (host.includes('biomedcentral.com')) {
        const pdfUrl = url.replace('/articles/', '/track/pdf/')
        if (pdfUrl !== url) candidates.push(pdfUrl)
      }
    }
    
    // DOI-based patterns (if we have a DOI but couldn't extract from URL)
    if (doi && candidates.length === 0) {
      const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '')
      
      // Unpaywall API will be called separately - no fake URL
      // But we can try some known DOI-to-PDF patterns
      
      // PubMed Central via DOI
      if (cleanDoi.startsWith('10.1371/')) {
        // PLoS DOIs
        candidates.push(`https://journals.plos.org/plosone/article/file?id=${cleanDoi}&type=printable`)
      }
      
      if (cleanDoi.startsWith('10.3389/')) {
        // Frontiers DOIs - need article URL
      }
      
      if (cleanDoi.startsWith('10.3390/')) {
        // MDPI DOIs
        const mdpiMatch = cleanDoi.match(/10\.3390\/(\w+)(\d+)/)
        if (mdpiMatch) {
          candidates.push(`https://www.mdpi.com/${mdpiMatch[1]}/${mdpiMatch[2]}/pdf`)
        }
      }
    }
    
  } catch {
    // URL parsing failed, skip pattern building
  }
  
  return candidates
}

// Fast pattern-based PDF finder (runs before slower API calls)
async function findPdfByKnownPatterns(paper: AcademicPaper): Promise<string | null> {
  const candidates = buildKnownPdfPatterns(paper)
  
  // Quickly verify first candidate that looks valid
  for (const candidate of candidates) {
    if (isDirectPdfUrl(candidate)) {
      // Quick HEAD request to verify it exists (don't download full PDF)
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3000)
        
        try {
          const response = await fetch(candidate, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
              'User-Agent': 'GenPaper Academic Research Tool',
              'Accept': 'application/pdf'
            }
          })
          
          if (response.ok) {
            const contentType = response.headers.get('content-type') || ''
            if (contentType.includes('pdf') || contentType.includes('octet-stream')) {
              console.log(`✅ Pattern-based PDF found: ${candidate}`)
              return candidate
            }
          }
        } finally {
          clearTimeout(timeoutId)
        }
      } catch {
        // Try next candidate
      }
    }
  }
  
  return null
}

// CORE API lookup by DOI - CORE has 200M+ open access papers with direct download URLs
async function findCorePdf(doi: string): Promise<string | null> {
  if (!doi || !process.env.CORE_API_KEY) return null
  
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 6000)
    
    try {
      // Clean DOI
      const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '').trim()
      
      // CORE API v3 - search by DOI
      const response = await fetch('https://api.core.ac.uk/v3/search/works', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CORE_API_KEY}`
        },
        body: JSON.stringify({
          q: `doi:"${cleanDoi}"`,
          limit: 1
        })
      })
      
      if (!response.ok) return null
      
      const data = await response.json()
      
      if (data.results && data.results.length > 0) {
        const work = data.results[0]
        const pdfUrl = work.downloadUrl || 
          (work.sourceFulltextUrls?.find((url: string) => url.endsWith('.pdf') || url.includes('/pdf')) || 
           work.sourceFulltextUrls?.[0])
        
        if (pdfUrl && isDirectPdfUrl(pdfUrl)) {
          console.log(`✅ CORE API found PDF: ${pdfUrl}`)
          return pdfUrl
        }
      }
      
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    if (error instanceof Error && error.name !== 'AbortError') {
      console.warn('CORE PDF lookup failed:', error.message)
    }
    return null
  }
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

// Title similarity using consolidated Jaccard similarity
// Uses imported jaccardSimilarity from fuzzy-matching.ts with title-specific settings
function titleSimilarity(title1: string, title2: string): number {
  return jaccardSimilarity(title1, title2, { minWordLength: 2, minUnionSize: 5 })
}

// API Response interfaces for better typing
interface OpenAlexWork {
  display_name: string
  publication_year?: number
  doi?: string
  abstract_inverted_index?: Record<string, number[]>
  primary_location?: {
    source?: { 
      display_name: string
      publisher?: string
    }
    landing_page_url?: string
    pdf_url?: string
  }
  best_oa_location?: {
    pdf_url?: string
    landing_page_url?: string
    host_type?: string
  }
  open_access?: {
    is_oa: boolean
    oa_url?: string
    oa_status?: string
  }
  cited_by_count?: number
  authorships?: Array<{
    author?: { display_name: string }
  }>
  // Bibliographic details
  biblio?: {
    volume?: string
    issue?: string
    first_page?: string
    last_page?: string
  }
  // For books/chapters
  host_venue?: {
    publisher?: string
  }
}

interface OpenAlexResponse {
  results: OpenAlexWork[]
  meta?: {
    count: number
    next_cursor?: string
  }
}

interface CrossrefLink {
  URL: string
  'content-type'?: string
  'content-version'?: string
  'intended-application'?: string
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
  link?: CrossrefLink[]
  // Additional bibliographic fields
  volume?: string
  issue?: string
  page?: string
  publisher?: string
}

interface CrossrefResponse {
  message?: {
    items: CrossrefItem[]
    'total-results'?: number
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
  openAccessPdf?: { url: string } | null
  isOpenAccess?: boolean
}

interface SemanticScholarResponse {
  total?: number
  data: SemanticScholarPaper[]
}

interface CoreWork {
  title: string
  yearPublished?: number
  doi?: string
  abstract?: string
  publisher?: string
  downloadUrl?: string
  sourceFulltextUrls?: string[]
  authors?: Array<{ name: string }>
  language?: { code: string }
  documentType?: string
}

interface CoreResponse {
  totalHits?: number
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
    
    // Sort by relevance first, not citations - relevance is critical for search quality
    const url = `${base}?search=${encodeURIComponent(query)}` +
                `&per_page=${perPage}` +
                `&filter=${encodeURIComponent(filters)}` +
                `&sort=relevance_score:desc` +
                `&mailto=${encodeURIComponent(CONTACT_EMAIL)}`
    
    const data = await fetchJSON<OpenAlexResponse>(url, {
      fastMode,
      headers: {
        'User-Agent': `GenPaper/1.0 (mailto:${CONTACT_EMAIL})`
      }
    })
    
    console.log(`📚 OpenAlex returned ${data.results?.length || 0} results (total: ${data.meta?.count || 'unknown'})`)
    
    return data.results?.map((work: OpenAlexWork) => {
      // Extract PDF URL from OpenAlex open access data
      // Priority: best_oa_location.pdf_url > primary_location.pdf_url > open_access.oa_url
      // Filter out paywalled/landing page URLs
      const rawPdfUrl = work.best_oa_location?.pdf_url || 
                        work.primary_location?.pdf_url || 
                        work.open_access?.oa_url || 
                        ''
      const pdfUrl = filterPdfUrl(rawPdfUrl)
      
      // Extract pages from first_page and last_page
      const pages = work.biblio?.first_page && work.biblio?.last_page
        ? `${work.biblio.first_page}-${work.biblio.last_page}`
        : work.biblio?.first_page || undefined

      return {
        canonical_id: createCanonicalId(work.display_name, work.publication_year, work.doi, 'openalex'),
        title: work.display_name,
        abstract: work.abstract_inverted_index ? deInvertAbstract(work.abstract_inverted_index) : '',
        year: work.publication_year || 0,
        venue: work.primary_location?.source?.display_name,
        doi: work.doi,
        url: work.primary_location?.landing_page_url,
        pdf_url: pdfUrl,
        citationCount: work.cited_by_count || 0,
        authors: work.authorships?.map((a) => a.author?.display_name).filter((name): name is string => Boolean(name)) || [],
        source: 'openalex' as const,
        is_open_access: work.open_access?.is_oa || false,
        // Additional bibliographic fields for complete citations
        volume: work.biblio?.volume || undefined,
        issue: work.biblio?.issue || undefined,
        pages,
        publisher: work.primary_location?.source?.publisher || work.host_venue?.publisher || undefined
      }
    }) || []
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
    
    console.log(`📚 Crossref returned ${data.message?.items?.length || 0} results (total: ${data.message?.['total-results'] || 'unknown'})`)
    
    return data.message?.items?.map((item: CrossrefItem) => {
      const title = Array.isArray(item.title) ? item.title[0] : item.title || ''
      const year = item.published?.['date-parts']?.[0]?.[0] || 0
      const doi = item.DOI
      
      // Try to extract PDF URL from links array
      // Look for PDF content-type or intended-application
      // Filter out paywalled URLs that will fail
      let pdfUrl = ''
      if (item.link?.length) {
        const pdfLink = item.link.find(l => {
          const url = l.URL || ''
          // Skip paywalled/landing page URLs
          if (isPaywalledUrl(url) || isLandingPageUrl(url)) return false
          return (
            l['content-type']?.includes('pdf') || 
            l['intended-application'] === 'text-mining' ||
            url.endsWith('.pdf')
          )
        })
        pdfUrl = filterPdfUrl(pdfLink?.URL || '')
      }
      
      return {
        canonical_id: createCanonicalId(title, year, doi, 'crossref'),
        title,
        abstract: item.abstract || '',
        year,
        venue: item['container-title']?.[0] || '',
        doi,
        url: item.URL,
        pdf_url: pdfUrl,
        citationCount: item['is-referenced-by-count'] || 0,
        authors: item.author?.map((a) => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean) || [],
        source: 'crossref' as const,
        // Additional bibliographic fields for complete citations
        volume: item.volume || undefined,
        issue: item.issue || undefined,
        pages: item.page || undefined,
        publisher: item.publisher || undefined
      }
    }) || []
  })
}

// Semantic Scholar API integration
// API key is OPTIONAL - works without it at lower rate limits (100 req/5min vs 1-10 req/sec)
export async function searchSemanticScholar(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear, openAccessOnly, fastMode = false } = options
  
  // Use smaller limit without API key to avoid rate limits
  const apiKey = process.env.SEMANTIC_API_KEY
  const effectiveLimit = apiKey ? Math.min(limit, 100) : Math.min(limit, 20)
  
  return simpleRetry(async () => {
    // Include openAccessPdf field to get direct PDF URLs when available
    let url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${effectiveLimit}&fields=paperId,title,abstract,year,venue,doi,url,citationCount,authors,openAccessPdf,isOpenAccess`
    
    // Build year filter: Semantic Scholar expects format like "2020-2023" or "2020-" or "-2023"
    if (fromYear || toYear) {
      const yearFrom = fromYear ? String(fromYear) : ''
      const yearTo = toYear ? String(toYear) : ''
      url += `&year=${yearFrom}-${yearTo}`
    }
    
    if (openAccessOnly) {
      url += '&openAccessPdf'
    }
    
    // Headers - API key is optional, just provides higher rate limits
    const headers: Record<string, string> = {}
    if (apiKey) {
      headers['x-api-key'] = apiKey
    }
    
    const data = await fetchJSON<SemanticScholarResponse>(url, {
      fastMode,
      headers,
      // Longer timeout without API key since rate limits are stricter
      timeout: apiKey ? 12_000 : 20_000
    })
    
    const authStatus = apiKey ? 'authenticated' : 'unauthenticated'
    console.log(`📚 Semantic Scholar (${authStatus}) returned ${data.data?.length || 0} results (total: ${data.total || 'unknown'})`)
    
    return data.data?.map((paper: SemanticScholarPaper) => ({
      canonical_id: createCanonicalId(paper.title, paper.year, paper.doi, 'semanticscholar'),
      title: paper.title,
      abstract: paper.abstract || '',
      year: paper.year || 0,
      venue: paper.venue,
      doi: paper.doi,
      url: paper.url,
      pdf_url: paper.openAccessPdf?.url || '', // Extract PDF URL from openAccessPdf field
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
      
      console.log(`📚 arXiv returned ${entries.length} results`)
      
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
// CORE has 200M+ open access papers with direct PDF download URLs
export async function searchCore(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  // Guard against missing API key - return empty instead of throwing
  if (!process.env.CORE_API_KEY) {
    console.warn('CORE_API_KEY not set – skipping CORE')
    return []
  }
  
  const { limit = 50, fromYear, toYear, fastMode = false } = options
  
  return simpleRetry(async () => {
    // Use simple query format - CORE handles relevance matching well
    let searchQuery = query
    
    // Add year filter if specified
    if (fromYear || toYear) {
      const from = fromYear || 1900
      const to = toYear || new Date().getFullYear()
      searchQuery += ` AND yearPublished>=${from} AND yearPublished<=${to}`
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
    
    console.log(`📚 CORE returned ${data.results?.length || 0} results (total: ${data.totalHits || 'unknown'})`)
    
    return data.results?.map((work: CoreWork) => {
      // Get PDF URL - prefer downloadUrl, fallback to sourceFulltextUrls
      let pdfUrl = work.downloadUrl || ''
      if (!pdfUrl && work.sourceFulltextUrls?.length) {
        // Find first URL that looks like a PDF
        pdfUrl = work.sourceFulltextUrls.find(url => 
          url.endsWith('.pdf') || url.includes('/pdf')
        ) || work.sourceFulltextUrls[0] || ''
      }
      
      return {
        canonical_id: createCanonicalId(work.title, work.yearPublished, work.doi, 'core'),
        title: work.title,
        abstract: work.abstract || '',
        year: work.yearPublished || 0,
        venue: work.publisher,
        doi: work.doi,
        url: work.downloadUrl || pdfUrl,
        pdf_url: pdfUrl, // CORE often provides direct PDFs
        citationCount: 0,
        authors: work.authors?.map((a) => a.name).filter(Boolean) || [],
        source: 'core' as const
      }
    }) || []
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

// Convert PMC URL to direct PDF URL
async function findPmcPdf(url: string): Promise<string | null> {
  if (!url) return null
  
  // Match PMC article URLs like https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3372692
  // or https://www.ncbi.nlm.nih.gov/pmc/articles/3372692
  const pmcMatch = url.match(/pmc\/articles\/(?:PMC)?(\d+)/i)
  if (pmcMatch) {
    const pmcId = pmcMatch[1]
    // PMC provides PDF at this URL pattern
    return `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/pdf/`
  }
  
  // Match Europe PMC URLs
  const europePmcMatch = url.match(/europepmc\.org\/articles\/PMC(\d+)/i)
  if (europePmcMatch) {
    const pmcId = europePmcMatch[1]
    return `https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC${pmcId}&blobtype=pdf`
  }
  
  return null
}

// PDF Strategies ordered by speed and reliability (cheap first)
// Strategy ordering matters: we want to minimize latency while maximizing success
const pdfStrategies: PdfStrategy[] = [
  // Tier 1: Cheap pattern-based (pure string transforms + quick HEAD check)
  {
    name: 'KnownPatterns',
    fn: (paper) => findPdfByKnownPatterns(paper),
    available: true
  },
  // Tier 1: PMC pattern matching (cheap)
  {
    name: 'PMC',
    fn: (paper) => findPmcPdf(paper.url || paper.pdf_url || ''),
    available: true
  },
  // Tier 2: DOI resolution (single redirect follow, ~200-400ms)
  {
    name: 'DOI-Resolver',
    fn: (paper) => resolveDoi(paper.doi || ''),
    available: true
  },
  // Tier 2: Unpaywall API (reliable, ~500ms)
  {
    name: 'Unpaywall',
    fn: (paper) => getOpenAccessPdf(paper.doi || ''),
    available: true
  },
  // Tier 2: CORE API (200M+ OA papers, ~500ms) - only if API key available
  {
    name: 'CORE',
    fn: (paper) => findCorePdf(paper.doi || ''),
    available: !!process.env.CORE_API_KEY
  },
  // Tier 3: Title-based searches (slower, ~1-2s each)
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
  // Disabled strategies
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
  
  // Increased concurrency for better throughput - strategies hit different hosts
  const limit = pLimit(5)
  
  const enhancements = await Promise.allSettled(
    papers.map(paper => limit(() => enrichPdf(paper)))
  )
  
  // Collect successful enhancements
  const enhanced: AcademicPaper[] = []
  for (let i = 0; i < enhancements.length; i++) {
    const result = enhancements[i]
    if (result.status === 'fulfilled') {
      enhanced.push(result.value)
    } else {
      console.warn('PDF enhancement failed:', result.reason)
      // Add the original paper if enhancement failed
      enhanced.push(papers[i])
    }
  }
  
  const pdfCount = enhanced.filter((p: AcademicPaper) => isDirectPdfUrl(p.pdf_url || '')).length
  const noPdfCount = enhanced.filter((p: AcademicPaper) => !p.pdf_url).length
  
  console.log(`📄 PDF Enhancement: ${pdfCount}/${enhanced.length} papers have direct PDF access`)
  if (noPdfCount > 0) {
    console.log(`⚠️ ${noPdfCount} papers have no PDF available (will use abstract/metadata only)`)
  }
  
  return enhanced
}

// NOTE: searchAllSources function removed - use unifiedSearch from @/lib/services/search-orchestrator instead
// This eliminates duplicate orchestration logic and ensures consistent behavior

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
    // Only log unexpected errors, not rate limits or 404s
    const errorMsg = e instanceof Error ? e.message : String(e)
    if (!errorMsg.startsWith('429') && !errorMsg.includes('404')) {
      console.warn('Crossref reference fetch failed:', errorMsg)
    }
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
    // Only log unexpected errors, not rate limits or 404s (paper not found is common)
    const errorMsg = e instanceof Error ? e.message : String(e)
    if (!errorMsg.startsWith('429') && !errorMsg.includes('404')) {
      console.warn('Semantic Scholar reference fetch failed:', errorMsg)
    }
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

 