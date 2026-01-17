// Force Node.js runtime for pdf-parse compatibility
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ingestPaper } from '@/lib/db/papers'
import { addPaperToLibrary } from '@/lib/db/library'

import { sanitizeFilename } from '@/lib/utils/text'
import { info, warn, logError } from '@/lib/utils/logger'
import { PaperDTOSchema } from '@/lib/schemas/paper'

export async function POST(request: NextRequest) {
  try {
    info('PDF Upload API Started')
    
    // Early size validation from content-length header
    const contentLength = request.headers.get('content-length')
    const maxSize = 20 * 1024 * 1024 // 20MB (many academic PDFs are 11-14MB)
    
    if (contentLength && parseInt(contentLength) > maxSize) {
      warn('File too large (header check)', { contentLength })
      return Response.json({ 
        error: 'File too large. Maximum size is 20MB',
        received: contentLength 
      }, { status: 413 })
    }
    
    // Check authentication
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      logError(new Error('Authentication failed'), { error: authError })
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    info('Authentication successful', { userId: user.id })

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File
    const fileName = formData.get('fileName') as string

    if (!file) {
      logError(new Error('No file provided in form data'))
      return Response.json({ error: 'No file provided' }, { status: 400 })
    }

    // Sanitize filename for security
    const sanitizedFileName = fileName 
      ? sanitizeFilename(fileName)
      : sanitizeFilename(file.name)

    info('File received', { 
      fileName: sanitizedFileName, 
      size: file.size, 
      type: file.type 
    })

    // Validate file type
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      logError(new Error('Invalid file type'), { type: file.type })
      return Response.json({ error: 'Only PDF files are allowed' }, { status: 400 })
    }

    // Double-check file size (after form parsing)
    if (file.size > maxSize) {
      logError(new Error('File too large'), { size: file.size })
      return Response.json({ 
        error: 'File too large. Maximum size is 20MB',
        received: file.size,
        limit: maxSize 
      }, { status: 413 })
    }

    info('Processing PDF upload', { fileName: sanitizedFileName, size: file.size })

    // Check for OCR flag from query params (for power users with scanned PDFs)
    const url = new URL(request.url)
    // Default OCR ON; allow opt-out with ?ocr=0
    const enableOcr = url.searchParams.get('ocr') !== '0'
    
    // Extract metadata and content from PDF using tiered extractor for better results
    info('Starting PDF metadata extraction using tiered extractor', { enableOcr })
    
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const { extractPdfMetadataTiered } = await import('@/lib/pdf/tiered-extractor')
    
    const tieredResult = await extractPdfMetadataTiered(fileBuffer, {
      enableOcr, // Default ON; can be disabled via query
      maxTimeoutMs: enableOcr ? 30000 : 15000 // Longer timeout for OCR
    })
    
    // Convert tiered result to expected format for compatibility
    const extractedData = {
      title: tieredResult.title,
      authors: tieredResult.authors,
      abstract: tieredResult.abstract,
      venue: tieredResult.venue,
      doi: tieredResult.doi,
      year: tieredResult.year,
      content: tieredResult.abstract || tieredResult.fullText?.substring(0, 1000),
      fullText: tieredResult.fullText?.substring(0, 200) // Truncated for logging
    }
    
    info('Metadata extraction completed', {
      title: extractedData.title,
      authorsCount: extractedData.authors?.length,
      abstract: extractedData.abstract ? 'Found' : 'Not found',
      venue: extractedData.venue ? 'Found' : 'Not found',
      doi: extractedData.doi ? 'Found' : 'Not found',
      year: extractedData.year
    })

    // Create paper object for ingestion with validation
    const paperData = {
      title: extractedData.title || sanitizedFileName.replace('.pdf', ''),
      abstract: extractedData.abstract,
      publication_date: extractedData.year ? `${extractedData.year}-01-01` : undefined,
      venue: extractedData.venue,
      doi: extractedData.doi,
      url: undefined, // No URL for uploaded files
      pdf_url: undefined, // Could store file if implementing file storage
      metadata: {
        source: 'upload',
        original_filename: sanitizedFileName,
        file_size: file.size,
        upload_date: new Date().toISOString(),
        extracted_content: extractedData.fullText // This is now safely truncated
      },
      source: 'upload',
      citation_count: 0,
      authors: extractedData.authors || ['Unknown Author']
    }

    // Validate paper data with Zod schema
    const validationResult = PaperDTOSchema.safeParse(paperData)
    if (!validationResult.success) {
      logError(new Error('Paper data validation failed'), { 
        errors: validationResult.error.errors 
      })
      return Response.json({ 
        error: 'Invalid paper data',
        details: validationResult.error.errors 
      }, { status: 400 })
    }

    info('Starting paper ingestion')
    
    // Ingest paper using the unified system
    // Set ownerId to current user for uploaded papers (private by default)
    const text = tieredResult.fullText?.slice(0, 1_000_000)   // 1 MB safety cap to prevent network choking
    const result = await ingestPaper(validationResult.data, {
      fullText: text || undefined,
      ownerId: user.id  // User-uploaded papers are owned by the uploader
    })
    const paperId = result.paperId
    info('Paper ingested successfully', { paperId, ownerId: user.id })

    // Store the original PDF file in Supabase storage for future reference
    info('Uploading PDF to storage')
    try {
      const { uploadPDFToStorage, generatePDFFilename, updatePaperWithPDF } = await import('@/lib/pdf/pdf-utils')
      
      // Generate filename using the same convention as downloads  
      const doiForFilename = (validationResult.data.doi && typeof validationResult.data.doi === 'string') 
        ? validationResult.data.doi 
        : `upload-${Date.now()}`
      const filename = generatePDFFilename(doiForFilename, paperId)
      
      // Upload PDF to storage
      const storedUrl = await uploadPDFToStorage(fileBuffer, filename)
      
      if (storedUrl) {
        // Update paper record with PDF URL
        await updatePaperWithPDF(paperId, storedUrl, file.size)
        info('PDF stored successfully', { storedUrl, filename })
      } else {
        warn('Failed to store PDF, but paper ingestion succeeded')
      }
    } catch (storageError) {
      logError(new Error('PDF storage failed, but paper ingestion succeeded'), { error: storageError as unknown })
      // Don't fail the entire operation if storage fails
    }

    info('Adding to user library')
    // Add to user's library
    const libraryPaper = await addPaperToLibrary(user.id, paperId, `Uploaded from file: ${sanitizedFileName}`)
    info('Added to library successfully', { libraryPaperId: libraryPaper.id })

    info('Upload completed successfully')

    // Get the stored PDF URL for response
    let storedPdfUrl: string | undefined
    try {
      const supabase = await createClient()
      const { data } = await supabase
        .from('papers')
        .select('pdf_url')
        .eq('id', paperId)
        .single()
      storedPdfUrl = data?.pdf_url || undefined
    } catch {
      // Ignore errors getting PDF URL
    }

    // Return success response with extracted data
    return Response.json({
      success: true,
      paperId,
      libraryPaperId: libraryPaper.id,
      pdfUrl: storedPdfUrl,
      extractedData: {
        title: extractedData.title,
        authors: extractedData.authors,
        abstract: extractedData.abstract,
        venue: extractedData.venue,
        doi: extractedData.doi,
        year: extractedData.year
      }
    })

  } catch (error) {
    if (error instanceof Error) {
      logError(error)
    } else {
      logError(new Error('PDF upload error'), { error: error as unknown })
    }
    
    return Response.json({
      error: error instanceof Error ? error.message : 'Failed to process PDF upload',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : String(error)) : undefined
    }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  })
} 
