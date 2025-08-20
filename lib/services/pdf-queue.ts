/**
 * Simplified PDF Processing - Direct Processing Only
 * Removed complex queue, retry logic, quotas, and realtime updates
 */

import { extractPdfMetadataTiered } from '@/lib/pdf/tiered-extractor'
import { downloadPdfBuffer } from '@/lib/pdf/pdf-utils'
// eslint-disable-next-line no-restricted-imports
import { getSB } from '@/lib/supabase/server'
import { createChunksForPaper } from '@/lib/content/ingestion'

/**
 * Simple PDF processor - direct processing without queue complexity
 */
export class SimplePDFProcessor {
  /**
   * Process PDF directly - no queue, no retry, simple extraction
   */
  static async processPDF(
    paperId: string,
    pdfUrl: string,
    paperTitle: string
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      console.log(`🔄 Processing PDF for paper: ${paperTitle}`)
      
      // Download PDF
      const pdfBuffer = await downloadPdfBuffer(pdfUrl)
      
      // Extract content using correct API
      const result = await extractPdfMetadataTiered(pdfBuffer, {
        enableOcr: true, // Enable OCR for better text extraction
        maxTimeoutMs: 60000 // Increased timeout for OCR processing
      })
      
      if (result.fullText && result.fullText.length > 100) {
        console.log(`✅ PDF processed successfully: ${result.fullText.length} chars`)
        
        // Persist PDF content to database
        const supabase = await getSB()
        const { error: updateError } = await supabase
          .from('papers')
          .update({ pdf_content: result.fullText })
          .eq('id', paperId)
        
        if (updateError) {
          console.warn(`⚠️ Failed to save PDF content to database for ${paperId}:`, updateError)
        } else {
          console.log(`📄 Saved PDF content to database for ${paperId}`)
        }
        
        // Create chunks immediately for coverage calculation
        try {
          const chunksCreated = await createChunksForPaper(paperId, result.fullText)
          console.log(`📚 Created ${chunksCreated} chunks for paper ${paperId}`)
        } catch (chunkError) {
          console.warn(`⚠️ Failed to create chunks for ${paperId}:`, chunkError)
          // Don't fail the whole operation if chunking fails
        }
        
        return {
          success: true,
          content: result.fullText
        }
      } else {
        throw new Error(`PDF extraction returned insufficient content: ${result.fullText?.length || 0} chars`)
      }
    } catch (error) {
      console.error(`❌ PDF processing failed for ${paperTitle}:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

// Simplified PDF processing interface - no queue complexity
export const pdfQueue = {
  addJob: async (
    paperId: string, 
    pdfUrl: string, 
    paperTitle: string, 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId?: string,  // Ignored in simplified implementation
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _priority?: 'low' | 'normal' | 'high'  // Ignored in simplified implementation
  ) => {
    const result = await SimplePDFProcessor.processPDF(paperId, pdfUrl, paperTitle)
    return result.success ? 'completed' : 'failed'
  }
}