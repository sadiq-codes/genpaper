import { extractPdfMetadataTiered } from '@/lib/pdf/tiered-extractor'
import { downloadPdfBuffer, getPDFContent } from '@/lib/pdf/pdf-utils'
import { getSB } from '@/lib/supabase/server'

export interface PdfExtractionOptions {
  pdfUrl: string
  paperId?: string // existing DB id if known
  ocr?: boolean
  timeoutMs?: number
}

/**
 * Unified helper to obtain full text for a paper's PDF.
 * - If paperId provided and chunks exist: returns null (indicates skip)
 * - Else if stored pdf_content exists: returns it
 * - Else downloads and extracts via tiered extractor (GROBID → text-layer → OCR)
 *   and persists pdf_content when paperId provided.
 */
export async function getOrExtractFullText(options: PdfExtractionOptions): Promise<string | null> {
  const { pdfUrl, paperId, ocr = true, timeoutMs = 60000 } = options

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

  // 3) Download and extract
  const pdfBuffer = await downloadPdfBuffer(pdfUrl)
  const extraction = await extractPdfMetadataTiered(pdfBuffer, {
    enableOcr: ocr,
    maxTimeoutMs: timeoutMs,
    grobidUrl: process.env.GROBID_URL || 'http://localhost:8070'
  })

  const text = extraction.fullText && extraction.fullText.length > 100
    ? extraction.fullText.slice(0, 1_000_000)
    : null

  // Persist pdf_content for future reuse
  if (paperId && text) {
    try {
      const supabase = await getSB()
      await supabase.from('papers').update({ pdf_content: text }).eq('id', paperId)
    } catch {
      // non-fatal
    }
  }

  return text
}


