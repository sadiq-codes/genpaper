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

  // 1) If we have a DB id, skip if chunks already exist
  if (paperId) {
    const supabase = await getSB()
    const { data: existing, error } = await supabase
      .from('paper_chunks')
      .select('id')
      .eq('paper_id', paperId)
      .limit(1)
    if (!error && existing && existing.length > 0) {
      return null // indicates no need to extract again
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


