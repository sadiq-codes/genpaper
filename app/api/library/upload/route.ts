// Force Node.js runtime for pdf-parse compatibility
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ingestPaperWithChunks } from '@/lib/db/papers'
import { addPaperToLibrary } from '@/lib/db/library'
import { extractPDFMetadata } from '@/lib/pdf/extract'
import { sanitizeFilename } from '@/lib/utils/text'
import { logger } from '@/lib/utils/logger'
import { PaperDTOSchema } from '@/lib/schemas/paper'

export async function POST(request: NextRequest) {
  try {
    logger.info('PDF Upload API Started')
    
    // Early size validation from content-length header
    const contentLength = request.headers.get('content-length')
    const maxSize = 10 * 1024 * 1024 // 10MB
    
    if (contentLength && parseInt(contentLength) > maxSize) {
      logger.warn('File too large (header check)', { contentLength })
      return Response.json({ 
        error: 'File too large. Maximum size is 10MB',
        received: contentLength 
      }, { status: 413 })
    }
    
    // Check authentication
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      logger.error('Authentication failed', { error: authError })
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    logger.info('Authentication successful', { userId: user.id })

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File
    const fileName = formData.get('fileName') as string

    if (!file) {
      logger.error('No file provided in form data')
      return Response.json({ error: 'No file provided' }, { status: 400 })
    }

    // Sanitize filename for security
    const sanitizedFileName = fileName 
      ? sanitizeFilename(fileName)
      : sanitizeFilename(file.name)

    logger.info('File received', { 
      fileName: sanitizedFileName, 
      size: file.size, 
      type: file.type 
    })

    // Validate file type
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      logger.error('Invalid file type', { type: file.type })
      return Response.json({ error: 'Only PDF files are allowed' }, { status: 400 })
    }

    // Double-check file size (after form parsing)
    if (file.size > maxSize) {
      logger.error('File too large', { size: file.size })
      return Response.json({ 
        error: 'File too large. Maximum size is 10MB',
        received: file.size,
        limit: maxSize 
      }, { status: 413 })
    }

    logger.info('Processing PDF upload', { fileName: sanitizedFileName, size: file.size })

    // Extract metadata and content from PDF
    logger.info('Starting PDF metadata extraction')
    const extractedData = await extractPDFMetadata(file)
    
    logger.info('Metadata extraction completed', {
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
      impact_score: undefined,
      authors: extractedData.authors || ['Unknown Author']
    }

    // Validate paper data with Zod schema
    const validationResult = PaperDTOSchema.safeParse(paperData)
    if (!validationResult.success) {
      logger.error('Paper data validation failed', { 
        errors: validationResult.error.errors 
      })
      return Response.json({ 
        error: 'Invalid paper data',
        details: validationResult.error.errors 
      }, { status: 400 })
    }

    logger.info('Starting paper ingestion')
    
    // Ingest paper with content chunks for RAG (creates embeddings for both main paper and chunks)
    const paperId = await ingestPaperWithChunks(validationResult.data, extractedData.contentChunks)
    logger.info('Paper ingested successfully', { paperId })

    logger.info('Adding to user library')
    // Add to user's library
    const libraryPaper = await addPaperToLibrary(user.id, paperId, `Uploaded from file: ${sanitizedFileName}`)
    logger.info('Added to library successfully', { libraryPaperId: libraryPaper.id })

    logger.info('Upload completed successfully')

    // Return success response with extracted data
    return Response.json({
      success: true,
      paperId,
      libraryPaperId: libraryPaper.id,
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
    logger.error('PDF upload error', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      error: error
    })
    
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