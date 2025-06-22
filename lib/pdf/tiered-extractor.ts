/**
 * Modern Tiered PDF Extraction System (2024-25 Best Practices)
 * 
 * Tier 1: GROBID (70-80% of papers) - Scientific PDF specialist
 * Tier 2: pdf.js text layer (10% weird encoding)
 * Tier 3: OCR (10-20% scanned PDFs)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { debug } from '@/lib/utils/logger'
import FormData from 'form-data'
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
    enableOcr = false,
    maxTimeoutMs = 30000
  } = options

  const notes: string[] = []

  try {
    // 0️⃣ Fast DOI lookup shortcut (if DOI found in first page)
    const doi = await findDoiInFirstPage(pdfBuffer)
    if (doi) {
      debug.info('Found DOI in PDF, attempting Crossref lookup', { doi })
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
      debug.info('Attempting GROBID extraction')
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
      debug.warn('GROBID extraction failed, falling back to text layer', { error })
    }

    // 2️⃣ Fallback to pdf.js text layer
    const isScanned = await isScannedPDF(pdfBuffer)
    if (!isScanned) {
      try {
        debug.info('Attempting text layer extraction')
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
      } catch (error) {
        notes.push(`Text layer extraction failed: ${error}`)
        debug.warn('Text layer extraction failed', { error })
      }
    } else {
      notes.push('PDF appears to be scanned (no text layer)')
    }

    // 3️⃣ OCR fallback (only if enabled and needed)
    if (enableOcr) {
      try {
        debug.info('Attempting OCR extraction')
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
      } catch (error) {
        notes.push(`OCR extraction failed: ${error}`)
        debug.error('OCR extraction failed', { error })
      }
    } else {
      notes.push('OCR disabled, skipping scanned PDF processing')
    }

    // 4️⃣ Final fallback - minimal extraction
    debug.warn('All extraction methods failed, using fallback')
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

  } catch (error) {
    debug.error('Tiered extraction completely failed', { error })
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
    const form = new FormData()
    form.append('input', pdfBuffer, {
      filename: 'paper.pdf',
      contentType: 'application/pdf'
    })
    form.append('includeRawCitations', '1')
    form.append('includeRawAffiliations', '1')

    const response = await fetch(`${grobidUrl}/api/processFulltextDocument`, {
      method: 'POST',
      body: form as any,
      signal: controller.signal
    })

    if (!response.ok) {
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
    const pdfParse = await import('pdf-parse').then(m => m.default || m)
    const data = await pdfParse(pdfBuffer)

    if (!data.text || data.text.length < 50) {
      throw new Error('Text layer extraction returned minimal content')
    }

    // Extract metadata from text
    const lines = data.text.split('\n').filter(line => line.trim().length > 0)
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

  } catch (error) {
    debug.error('Text layer parsing failed', { error })
    return null
  }
}

/**
 * Check if PDF is scanned (no text layer)
 */
async function isScannedPDF(pdfBuffer: Buffer): Promise<boolean> {
  try {
    // Try to get text content from first page
    const pdfParse = await import('pdf-parse').then(m => m.default || m)
    const data = await pdfParse(pdfBuffer, { max: 1 }) // Only first page
    
    const textLen = data.text ? data.text.trim().length : 0
    const avgCharsPerPage = textLen / (data.numpages || 1)

    // Consider scanned if multi-page PDF has very low text density
    return (data.numpages ?? 0) >= 4 && avgCharsPerPage < 80
  } catch {
    return true // Assume scanned if can't parse
  }
}

/**
 * OCR extraction (Tier 3) - placeholder for AWS Textract/Google Document AI
 */
async function ocrParse(
  _pdfBuffer: Buffer, 
  _timeoutMs: number
): Promise<Partial<TieredExtractionResult> | null> {
  // TODO: Implement OCR service integration
  // Options: AWS Textract, Google Document AI, or Tesseract + LayoutParser
  void _pdfBuffer; // avoid unused-var lint
  void _timeoutMs;
  debug.warn('OCR extraction not yet implemented')
  return null
}

/**
 * Find DOI in first page of PDF
 */
async function findDoiInFirstPage(pdfBuffer: Buffer): Promise<string | null> {
  try {
    const pdfParse = await import('pdf-parse').then(m => m.default || m)
    const data = await pdfParse(pdfBuffer, { max: 1 })
    return extractDoiFromText(data.text)
  } catch {
    return null
  }
}

/**
 * Fetch metadata from Crossref API using DOI
 */
async function fetchCrossrefMetadata(doi: string): Promise<Partial<TieredExtractionResult> | null> {
  try {
    const response = await fetch(`https://api.crossref.org/works/${doi}`)
    if (!response.ok) return null

    const data = await response.json()
    const work = data.message

    return {
      title: work.title?.[0] || 'Unknown Title',
      authors: work.author?.map((a: any) => `${a.given || ''} ${a.family || ''}`.trim()) || [],
      abstract: work.abstract || undefined,
      venue: work['container-title']?.[0] || undefined,
      doi: work.DOI,
      year: work.published?.['date-parts']?.[0]?.[0]?.toString(),
      fullText: `${work.title?.[0] || ''}\n\n${work.abstract || ''}`.trim()
    }
  } catch {
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

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  let teiJson: any
  try {
    teiJson = parser.parse(xml)
  } catch (e) {
    debug.error('TEI XML parse error', { error: e })
    return {}
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  const TEI: any = teiJson.TEI || teiJson.tei || teiJson

  const safeGet = (...paths: string[]): string | null | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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