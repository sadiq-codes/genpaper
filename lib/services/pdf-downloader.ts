import { createClient } from '@/lib/supabase/server'
import { getOpenAccessPdf } from './academic-apis'
import { extractPDFMetadata } from '@/lib/pdf/extract'
import { getSB } from '@/lib/supabase/server'

export interface PDFDownloadResult {
  success: boolean
  paperId: string
  pdfPath?: string
  extractedContent?: string
  error?: string
}

// Configuration
const PDF_BUCKET = 'papers-pdfs'
const MAX_PDF_SIZE = 50 * 1024 * 1024 // 50MB limit
const DOWNLOAD_TIMEOUT = 30000 // 30 seconds

/**
 * Downloads and stores a PDF from Unpaywall for a given DOI
 */
export async function downloadAndStorePDF(
  doi: string, 
  paperId: string,
  retries = 2
): Promise<PDFDownloadResult> {
  if (!doi) {
    return { success: false, paperId, error: 'No DOI provided' }
  }

  try {
    console.log(`📄 Starting PDF download for DOI: ${doi}`)
    
    // Get PDF URL from Unpaywall
    const pdfUrl = await getOpenAccessPdf(doi)
    if (!pdfUrl) {
      console.log(`❌ No open access PDF found for DOI: ${doi}`)
      return { success: false, paperId, error: 'No open access PDF available' }
    }

    console.log(`🔗 Found PDF URL: ${pdfUrl}`)

    // Download the PDF with timeout and size limits
    const pdfBuffer = await downloadPDFWithLimits(pdfUrl)
    if (!pdfBuffer) {
      return { success: false, paperId, error: 'Failed to download PDF' }
    }

    console.log(`📦 Downloaded PDF: ${pdfBuffer.length} bytes`)

    // Generate unique filename
    const filename = generatePDFFilename(doi, paperId)
    
    // Upload to Supabase storage
    const storedUrl = await uploadPDFToStorage(pdfBuffer, filename)
    if (!storedUrl) {
      return { success: false, paperId, error: 'Failed to store PDF' }
    }

    console.log(`✅ PDF stored successfully: ${storedUrl}`)

    return {
      success: true,
      paperId,
      pdfPath: storedUrl,
      extractedContent: undefined,
      error: undefined
    }

  } catch (error) {
    console.error(`❌ PDF download error for DOI ${doi}:`, error)
    
    // Retry logic
    if (retries > 0) {
      console.log(`🔄 Retrying PDF download (${retries} attempts left)`)
      await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2 seconds
      return downloadAndStorePDF(doi, paperId, retries - 1)
    }

    return { 
      success: false, 
      paperId,
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Downloads PDF with size and timeout limits
 */
async function downloadPDFWithLimits(url: string): Promise<Buffer | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)

  try {
    console.log(`⬇️ Downloading PDF from: ${url}`)
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GenPaper/1.0 Academic Research Tool'
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

    console.log(`📊 PDF downloaded: ${buffer.length} bytes`)
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
async function uploadPDFToStorage(buffer: Buffer, filename: string): Promise<string | null> {
  try {
    const supabase = await createClient()
    
    console.log(`☁️ Uploading to storage: ${filename}`)

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

    console.log(`📁 File uploaded to storage: ${data.path}`)

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
function generatePDFFilename(doi: string, paperId: string): string {
  // Clean DOI for filename (remove special characters)
  const cleanDoi = doi
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/__+/g, '_')
    .substring(0, 100) // Limit length
  
  const timestamp = Date.now()
  return `papers/${cleanDoi}_${paperId.substring(0, 8)}_${timestamp}.pdf`
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
    const supabase = await createClient()
    
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

    console.log(`✅ Updated paper ${paperId} with PDF URL`)
    return true

  } catch (error) {
    console.error('Error updating paper with PDF:', error)
    return false
  }
}

/**
 * Batch process PDF downloads for multiple papers
 */
export async function batchDownloadPDFs(
  papers: Array<{ id: string; doi?: string }>,
  concurrency = 3
): Promise<Array<{ paperId: string; result: PDFDownloadResult }>> {
  const results: Array<{ paperId: string; result: PDFDownloadResult }> = []
  
  // Filter papers that have DOIs
  const papersWithDoi = papers.filter(p => p.doi)
  
  console.log(`📦 Starting batch PDF download for ${papersWithDoi.length} papers`)

  // Process in batches to avoid overwhelming the system
  for (let i = 0; i < papersWithDoi.length; i += concurrency) {
    const batch = papersWithDoi.slice(i, i + concurrency)
    
    const batchPromises = batch.map(async paper => {
      const result = await downloadAndStorePDF(paper.doi!, paper.id)
      
      // Update paper record if successful
      if (result.success && result.pdfPath) {
        await updatePaperWithPDF(paper.id, result.pdfPath, result.extractedContent?.length)
      }
      
      return { paperId: paper.id, result }
    })

    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)

    // Small delay between batches to be respectful
    if (i + concurrency < papersWithDoi.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  const successful = results.filter(r => r.result.success).length
  console.log(`✅ Batch PDF download complete: ${successful}/${results.length} successful`)

  return results
}

/**
 * Download PDF and extract content for library papers
 * This happens when user adds paper to library, not during search
 */
export async function downloadAndProcessPDF(
  paperId: string, 
  pdfUrl: string,
  paperTitle: string
): Promise<PDFDownloadResult> {
  try {
    console.log(`📄 Starting PDF download and processing for: ${paperTitle}`)
    
    // Download PDF
    const response = await fetch(pdfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Academic Research Bot)'
      }
    })
    
    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`)
    }
    
    const pdfBuffer = await response.arrayBuffer()
    const pdfFile = new File([pdfBuffer], `${paperTitle}.pdf`, { type: 'application/pdf' })
    
    // Extract text content from PDF
    console.log(`📄 Extracting content from PDF...`)
    const extractedData = await extractPDFMetadata(pdfFile)
    
    // Store PDF content in database for later chunking
    const supabase = await getSB()
    const { error: updateError } = await supabase
      .from('papers')
      .update({
        metadata: {
          pdf_downloaded: true,
          pdf_download_date: new Date().toISOString(),
          pdf_content_extracted: !!extractedData.fullText,
          pdf_content_length: extractedData.fullText?.length || 0,
          extraction_metadata: {
            chunks_count: extractedData.contentChunks?.length || 0,
            has_abstract: !!extractedData.abstract,
            has_authors: extractedData.authors && extractedData.authors.length > 0
          }
        },
        // Store extracted content for later chunking during generation
        pdf_content: extractedData.fullText || extractedData.content
      })
      .eq('id', paperId)
    
    if (updateError) {
      console.warn(`⚠️ Failed to update paper with PDF content:`, updateError)
    }
    
    console.log(`✅ PDF processed successfully for: ${paperTitle}`)
    console.log(`   📊 Content length: ${extractedData.fullText?.length || 0} characters`)
    console.log(`   📄 Potential chunks: ${extractedData.contentChunks?.length || 0}`)
    
    return {
      success: true,
      paperId,
      extractedContent: extractedData.fullText || extractedData.content,
      pdfPath: pdfUrl
    }
    
  } catch (error) {
    console.error(`❌ PDF download/processing failed for ${paperTitle}:`, error)
    
    return {
      success: false,
      paperId,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
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