/**
 * Shared PDF Utilities
 * 
 * Stateless helper functions for PDF processing.
 * Used by PDFProcessingQueue and other modules that need PDF operations.
 */

import { getSB } from '@/lib/supabase/server'

// Configuration constants
export const PDF_BUCKET = 'papers-pdfs'
export const MAX_PDF_SIZE = 50 * 1024 * 1024 // 50MB limit
export const DOWNLOAD_TIMEOUT = 30000 // 30 seconds

/**
 * Downloads PDF from URL with size and timeout limits
 */
export async function downloadPdfBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GenPaper/2.0 Academic Research Tool'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    // Check content length
    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > MAX_PDF_SIZE) {
      throw new Error(`PDF too large: ${contentLength} bytes (max: ${MAX_PDF_SIZE})`)
    }

    // Read response as buffer with size checking
    const chunks: Uint8Array[] = []
    let totalSize = 0
    
    if (!response.body) {
      throw new Error('No response body')
    }

    const reader = response.body.getReader()
    
    try {
      while (true) {
        const { done, value } = await reader.read()
        
        if (done) break
        
        totalSize += value.length
        if (totalSize > MAX_PDF_SIZE) {
          throw new Error(`PDF too large during download: ${totalSize} bytes`)
        }
        
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    // Combine chunks into single buffer
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const buffer = new Uint8Array(totalLength)
    let offset = 0
    
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.length
    }

    return Buffer.from(buffer)

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Download timeout after ${DOWNLOAD_TIMEOUT}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Uploads PDF buffer to Supabase storage
 */
export async function uploadPDFToStorage(buffer: Buffer, filename: string): Promise<string | null> {
  try {
    const supabase = await getSB()
    
    // Upload file to storage bucket
    const { data, error } = await supabase.storage
      .from(PDF_BUCKET)
      .upload(filename, buffer, {
        contentType: 'application/pdf',
        cacheControl: '3600', // Cache for 1 hour
        upsert: true // Overwrite if exists
      })

    if (error) {
      console.error('Storage upload error:', error)
      return null
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(PDF_BUCKET)
      .getPublicUrl(filename)

    return urlData.publicUrl

  } catch (error) {
    console.error('Storage error:', error)
    return null
  }
}

/**
 * Generates a unique filename for the PDF
 */
export function generatePDFFilename(doi: string, paperId: string): string {
  // Clean DOI for filename (remove special characters)
  const cleanDoi = doi
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/__+/g, '_')
    .substring(0, 100) // Limit length
  
  const timestamp = Date.now()
  return `papers/${cleanDoi}_${paperId.substring(0, 8)}_${timestamp}.pdf`
}

/**
 * Check if paper has PDF content available for chunking
 */
export async function hasPDFContent(paperId: string): Promise<boolean> {
  try {
    const supabase = await getSB()
    const { data, error } = await supabase
      .from('papers')
      .select('pdf_content, metadata')
      .eq('id', paperId)
      .single()
    
    if (error || !data) return false
    
    return !!(data.pdf_content && data.pdf_content.length > 0)
  } catch (error) {
    console.error('Error checking PDF content:', error)
    return false
  }
}

/**
 * Get PDF content for chunking during generation
 */
export async function getPDFContent(paperId: string): Promise<string | null> {
  try {
    const supabase = await getSB()
    const { data, error } = await supabase
      .from('papers')
      .select('pdf_content')
      .eq('id', paperId)
      .single()
    
    if (error || !data) return null
    
    return data.pdf_content || null
  } catch (error) {
    console.error('Error getting PDF content:', error)
    return null
  }
}

/**
 * Updates paper record with PDF URL
 */
export async function updatePaperWithPDF(
  paperId: string, 
  pdfUrl: string, 
  fileSize?: number
): Promise<boolean> {
  try {
    const supabase = await getSB()
    
    const updateData: {
      pdf_url: string
      metadata: {
        pdf_downloaded_at: string
        pdf_file_size?: number
      }
    } = {
      pdf_url: pdfUrl,
      metadata: {
        pdf_downloaded_at: new Date().toISOString(),
        pdf_file_size: fileSize
      }
    }

    const { error } = await supabase
      .from('papers')
      .update(updateData)
      .eq('id', paperId)

    if (error) {
      console.error('Failed to update paper with PDF URL:', error)
      return false
    }

    return true

  } catch (error) {
    console.error('Error updating paper with PDF:', error)
    return false
  }
} 