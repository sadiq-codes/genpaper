/**
 * HTML Article Extraction Module
 * 
 * Extracts full-text content from publisher HTML pages when PDF download fails.
 * Uses @extractus/article-extractor with publisher-specific transformations.
 */

import { extract, addTransformations } from '@extractus/article-extractor'

export interface HtmlExtractionResult {
  content: string
  title?: string
  author?: string
  publishedTime?: string
  contentSource: 'html'
}

// Academic-friendly user agents
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
]

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

/**
 * Publisher-specific transformations to clean up HTML before extraction
 */
function initializeTransformations(): void {
  addTransformations([
    // Wiley (includes ACS journals on Wiley platform)
    {
      patterns: [
        /onlinelibrary\.wiley\.com/,
        /acsjournals\.onlinelibrary\.wiley\.com/,
      ],
      pre: (document) => {
        // Remove non-article elements
        const selectorsToRemove = [
          '.article-section__inline-figure',
          '.figure-viewer-inline',
          '.article-table-content',
          '.article__references',
          '.related-content',
          '.recommendations',
          '.pdf-notice',
          '.article-header__toolbar',
          '.share-access',
          'aside',
          'nav',
          '.ads-container',
        ]
        selectorsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach((el: Element) => el.remove())
        })
        return document
      }
    },
    
    // Elsevier / ScienceDirect
    {
      patterns: [
        /sciencedirect\.com/,
        /elsevier\.com/,
      ],
      pre: (document) => {
        const selectorsToRemove = [
          '.recommended-articles',
          '.article-tools',
          '.reference-links',
          '.figures-thumbs',
          '.graphical-abstract',
          '.article-metrics',
          '.author-group',
          'aside',
          'nav',
        ]
        selectorsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach((el: Element) => el.remove())
        })
        return document
      }
    },
    
    // Springer / Nature
    {
      patterns: [
        /link\.springer\.com/,
        /nature\.com/,
        /springeropen\.com/,
      ],
      pre: (document) => {
        const selectorsToRemove = [
          '.c-article-references',
          '.c-article-supplementary',
          '.c-article-metrics',
          '.c-article-author-affiliation',
          '.recommended-articles',
          '.supplementary-information',
          'aside',
          'nav',
        ]
        selectorsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach((el: Element) => el.remove())
        })
        return document
      }
    },
    
    // PLOS
    {
      patterns: [
        /journals\.plos\.org/,
        /plosone\.org/,
      ],
      pre: (document) => {
        const selectorsToRemove = [
          '.references',
          '.supplementary-material',
          '.article-metrics',
          '.related-articles',
          'aside',
          'nav',
        ]
        selectorsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach((el: Element) => el.remove())
        })
        return document
      }
    },
    
    // MDPI
    {
      patterns: [
        /mdpi\.com/,
      ],
      pre: (document) => {
        const selectorsToRemove = [
          '.html-references',
          '.html-supplementary',
          '.article-icons',
          '.share-icons',
          '.supplementary-content',
          'aside',
          'nav',
        ]
        selectorsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach((el: Element) => el.remove())
        })
        return document
      }
    },
    
    // Frontiers
    {
      patterns: [
        /frontiersin\.org/,
      ],
      pre: (document) => {
        const selectorsToRemove = [
          '.References',
          '.SupplementaryMaterial',
          '.ArticleMetrics',
          '.AuthorBios',
          '.RelatedArticles',
          'aside',
          'nav',
        ]
        selectorsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach((el: Element) => el.remove())
        })
        return document
      }
    },
    
    // PubMed Central
    {
      patterns: [
        /ncbi\.nlm\.nih\.gov\/pmc/,
        /pmc\.ncbi\.nlm\.nih\.gov/,
      ],
      pre: (document) => {
        const selectorsToRemove = [
          '.ref-list',
          '.supplementary-material',
          '.fig-inline',
          '.table-wrap',
          '.back-matter',
          'aside',
          'nav',
        ]
        selectorsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach((el: Element) => el.remove())
        })
        return document
      }
    },
    
    // Europe PMC
    {
      patterns: [
        /europepmc\.org/,
      ],
      pre: (document) => {
        const selectorsToRemove = [
          '.ref-list',
          '.supplementary-material',
          '.article-metrics',
          'aside',
          'nav',
        ]
        selectorsToRemove.forEach(selector => {
          document.querySelectorAll(selector).forEach((el: Element) => el.remove())
        })
        return document
      }
    },
  ])
}

// Initialize transformations when module loads
let transformationsInitialized = false

function ensureTransformationsInitialized(): void {
  if (!transformationsInitialized) {
    initializeTransformations()
    transformationsInitialized = true
  }
}

/**
 * Convert a PDF URL to the corresponding HTML article URL
 * Returns null if conversion is not possible for the given publisher
 */
export function convertPdfUrlToHtmlUrl(pdfUrl: string): string | null {
  try {
    const url = new URL(pdfUrl)
    const hostname = url.hostname.toLowerCase()
    const pathname = url.pathname
    
    // Wiley: /doi/pdf/10.xxxx/xxx or /doi/pdfdirect/10.xxxx/xxx → /doi/full/10.xxxx/xxx
    if (hostname.includes('wiley.com')) {
      if (pathname.includes('/doi/pdf/') || pathname.includes('/doi/pdfdirect/')) {
        return pdfUrl
          .replace('/doi/pdf/', '/doi/full/')
          .replace('/doi/pdfdirect/', '/doi/full/')
      }
      // Also handle /doi/epdf/ pattern
      if (pathname.includes('/doi/epdf/')) {
        return pdfUrl.replace('/doi/epdf/', '/doi/full/')
      }
    }
    
    // Elsevier/ScienceDirect: /pii/S0xxx/pdf → /article/pii/S0xxx
    // or /science/article/pii/S0xxx/pdf → /science/article/pii/S0xxx
    if (hostname.includes('sciencedirect.com') || hostname.includes('elsevier.com')) {
      if (pathname.endsWith('/pdf') || pathname.endsWith('/pdfft')) {
        return pdfUrl.replace(/\/(pdf|pdfft)$/, '')
      }
    }
    
    // Springer: /content/pdf/10.xxxx/xxx.pdf → /article/10.xxxx/xxx
    if (hostname.includes('springer') || hostname.includes('nature.com')) {
      if (pathname.includes('/content/pdf/')) {
        // Extract DOI from path: /content/pdf/10.1007%2Fs12345.pdf → 10.1007/s12345
        const match = pathname.match(/\/content\/pdf\/(.+)\.pdf/)
        if (match) {
          const doi = decodeURIComponent(match[1])
          return `https://${hostname}/article/${doi}`
        }
      }
    }
    
    // PLOS: Already HTML-first, PDFs are at /article/file?id=... 
    // Return the article page URL
    if (hostname.includes('plos')) {
      if (pathname.includes('/article/file')) {
        // Extract article ID from query params
        const id = url.searchParams.get('id')
        if (id) {
          // Format: 10.1371/journal.pone.0123456 → /article?id=10.1371/journal.pone.0123456
          return `https://${hostname}/article?id=${id}`
        }
      }
      // If it's already an article URL, return as-is
      if (pathname.includes('/article')) {
        return pdfUrl
      }
    }
    
    // MDPI: /xxx/xxx/pdf → /xxx/xxx/htm or the article page
    if (hostname.includes('mdpi.com')) {
      if (pathname.endsWith('/pdf')) {
        return pdfUrl.replace(/\/pdf$/, '/htm')
      }
    }
    
    // Frontiers: /articles/10.3389/xxx/pdf → /articles/10.3389/xxx/full
    if (hostname.includes('frontiersin.org')) {
      if (pathname.endsWith('/pdf')) {
        return pdfUrl.replace(/\/pdf$/, '/full')
      }
    }
    
    // PubMed Central: /pmc/articles/PMCxxxx/pdf → /pmc/articles/PMCxxxx/
    if (hostname.includes('ncbi.nlm.nih.gov') && pathname.includes('/pmc/')) {
      if (pathname.endsWith('/pdf') || pathname.includes('/pdf/')) {
        return pdfUrl.replace(/\/pdf\/?.*$/, '/')
      }
    }
    
    // Europe PMC: Similar to PMC
    if (hostname.includes('europepmc.org')) {
      if (pathname.includes('/pdf/')) {
        return pdfUrl.replace(/\/pdf\/.*$/, '')
      }
    }
    
    // arXiv: /pdf/xxxx.xxxxx → /abs/xxxx.xxxxx (though arXiv PDFs are usually accessible)
    if (hostname.includes('arxiv.org')) {
      if (pathname.startsWith('/pdf/')) {
        return pdfUrl.replace('/pdf/', '/abs/')
      }
    }
    
    // Could not determine HTML URL for this publisher
    return null
    
  } catch (error) {
    console.warn(`Failed to parse PDF URL for conversion: ${pdfUrl}`, error)
    return null
  }
}

/**
 * Get publisher-specific headers for HTML fetching
 */
function getHtmlHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'no-cache',
  }
  
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    
    // Add referer for publishers that check it
    if (hostname.includes('wiley.com')) {
      headers['Referer'] = 'https://onlinelibrary.wiley.com/'
      headers['Origin'] = 'https://onlinelibrary.wiley.com'
    } else if (hostname.includes('sciencedirect.com') || hostname.includes('elsevier.com')) {
      headers['Referer'] = 'https://www.sciencedirect.com/'
      headers['Origin'] = 'https://www.sciencedirect.com'
    } else if (hostname.includes('springer') || hostname.includes('nature.com')) {
      headers['Referer'] = `https://${hostname}/`
    } else if (hostname.includes('frontiersin.org')) {
      headers['Referer'] = 'https://www.frontiersin.org/'
    } else if (hostname.includes('mdpi.com')) {
      headers['Referer'] = 'https://www.mdpi.com/'
    }
    
  } catch {
    // Use default headers if URL parsing fails
  }
  
  return headers
}

/**
 * Strip HTML tags and normalize whitespace
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract article content from an HTML page URL
 * 
 * @param url - The HTML article URL to extract from
 * @param timeoutMs - Request timeout in milliseconds (default: 30000)
 * @returns Extracted content or null if extraction failed
 */
export async function extractArticleHtml(
  url: string,
  timeoutMs: number = 30000
): Promise<HtmlExtractionResult | null> {
  ensureTransformationsInitialized()
  
  console.log(`📰 Attempting HTML extraction from: ${url}`)
  
  try {
    const article = await extract(url, {
      contentLengthThreshold: 500, // Minimum chars for valid content
      descriptionLengthThreshold: 100,
    }, {
      headers: getHtmlHeaders(url),
      signal: AbortSignal.timeout(timeoutMs),
    })
    
    if (!article) {
      console.warn(`HTML extraction returned null for: ${url}`)
      return null
    }
    
    // Extract plain text from HTML content
    // The library returns HTML in `content`, we need to strip it for chunking
    let content = ''
    
    if (article.content) {
      content = stripHtml(article.content)
    }
    
    // Validate content length
    if (content.length < 500) {
      console.warn(`HTML extraction content too short (${content.length} chars) for: ${url}`)
      return null
    }
    
    // Truncate extremely long content (unlikely for articles, but safety measure)
    if (content.length > 1_000_000) {
      content = content.slice(0, 1_000_000)
    }
    
    console.log(`✅ HTML extraction successful: ${content.length} chars from ${url}`)
    
    return {
      content,
      title: article.title || undefined,
      author: article.author || undefined,
      publishedTime: article.published || undefined,
      contentSource: 'html',
    }
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`❌ HTML extraction failed for ${url}:`, errorMsg)
    return null
  }
}

/**
 * Check if a URL is from a supported publisher for HTML extraction
 */
export function isSupportedPublisher(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    
    const supportedPatterns = [
      'wiley.com',
      'sciencedirect.com',
      'elsevier.com',
      'springer',
      'nature.com',
      'plos',
      'mdpi.com',
      'frontiersin.org',
      'ncbi.nlm.nih.gov',
      'europepmc.org',
      'arxiv.org',
    ]
    
    return supportedPatterns.some(pattern => hostname.includes(pattern))
  } catch {
    return false
  }
}

/**
 * Attempt HTML extraction as fallback when PDF download fails
 * 
 * @param pdfUrl - Original PDF URL that failed
 * @param timeoutMs - Request timeout
 * @returns Extracted content or null
 */
export async function tryHtmlFallback(
  pdfUrl: string,
  timeoutMs: number = 30000
): Promise<HtmlExtractionResult | null> {
  // Convert PDF URL to HTML URL
  const htmlUrl = convertPdfUrlToHtmlUrl(pdfUrl)
  
  if (!htmlUrl) {
    console.log(`📄 No HTML URL conversion available for: ${pdfUrl}`)
    return null
  }
  
  console.log(`📄 Converted PDF URL to HTML: ${pdfUrl} → ${htmlUrl}`)
  
  return extractArticleHtml(htmlUrl, timeoutMs)
}
