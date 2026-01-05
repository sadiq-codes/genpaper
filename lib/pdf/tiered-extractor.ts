/**
 * Modern Tiered PDF Extraction System (2024-25 Best Practices)
 * 
 * Tier 1: GROBID (70-80% of papers) - Scientific PDF specialist
 * Tier 2: pdf.js text layer (10% weird encoding)
 * Tier 3: OCR (10-20% scanned PDFs)
 */

 
import { info, warn, error } from '@/lib/utils/logger'
// Using native FormData instead of form-data package
// import FormData from 'form-data'
import { XMLParser } from 'fast-xml-parser'

export interface TieredExtractionResult {
  title?: string
  authors?: string[]
  abstract?: string
  venue?: string
  doi?: string
  year?: string
  fullText?: string
  extractionMethod: 'grobid' | 'text-layer' | 'ocr' | 'doi-lookup' | 'fallback'
  extractionTimeMs: number
  confidence: 'high' | 'medium' | 'low'
  metadata?: {
    wordCount?: number
    pageCount?: number
    isScanned?: boolean
    grobidXml?: string
    processingNotes?: string[]
  }
}

/**
 * Main orchestrator - tries extraction methods in order of effectiveness
 */
export async function extractPdfMetadataTiered(
  pdfBuffer: Buffer,
  options: {
    grobidUrl?: string
    enableOcr?: boolean
    maxTimeoutMs?: number
  } = {}
): Promise<TieredExtractionResult> {
  const startTime = Date.now()
  const { 
    grobidUrl = process.env.GROBID_URL || 'http://localhost:8070',
    enableOcr = true,
    maxTimeoutMs = 30000
  } = options

  const notes: string[] = []

  try {
    // Guardrail: decide if we should attempt GROBID at all
    const tryGrobid = await shouldUseGrobid(grobidUrl)

    // 0️⃣ Fast DOI lookup shortcut (if DOI found in first page)
    const doi = await findDoiInFirstPage(pdfBuffer)
    if (doi) {
      info('Found DOI in PDF, attempting Crossref lookup', { doi })
      try {
        const crossrefData = await fetchCrossrefMetadata(doi)
        if (crossrefData) {
          return {
            ...crossrefData,
            extractionMethod: 'doi-lookup',
            extractionTimeMs: Date.now() - startTime,
            confidence: 'high',
            metadata: { processingNotes: ['DOI found, used Crossref API'] }
          }
        }
      } catch (error) {
        notes.push(`DOI lookup failed: ${error}`)
      }
    }

    // 1️⃣ Try GROBID first (best for scientific PDFs)
    try {
      if (!tryGrobid) {
        notes.push('GROBID disabled or unavailable; skipping')
        throw new Error('GROBID disabled')
      }
      info('Attempting GROBID extraction')
      const grobidResult = await grobidParse(pdfBuffer, grobidUrl, maxTimeoutMs)
      if (grobidResult && grobidResult.title && grobidResult.fullText) {
        return {
          ...grobidResult,
          extractionMethod: 'grobid',
          extractionTimeMs: Date.now() - startTime,
          confidence: 'high',
          metadata: {
            ...grobidResult.metadata,
            processingNotes: ['GROBID extraction successful']
          }
        }
      }
      notes.push('GROBID returned incomplete data')
    } catch (error) {
      notes.push(`GROBID failed: ${error}`)
      warn('GROBID extraction failed, falling back to text layer', { error })
    }

    // 2️⃣ Fallback to pdf.js text layer
    const isScanned = await isScannedPDF(pdfBuffer)
    info(`PDF scan check result: isScanned=${isScanned}`)
    
    if (!isScanned) {
      try {
        info('Attempting text layer extraction')
        const textLayerResult = await withTimeout(() => parseTextLayer(pdfBuffer), maxTimeoutMs)
        if (textLayerResult && textLayerResult.fullText) {
          return {
            ...textLayerResult,
            extractionMethod: 'text-layer',
            extractionTimeMs: Date.now() - startTime,
            confidence: 'medium',
            metadata: {
              ...textLayerResult.metadata,
              isScanned: false,
              processingNotes: [...notes, 'Text layer extraction successful']
            }
          }
        }
        warn('Text layer extraction returned no content')
      } catch (error) {
        notes.push(`Text layer extraction failed: ${error}`)
        warn('Text layer extraction failed', { error })
      }
    } else {
      info('PDF appears to be scanned (no text layer), skipping text extraction')
      notes.push('PDF appears to be scanned (no text layer)')
    }

    // 3️⃣ OCR fallback (only if enabled and needed)
    if (enableOcr) {
      try {
        info('Attempting OCR extraction')
        const ocrResult = await withTimeout(() => ocrParse(pdfBuffer, maxTimeoutMs), maxTimeoutMs)
        if (ocrResult && ocrResult.fullText) {
          return {
            ...ocrResult,
            extractionMethod: 'ocr',
            extractionTimeMs: Date.now() - startTime,
            confidence: 'low',
            metadata: {
              ...ocrResult.metadata,
              isScanned: true,
              processingNotes: [...notes, 'OCR extraction successful']
            }
          }
        }
      } catch (err) {
        notes.push(`OCR extraction failed: ${err}`)
        error('OCR extraction failed', { error: err })
      }
    } else {
      notes.push('OCR disabled by option, skipping scanned PDF processing')
    }

    // 4️⃣ Final fallback - minimal extraction
    warn('All extraction methods failed, using fallback')
    return {
      title: 'Extraction Failed',
      authors: ['Unknown'],
      abstract: 'PDF content extraction failed',
      fullText: 'PDF content extraction failed',
      extractionMethod: 'fallback',
      extractionTimeMs: Date.now() - startTime,
      confidence: 'low',
      metadata: {
        processingNotes: [...notes, 'All extraction methods failed']
      }
    }

  } catch (err) {
    error('Tiered extraction completely failed', { error: err })
    return {
      title: 'Critical Extraction Error',
      authors: ['Unknown'],
      abstract: 'Critical error during PDF processing',
      fullText: 'Critical error during PDF processing',
      extractionMethod: 'fallback',
      extractionTimeMs: Date.now() - startTime,
      confidence: 'low',
      metadata: {
        processingNotes: [...notes, `Critical error: ${error}`]
      }
    }
  }
}

// Quick check whether GROBID is enabled/available
async function shouldUseGrobid(grobidUrl: string): Promise<boolean> {
  // Respect explicit disable
  if (process.env.ENABLE_GROBID === '0') return false
  // Respect explicit enable
  if (process.env.ENABLE_GROBID === '1') return true
  // Try a quick health check
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(`${grobidUrl}/api/isalive`, { signal: controller.signal })
    clearTimeout(timeout)
    return res.ok
  } catch (err) {
    warn('GROBID health check failed', { error: err })
    return false
  }
}

/**
 * GROBID extraction (Tier 1)
 */
async function grobidParse(
  pdfBuffer: Buffer, 
  grobidUrl: string, 
  timeoutMs: number
): Promise<Partial<TieredExtractionResult> | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // Validate PDF buffer
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('PDF buffer is empty or null')
    }
    
    if (pdfBuffer.length < 1024) {
      throw new Error(`PDF buffer too small: ${pdfBuffer.length} bytes`)
    }
    
    // Check PDF header
    const header = pdfBuffer.subarray(0, 4).toString()
    if (!header.startsWith('%PDF')) {
      throw new Error(`Invalid PDF header: ${header}`)
    }

    // Convert Buffer to Blob for native FormData
    const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' })
    
    const form = new FormData()
    form.append('input', pdfBlob, 'paper.pdf')
    form.append('includeRawCitations', '1')
    form.append('includeRawAffiliations', '1')

    // Debug logging
    console.log('GROBID request details:')
    console.log('- URL:', `${grobidUrl}/api/processFulltextDocument`)
    console.log('- PDF buffer size:', pdfBuffer.length)
    console.log('- PDF header:', header)
    console.log('- Form data fields: input, includeRawCitations, includeRawAffiliations')
    console.log('- Using native FormData with Blob')

    const response = await fetch(`${grobidUrl}/api/processFulltextDocument`, {
      method: 'POST',
      body: form,
      // Don't set Content-Type header - let fetch handle it automatically for FormData
      signal: controller.signal
    })

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`GROBID request failed with status ${response.status}`);
      console.error(`Error body: ${errorBody}`);
      console.error(`Request used native FormData with PDF blob`);
      throw new Error(`GROBID HTTP ${response.status}: ${response.statusText}`)
    }

    const xml = await response.text()
    if (!xml || xml.length < 100) {
      throw new Error('GROBID returned empty or minimal response')
    }

    // Parse TEI XML to extract structured data
    const parsed = await parseTeiXml(xml)
    
    return {
      ...parsed,
      metadata: {
        grobidXml: xml.substring(0, 5000), // Store first 5KB for debugging
        wordCount: parsed.fullText?.split(/\s+/).length || 0
      }
    }

  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Text layer extraction (Tier 2)
 */
async function parseTextLayer(pdfBuffer: Buffer): Promise<Partial<TieredExtractionResult> | null> {
  try {
    // Dynamic import to handle different environments
    const pdfParseModule = await import('pdf-parse')
    const pdfParse = pdfParseModule.default || pdfParseModule
    
    // Ensure we're passing a proper Buffer
    if (!Buffer.isBuffer(pdfBuffer)) {
      throw new Error('Invalid PDF buffer provided to parseTextLayer')
    }
    
    info(`Attempting pdf-parse with buffer size: ${pdfBuffer.length}`)
    const data = await pdfParse(pdfBuffer as unknown as Buffer, {
      // Disable internal pdf.js worker to avoid file system access
      normalizeWhitespace: true,
      disableCombineTextItems: false
    } as unknown as Record<string, unknown>)

    if (!data.text || data.text.length < 50) {
      throw new Error('Text layer extraction returned minimal content')
    }

    // Extract metadata from text
    const lines = data.text.split('\n').filter((line: string) => line.trim().length > 0)
    const title = extractTitleFromText(lines)
    const authors = extractAuthorsFromText(data.text)
    const abstract = extractAbstractFromText(data.text)
    const doi = extractDoiFromText(data.text)

    return {
      title: title || 'Untitled Paper',
      authors: authors.length > 0 ? authors : ['Unknown'],
      abstract: abstract || undefined,
      doi: doi || undefined,
      fullText: data.text,
      metadata: {
        pageCount: data.numpages,
        wordCount: data.text.split(/\s+/).length
      }
    }

  } catch (err) {
    error('Text layer parsing failed', { error: err })
    return null
  }
}

/**
 * Check if PDF is scanned (no text layer)
 */
async function isScannedPDF(pdfBuffer: Buffer): Promise<boolean> {
  try {
    // Try to get text content from first page
    const pdfParseModule = await import('pdf-parse')
    const pdfParse = pdfParseModule.default || pdfParseModule
    
    // Ensure we're passing a proper Buffer
    if (!Buffer.isBuffer(pdfBuffer)) {
      info('Invalid PDF buffer provided to isScannedPDF, assuming scanned')
      return true
    }
    
    info(`Checking if PDF is scanned with buffer size: ${pdfBuffer.length}`)
    const data = await pdfParse(pdfBuffer as unknown as Buffer, { 
      max: 1, // Only first page
      normalizeWhitespace: true,
      disableCombineTextItems: false
    } as unknown as Record<string, unknown>)
    
    const textLen = data.text ? data.text.trim().length : 0
    const avgCharsPerPage = textLen / (data.numpages || 1)
    const pageCount = data.numpages ?? 0

    info(`PDF scan detection: pages=${pageCount}, textLen=${textLen}, avgCharsPerPage=${avgCharsPerPage}`)

    // Consider scanned if multi-page PDF has very low text density
    const isScanned = pageCount >= 4 && avgCharsPerPage < 80
    info(`PDF scan result: isScanned=${isScanned} (threshold: >4 pages AND <80 chars/page)`)
    
    return isScanned
  } catch (error) {
    warn(`PDF scan detection failed, assuming NOT scanned to allow text layer attempt: ${error}`)
    return false // Changed: assume NOT scanned so text layer is attempted
  }
}

/**
 * OCR extraction (Tier 3) - Using Tesseract.js for text recognition
 */
async function ocrParse(
  pdfBuffer: Buffer, 
  _timeoutMs: number
): Promise<Partial<TieredExtractionResult> | null> {
  try {
    // OCR default enabled; allow explicit disable with ENABLE_SERVER_OCR=0
    if (typeof window === 'undefined' && process.env.ENABLE_SERVER_OCR === '0') {
      warn('OCR explicitly disabled via ENABLE_SERVER_OCR=0')
      return null
    }

    // Dynamic imports for OCR dependencies
    const { createWorker } = await import('tesseract.js')
    const pdf2picModule = await import('pdf2pic')
    const pdf2pic = pdf2picModule.default || pdf2picModule
    
    info('Starting OCR extraction process')
    
    // Convert PDF to images (first 10 pages to avoid timeout)
    const convert = pdf2pic.fromBuffer(pdfBuffer, {
      density: 200,           // Higher DPI for better OCR
      saveFilename: "page",
      savePath: "/tmp",
      format: "png",
      width: 2000,
      height: 2000
    })
    
    const maxPages = 5 // Limit to 5 pages to prevent timeout and improve reliability
    const pageImages = []
    
    // Convert first few pages to images with resilience
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      try {
        const pageResult = await convert(pageNum, { responseType: 'buffer' })
        if (pageResult.buffer) {
          pageImages.push(pageResult.buffer)
        }
      } catch (pageError) {
        warn(`Failed to convert page ${pageNum} to image:`, pageError)
        // Continue with other pages instead of breaking - one failed page shouldn't stop OCR
        continue
      }
    }
    
    if (pageImages.length === 0) {
      warn('No images could be extracted from PDF for OCR')
      return null
    }
    
    info(`Extracted ${pageImages.length} page images for OCR processing`)
    
    let worker
    try {
      // Initialize Tesseract worker with simplified configuration for better reliability
      worker = await createWorker('eng')
      
      // Optional: set timeouts to prevent long-running OCR processes
      // Note: worker.setParameters() is not available in v4+ but we can control at the page level
    } catch (workerErr) {
      warn('Failed to initialize Tesseract worker; skipping OCR', workerErr)
      return null
    }
    let fullText = ''
    
    try {
      // Process each page image with OCR and timeout protection
      for (let i = 0; i < pageImages.length; i++) {
        try {
          // Add timeout protection for individual page processing (30s per page)
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('OCR timeout')), 30000)
          )
          
          const ocrPromise = worker.recognize(pageImages[i])
          const { data: { text } } = await Promise.race([ocrPromise, timeoutPromise]) as any
          
          if (text && text.trim().length > 10) {
            fullText += text + '\n\n'
            info(`OCR completed for page ${i + 1}/${pageImages.length}`)
          } else {
            warn(`OCR returned insufficient text for page ${i + 1}`)
          }
        } catch (ocrError) {
          warn(`OCR failed for page ${i + 1}:`, ocrError)
          // Continue with remaining pages
        }
      }
    } finally {
      // Always terminate worker to prevent resource leaks
      try {
        await worker.terminate()
      } catch (terminateError) {
        warn('Failed to terminate Tesseract worker:', terminateError)
      }
    }
    
    if (fullText.trim().length < 100) {
      warn('OCR extracted insufficient text content')
      return null
    }
    
    // Extract title from first significant text
    const lines = fullText.split('\n').filter(line => line.trim().length > 5)
    const title = lines[0]?.trim() || 'OCR Extracted Document'
    
    // Extract abstract (usually in first few lines after title)
    const abstractLines = lines.slice(1, 5).join(' ').trim()
    const abstract = abstractLines.length > 50 ? abstractLines.substring(0, 500) + '...' : abstractLines
    
    info(`OCR extraction successful: ${fullText.length} characters extracted`)
    
    return {
      title,
      abstract: abstract || 'No abstract extracted via OCR',
      fullText: fullText.trim(),
      authors: [], // OCR can't reliably extract structured author data
      metadata: {
        processingNotes: [`OCR processed ${pageImages.length} pages (estimated confidence: medium)`]
      }
    }
    
  } catch (err) {
    error('OCR extraction failed completely', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/**
 * Find DOI in first page of PDF
 */
async function findDoiInFirstPage(pdfBuffer: Buffer): Promise<string | null> {
  try {
    const pdfParse = await import('pdf-parse').then(m => m.default || m)
    const data = await pdfParse(pdfBuffer, { max: 1 })
    return extractDoiFromText(data.text)
  } catch (err) {
    warn('Failed to find DOI in first page', { error: err })
    return null
  }
}

/**
 * Fetch metadata from Crossref API using DOI
 */
interface CrossrefAuthor {
  given?: string
  family?: string
}

async function fetchCrossrefMetadata(doi: string): Promise<Partial<TieredExtractionResult> | null> {
  try {
    const response = await fetch(`https://api.crossref.org/works/${doi}`)
    if (!response.ok) return null

    const data = await response.json()
    const work = data.message

    return {
      title: work.title?.[0] || 'Unknown Title',
      authors: work.author?.map((a: CrossrefAuthor) => `${a.given || ''} ${a.family || ''}`.trim()) || [],
      abstract: work.abstract || undefined,
      venue: work['container-title']?.[0] || undefined,
      doi: work.DOI,
      year: work.published?.['date-parts']?.[0]?.[0]?.toString(),
      fullText: `${work.title?.[0] || ''}\n\n${work.abstract || ''}`.trim()
    }
  } catch (err) {
    warn('Crossref metadata fetch failed', { doi, error: err })
    return null
  }
}



// Helper functions for text extraction (simplified implementations)
function extractTitleFromText(lines: string[]): string | null {
  // Look for title in first few lines
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim()
    if (line.length > 10 && line.length < 200 && !line.includes('@')) {
      return line
    }
  }
  return null
}

function extractAuthorsFromText(text: string): string[] {
  // Simple regex for author patterns
  const authorMatch = text.match(/(?:authors?|by)\s*:?\s*([^.\n]+)/i)
  if (authorMatch) {
    return authorMatch[1].split(/[,&]/).map(a => a.trim()).filter(a => a.length > 2)
  }
  return []
}

function extractAbstractFromText(text: string): string | null {
  const abstractMatch = text.match(/abstract\s*:?\s*([^.]+(?:\.[^.]*){0,10})/i)
  return abstractMatch ? abstractMatch[1].trim() : null
}

function extractDoiFromText(text: string): string | null {
  const doiMatch = text.match(/(?:doi|DOI)\s*:?\s*(10\.\d+\/[^\s]+)/i)
  return doiMatch ? doiMatch[1] : null
}

/**
 * Parse TEI XML from GROBID (simplified implementation)
 */
async function parseTeiXml(xml: string): Promise<Partial<TieredExtractionResult>> {
  // Robust TEI XML parsing using fast-xml-parser (handles entities & nested tags)
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: 'text',
    ignoreDeclaration: true
  })

  let teiJson: any
  try {
    teiJson = parser.parse(xml)
  } catch (e) {
    error('TEI XML parse error', { error: e })
    return {}
  }

   
  const TEI: any = teiJson.TEI || teiJson.tei || teiJson

  const safeGet = (...paths: string[]): string | null | undefined => {
    let node: any = TEI
    for (const key of paths) {
      if (node && Object.prototype.hasOwnProperty.call(node, key)) {
        node = node[key]
      } else {
        return undefined
      }
    }
    if (typeof node === 'string') return node
    if (node?.text) return node.text
    return undefined
  }

  const title = safeGet('teiHeader', 'fileDesc', 'titleStmt', 'title')
  const abstract = safeGet('teiHeader', 'profileDesc', 'abstract')

  // Flatten body text recursively
   
  const extractBodyText = (node: any): string => {
    if (!node) return ''
    if (typeof node === 'string') return node
    if (typeof node === 'object') {
      return Object.values(node)
        .map(extractBodyText)
        .join(' ')
    }
    return ''
  }

  const bodyObj = TEI?.text?.body
  const bodyText = extractBodyText(bodyObj).replace(/\s+/g, ' ').trim()

  return {
    title: title?.trim(),
    abstract: abstract?.trim(),
    fullText: bodyText || undefined,
    authors: [] // TODO: extract authors properly later
  }
}

// Helper to add timeout to any async operation
async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
    fn()
      .then(res => {
        clearTimeout(timer)
        resolve(res)
      })
      .catch(err => {
        clearTimeout(timer)
        reject(err)
      })
  })
} 
