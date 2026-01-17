import { extractPdfMetadataTiered } from '@/lib/pdf/tiered-extractor'
import { downloadPdfBuffer, getPDFContent } from '@/lib/pdf/pdf-utils'
import { getSB } from '@/lib/supabase/server'

export interface PdfExtractionOptions {
  pdfUrl: string
  paperId?: string // existing DB id if known
  ocr?: boolean
  timeoutMs?: number
  maxRetries?: number
}

/**
 * Download PDF with retry logic and exponential backoff
 */
async function downloadWithRetry(
  url: string, 
  maxRetries: number = 3
): Promise<Buffer> {
  let lastError: Error | null = null
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await downloadPdfBuffer(url)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      
      // Don't retry for certain error types
      const errorMsg = lastError.message.toLowerCase()
      if (
        errorMsg.includes('html page') ||
        errorMsg.includes('invalid pdf') ||
        errorMsg.includes('too large') ||
        errorMsg.includes('http 4')  // 4xx errors (not found, forbidden, etc.)
      ) {
        throw lastError
      }
      
      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s...
        const delay = 2000 * Math.pow(2, attempt - 1)
        console.log(`⚠️ PDF download attempt ${attempt}/${maxRetries} failed, retrying in ${delay/1000}s...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError || new Error('PDF download failed after retries')
}

/**
 * Unified helper to obtain full text for a paper's PDF.
 * - If paperId provided and chunks exist: returns null (indicates skip)
 * - Else if stored pdf_content exists: returns it
 * - Else downloads and extracts via tiered extractor (GROBID → text-layer → OCR)
 *   and persists pdf_content when paperId provided.
 */
export async function getOrExtractFullText(options: PdfExtractionOptions): Promise<string | null> {
  const { pdfUrl, paperId, ocr = true, timeoutMs = 60000, maxRetries = 3 } = options

  // 1) If we have a DB id, skip only if paper has full-text content (≥5 chunks)
  if (paperId) {
    const supabase = await getSB()
    const { count: chunkCount, error } = await supabase
      .from('paper_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('paper_id', paperId)
    
    if (!error && chunkCount && chunkCount >= 5) {
      console.log(`PDF extraction skipped - paper already has full content (${chunkCount} chunks)`)
      return null // indicates no need to extract again
    } else if (!error && chunkCount && chunkCount > 0) {
      console.log(`PDF extraction proceeding - upgrading paper with ${chunkCount} chunks`)
    }
  }

  // 2) Prefer stored pdf_content when available
  if (paperId) {
    const stored = await getPDFContent(paperId)
    if (stored && stored.length > 200) return stored
  }

  // 3) Download with retry logic and extract
  const pdfBuffer = await downloadWithRetry(pdfUrl, maxRetries)
  const extraction = await extractPdfMetadataTiered(pdfBuffer, {
    enableOcr: ocr,
    maxTimeoutMs: timeoutMs,
    grobidUrl: process.env.GROBID_URL || 'http://localhost:8070'
  })

  const text = extraction.fullText && extraction.fullText.length > 100
    ? extraction.fullText.slice(0, 1_000_000)
    : null

  // Persist pdf_content for future reuse (non-critical)
  if (paperId && text) {
    try {
      const supabase = await getSB()
      await supabase.from('papers').update({ pdf_content: text }).eq('id', paperId)
    } catch (err) {
      console.warn(`Failed to persist PDF content for paper ${paperId}:`, err instanceof Error ? err.message : String(err))
    }
  }

  return text
}


