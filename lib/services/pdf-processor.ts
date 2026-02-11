import { extractPdfMetadataTiered } from '@/lib/pdf/tiered-extractor'
import { downloadPdfBuffer } from '@/lib/pdf/pdf-utils'
import { getSB } from '@/lib/supabase/server'
import { tryHtmlFallback } from '@/lib/content/html-extractor'

export type ContentSource = 'pdf' | 'html' | 'abstract-only'

export interface PdfExtractionOptions {
  pdfUrl: string
  paperId?: string // existing DB id if known
  ocr?: boolean
  timeoutMs?: number
  maxRetries?: number
  enableHtmlFallback?: boolean // Enable HTML extraction when PDF fails (default: true)
}

export interface ExtractionResult {
  content: string | null
  contentSource: ContentSource | null
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
 * Check if an error indicates PDF is behind paywall or returns HTML landing page
 */
function isPdfBlockedError(error: Error): boolean {
  const msg = error.message.toLowerCase()
  return (
    msg.includes('html page') ||
    msg.includes('html content') ||
    msg.includes('landing page') ||
    msg.includes('http 403') ||
    msg.includes('http 401') ||
    msg.includes('forbidden') ||
    msg.includes('unauthorized') ||
    msg.includes('subscription') ||
    msg.includes('paywall')
  )
}

/**
 * Update the content_source field for a paper
 */
async function updateContentSource(paperId: string, source: ContentSource): Promise<void> {
  try {
    const supabase = await getSB()
    await supabase.from('papers').update({ content_source: source }).eq('id', paperId)
  } catch (err) {
    console.warn(`Failed to update content_source for paper ${paperId}:`, err instanceof Error ? err.message : String(err))
  }
}

/**
 * Unified helper to obtain full text for a paper's PDF.
 * - If paperId provided and chunks exist: returns null (indicates skip)
 * - Else if stored pdf_content exists: returns it
 * - Else downloads and extracts via tiered extractor (GROBID → text-layer → OCR)
 * - If PDF fails with paywall/403, attempts HTML extraction as fallback
 * - Persists pdf_content and content_source when paperId provided.
 */
export async function getOrExtractFullText(options: PdfExtractionOptions): Promise<string | null> {
  const { pdfUrl, paperId, ocr = true, timeoutMs = 60000, maxRetries = 3, enableHtmlFallback = true } = options

  // NOTE: The pdf_content check is done UPSTREAM in paper-aggregation.ts
  // This function is called when we've already decided we need to extract content
  // (either new paper or explicit user request to re-download)

  // Try PDF download and extraction first
  try {
    const pdfBuffer = await downloadWithRetry(pdfUrl, maxRetries)
    const extraction = await extractPdfMetadataTiered(pdfBuffer, {
      enableOcr: ocr,
      maxTimeoutMs: timeoutMs,
      grobidUrl: process.env.GROBID_URL || 'http://localhost:8070'
    })

    const text = extraction.fullText && extraction.fullText.length > 100
      ? extraction.fullText.slice(0, 1_000_000)
      : null

    // Persist pdf_content and content_source for future reuse
    if (paperId && text) {
      try {
        const supabase = await getSB()
        await supabase.from('papers').update({ 
          pdf_content: text,
          content_source: 'pdf' 
        }).eq('id', paperId)
      } catch (err) {
        console.warn(`Failed to persist PDF content for paper ${paperId}:`, err instanceof Error ? err.message : String(err))
      }
    }

    return text
    
  } catch (pdfError) {
    const error = pdfError instanceof Error ? pdfError : new Error(String(pdfError))
    
    // 4) If PDF is blocked/paywalled, try HTML extraction as fallback
    if (enableHtmlFallback && isPdfBlockedError(error)) {
      console.log(`📄 PDF blocked for ${pdfUrl}, attempting HTML fallback...`)
      
      try {
        const htmlResult = await tryHtmlFallback(pdfUrl, timeoutMs)
        
        if (htmlResult?.content && htmlResult.content.length > 200) {
          console.log(`✅ HTML fallback successful: ${htmlResult.content.length} chars extracted`)
          
          // Persist html content and update content_source
          if (paperId) {
            try {
              const supabase = await getSB()
              await supabase.from('papers').update({ 
                pdf_content: htmlResult.content,
                content_source: 'html' 
              }).eq('id', paperId)
            } catch (err) {
              console.warn(`Failed to persist HTML content for paper ${paperId}:`, err instanceof Error ? err.message : String(err))
            }
          }
          
          return htmlResult.content
        } else {
          console.warn(`HTML fallback returned insufficient content for ${pdfUrl}`)
        }
      } catch (htmlError) {
        console.warn(`HTML fallback failed for ${pdfUrl}:`, htmlError instanceof Error ? htmlError.message : String(htmlError))
      }
    }
    
    // Re-throw the original PDF error if HTML fallback wasn't attempted or failed
    throw error
  }
}

/**
 * Get full text with content source information
 * Use this when you need to know where the content came from
 */
export async function getOrExtractFullTextWithSource(options: PdfExtractionOptions): Promise<ExtractionResult> {
  const { pdfUrl, paperId, ocr = true, timeoutMs = 60000, maxRetries = 3, enableHtmlFallback = true } = options

  // NOTE: The pdf_content check is done UPSTREAM in paper-aggregation.ts
  // This function is called when we've already decided we need to extract content

  // Try PDF extraction
  try {
    const pdfBuffer = await downloadWithRetry(pdfUrl, maxRetries)
    const extraction = await extractPdfMetadataTiered(pdfBuffer, {
      enableOcr: ocr,
      maxTimeoutMs: timeoutMs,
      grobidUrl: process.env.GROBID_URL || 'http://localhost:8070'
    })

    const text = extraction.fullText && extraction.fullText.length > 100
      ? extraction.fullText.slice(0, 1_000_000)
      : null

    if (paperId && text) {
      await updateContentSource(paperId, 'pdf')
      const supabase = await getSB()
      await supabase.from('papers').update({ pdf_content: text }).eq('id', paperId)
    }

    return { content: text, contentSource: text ? 'pdf' : null }
    
  } catch (pdfError) {
    const error = pdfError instanceof Error ? pdfError : new Error(String(pdfError))
    
    if (enableHtmlFallback && isPdfBlockedError(error)) {
      console.log(`📄 PDF blocked, attempting HTML fallback...`)
      
      try {
        const htmlResult = await tryHtmlFallback(pdfUrl, timeoutMs)
        
        if (htmlResult?.content && htmlResult.content.length > 200) {
          if (paperId) {
            await updateContentSource(paperId, 'html')
            const supabase = await getSB()
            await supabase.from('papers').update({ pdf_content: htmlResult.content }).eq('id', paperId)
          }
          
          return { content: htmlResult.content, contentSource: 'html' }
        }
      } catch (htmlError) {
        console.warn(`HTML fallback failed:`, htmlError instanceof Error ? htmlError.message : String(htmlError))
      }
    }
    
    throw error
  }
}


