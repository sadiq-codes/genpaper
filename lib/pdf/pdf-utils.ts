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

// Academic-friendly user agents to rotate through
const USER_AGENTS = [
  'Mozilla/5.0 (compatible; GenPaper Academic Research Tool; +mailto:research@example.com)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (compatible; Academic Research Bot 1.0; +mailto:research@genpaperapp.com)'
]

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function getAcademicHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/pdf,application/octet-stream,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site'
  }
  
  // Add referer for certain domains to look more legitimate
  if (url.includes('researchgate.net') || url.includes('academia.edu')) {
    headers['Referer'] = 'https://www.google.com/'
  }
  
  // Add specific headers for arXiv
  if (url.includes('arxiv.org')) {
    headers['Accept'] = 'application/pdf'
    headers['Cache-Control'] = 'no-cache'
  }
  
  return headers
}

/**
 * Downloads PDF from URL with size and timeout limits
 */
export async function downloadPdfBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)

  try {
    // Add random delay to avoid rate limiting
    const delay = Math.random() * 2000 + 1000 // 1-3 seconds
    await new Promise(resolve => setTimeout(resolve, delay))
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: getAcademicHeaders(url)
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    // Verify content type is PDF or acceptable
    const contentType = response.headers.get('content-type')
    if (contentType && !contentType.includes('pdf') && !contentType.includes('octet-stream') && !contentType.includes('application/')) {
      // If we get HTML content, this is likely a landing page, not a direct PDF
      if (contentType.includes('text/html')) {
        throw new Error(`URL points to HTML page, not PDF: ${contentType}`)
      }
      console.warn(`Unexpected content type: ${contentType} for URL: ${url}`)
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

    const finalBuffer = Buffer.from(buffer)
    
    // Verify PDF header
    if (finalBuffer.length < 4 || !finalBuffer.toString('ascii', 0, 4).startsWith('%PDF')) {
      const header = finalBuffer.toString('ascii', 0, Math.min(50, finalBuffer.length))
      
      // Check if this looks like HTML content
      if (header.includes('<!DOCTYPE') || header.includes('<html')) {
        throw new Error(`URL returned HTML page instead of PDF. This is likely a publisher landing page requiring subscription access.`)
      }
      
      throw new Error(`Invalid PDF header: ${header}`)
    }

    console.log(`✅ Successfully downloaded PDF: ${totalSize} bytes from ${url}`)
    return finalBuffer

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Download timeout after ${DOWNLOAD_TIMEOUT}ms`)
    }
    console.error(`❌ PDF download failed for ${url}:`, error)
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
      .select('pdf_content')
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
 * Save extracted PDF full text into the papers table (pdf_content)
 */
export async function savePDFContent(paperId: string, content: string): Promise<boolean> {
  try {
    if (!content || content.trim().length < 100) return false
    const supabase = await getSB()
    const { error } = await supabase
      .from('papers')
      .update({ pdf_content: content })
      .eq('id', paperId)
    if (error) {
      console.error('Error saving pdf_content:', error)
      return false
    }
    return true
  } catch (e) {
    console.error('Unexpected error saving pdf_content:', e)
    return false
  }
}

/**
 * Updates paper record with PDF URL
 */
export async function updatePaperWithPDF(
  paperId: string, 
  pdfUrl: string, 
  _fileSize?: number
): Promise<boolean> {
  try {
    const supabase = await getSB()
    
    const { error } = await supabase
      .from('papers')
      .update({ pdf_url: pdfUrl })
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