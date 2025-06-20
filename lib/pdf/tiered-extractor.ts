/**
 * Modern Tiered PDF Extraction System (2024-25 Best Practices)
 * 
 * Tier 1: GROBID (70-80% of papers) - Scientific PDF specialist
 * Tier 2: pdf.js text layer (10% weird encoding)
 * Tier 3: OCR (10-20% scanned PDFs)
 */

import { debug } from '@/lib/utils/logger'

export interface TieredExtractionResult {
  title?: string
  authors?: string[]
  abstract?: string
  venue?: string
  doi?: string
  year?: string
  fullText?: string
  contentChunks?: string[]
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
    trimToTokens?: number
  } = {}
): Promise<TieredExtractionResult> {
  const startTime = Date.now()
  const { 
    grobidUrl = process.env.GROBID_URL || 'http://localhost:8070',
    enableOcr = false,
    maxTimeoutMs = 30000,
    trimToTokens = 4000
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
        const chunks = await chunkTextOptimized(grobidResult.fullText, trimToTokens)
        return {
          ...grobidResult,
          contentChunks: chunks,
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
        const textLayerResult = await parseTextLayer(pdfBuffer)
        if (textLayerResult && textLayerResult.fullText) {
          const chunks = await chunkTextOptimized(textLayerResult.fullText, trimToTokens)
          return {
            ...textLayerResult,
            contentChunks: chunks,
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
        const ocrResult = await ocrParse(pdfBuffer, maxTimeoutMs)
        if (ocrResult && ocrResult.fullText) {
          const chunks = await chunkTextOptimized(ocrResult.fullText, trimToTokens)
          return {
            ...ocrResult,
            contentChunks: chunks,
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
      contentChunks: ['PDF content extraction failed'],
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
      contentChunks: ['Critical error during PDF processing'],
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
    form.set('input', new Blob([pdfBuffer]), 'paper.pdf')
    form.set('includeRawCitations', '1')
    form.set('includeRawAffiliations', '1')

    const response = await fetch(`${grobidUrl}/api/processFulltextDocument`, {
      method: 'POST',
      body: form,
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
      abstract,
      doi,
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
    
    // If very little text found, likely scanned
    return !data.text || data.text.trim().length < 100
  } catch {
    return true // Assume scanned if can't parse
  }
}

/**
 * OCR extraction (Tier 3) - placeholder for AWS Textract/Google Document AI
 */
async function ocrParse(
  pdfBuffer: Buffer, 
  timeoutMs: number
): Promise<Partial<TieredExtractionResult> | null> {
  // TODO: Implement OCR service integration
  // Options: AWS Textract, Google Document AI, or Tesseract + LayoutParser
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

/**
 * Optimized text chunking for RAG
 */
async function chunkTextOptimized(text: string, maxTokens: number): Promise<string[]> {
  // Trim to maxTokens first (abstract + intro gives best retrieval)
  const trimmed = text.substring(0, maxTokens * 4) // Rough char-to-token ratio
  
  // Split into meaningful chunks
  const chunks: string[] = []
  const sentences = trimmed.split(/[.!?]+/).filter(s => s.trim().length > 0)
  
  let currentChunk = ''
  const maxChunkSize = 1000
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim()
    if (currentChunk.length + trimmedSentence.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim())
        currentChunk = trimmedSentence
      }
    } else {
      currentChunk += (currentChunk ? '. ' : '') + trimmedSentence
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim())
  }
  
  return chunks.filter(chunk => chunk.length > 50)
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
  // TODO: Implement proper TEI XML parsing
  // For now, extract basic info with regex (replace with proper XML parser)
  
  const titleMatch = xml.match(/<title[^>]*>([^<]+)<\/title>/i)
  const abstractMatch = xml.match(/<abstract[^>]*>([^<]+)<\/abstract>/i)
  
  // Extract body text (simplified)
  const bodyMatch = xml.match(/<body[^>]*>(.*?)<\/body>/is)
  const bodyText = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''
  
  return {
    title: titleMatch ? titleMatch[1].trim() : undefined,
    abstract: abstractMatch ? abstractMatch[1].trim() : undefined,
    fullText: bodyText || undefined,
    authors: [] // TODO: Extract from TEI
  }
} 