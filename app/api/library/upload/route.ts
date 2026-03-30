// Force Node.js runtime for file handling
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ensureStorageBucket, PAPER_PDFS_BUCKET } from '@/lib/supabase/storage-buckets'
import { addPaperToLibrary } from '@/lib/db/library'
import { handleError, requireAuth } from '@/lib/api/helpers'
import { sanitizeFilename } from '@/lib/utils/text'
import { info, warn, logError } from '@/lib/utils/logger'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { schedulePaperContentPreparationById } from '@/lib/services/paper-content-service'

/**
 * Simplified PDF Upload API
 * 
 * This API now follows an early-preparation model:
 * 1. Upload PDF to storage
 * 2. Create paper record with minimal metadata (title from filename)
 * 3. Set processing_status = 'pending'
 * 4. Add to user's library
 * 5. Schedule non-blocking content preparation
 * 6. Return immediately (fast!)
 * 
 * Heavy text extraction, chunking, and structured evidence preparation runs
 * after the response is sent so generation does not pay the cold-start cost later.
 */
export async function POST(request: NextRequest) {
  try {
    info('PDF Upload API Started (lazy mode)')
    
    // Early size validation from content-length header
    const contentLength = request.headers.get('content-length')
    const maxSize = 20 * 1024 * 1024 // 20MB
    
    if (contentLength && parseInt(contentLength) > maxSize) {
      warn({ contentLength }, 'File too large (header check)')
      return Response.json({ 
        error: 'File too large. Maximum size is 20MB',
        received: contentLength 
      }, { status: 413 })
    }
    
    // Check authentication using the shared helper so transient auth outages
    // surface as a proper service error instead of looking like bad credentials.
    const user = await requireAuth()

    info('Authentication successful')

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

    info(
      {
        fileName: sanitizedFileName,
        size: file.size,
        type: file.type
      },
      'File received'
    )

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

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    
    // Step 1: Upload PDF to storage FIRST
    info('Uploading PDF to storage')
    let storedPdfUrl: string | undefined
    
    try {
      const serviceClient = createServiceClient()
      const storagePath = `${user.id}/${Date.now()}-${sanitizedFileName}`
      
      const { data: uploadData, error: uploadError } = await serviceClient
        .storage
        .from(PAPER_PDFS_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: 'application/pdf',
          upsert: false
        })
      
      if (uploadError) {
        // If bucket doesn't exist, try to create it
        if (uploadError.message?.includes('Bucket not found')) {
          warn('Storage bucket not found, attempting to create')
          
          await ensureStorageBucket(serviceClient, PAPER_PDFS_BUCKET, {
            public: true,
            fileSizeLimit: maxSize,
          })
          
          // Retry upload
          const { data: retryData, error: retryError } = await serviceClient
            .storage
            .from(PAPER_PDFS_BUCKET)
            .upload(storagePath, fileBuffer, {
              contentType: 'application/pdf',
              upsert: false
            })
          
          if (retryError) {
            throw retryError
          }
          
          if (retryData) {
            const { data: urlData } = serviceClient
              .storage
              .from(PAPER_PDFS_BUCKET)
              .getPublicUrl(storagePath)
            storedPdfUrl = urlData.publicUrl
          }
        } else {
          throw uploadError
        }
      } else if (uploadData) {
        const { data: urlData } = serviceClient
          .storage
          .from(PAPER_PDFS_BUCKET)
          .getPublicUrl(storagePath)
        storedPdfUrl = urlData.publicUrl
      }
      
      info({ storedPdfUrl }, 'PDF uploaded to storage')
    } catch (storageError) {
      // Log but continue - paper can still be created without storage
      logError(new Error('PDF storage failed'), { error: storageError as unknown })
      warn('Continuing without PDF storage')
    }

    // Step 2: Create paper record with minimal metadata
    info('Creating paper record')
    
    // Extract title from filename (remove .pdf extension)
    const titleFromFilename = sanitizedFileName
      .replace(/\.pdf$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    
    // Generate a basic embedding from the title (required by database constraint)
    const [titleEmbedding] = await generateEmbeddings([titleFromFilename])
    
    const serviceClient = createServiceClient()
    const { data: paper, error: insertError } = await serviceClient
      .from('papers')
      .insert({
        title: titleFromFilename,
        authors: [], // Empty until extracted from PDF - display layer handles this
        source: 'upload',
        pdf_url: storedPdfUrl,
        owner_id: user.id,
        processing_status: 'pending',
        embedding: titleEmbedding,
        metadata: {
          source: 'upload',
          original_filename: sanitizedFileName,
          file_size: file.size,
          upload_date: new Date().toISOString()
        }
      })
      .select('id')
      .single()
    
    if (insertError || !paper) {
      logError(new Error('Failed to create paper record'), { error: insertError })
      return Response.json({ 
        error: 'Failed to create paper record',
        details: insertError?.message 
      }, { status: 500 })
    }
    
    const paperId = paper.id
    info({ paperId, processingStatus: 'pending' }, 'Paper record created')

    // Step 3: Add to user's library
    info('Adding to user library')
    const libraryPaper = await addPaperToLibrary(user.id, paperId, `Uploaded: ${sanitizedFileName}`)
    info({ libraryPaperId: libraryPaper.id }, 'Added to library successfully')

    after(() => {
      schedulePaperContentPreparationById(paperId, {
        searchQuery: 'library_upload',
        waitForStructuredExtraction: false,
        reason: 'library_upload',
      })
    })

    info('Upload completed successfully (pending processing)')

    // Return success response matching PdfUploadResult type expected by usePdfUpload hook
    return Response.json({
      success: true,
      paper: {
        id: paperId,
        title: titleFromFilename,
        authors: ['Unknown Author'],
        year: new Date().getFullYear(),
      },
      pdfUrl: storedPdfUrl,
      processingStatus: 'pending',
    })

  } catch (error) {
    if (error instanceof Error) {
      logError(error)
    } else {
      logError(new Error('PDF upload error'), { error: error as unknown })
    }

    return handleError(error, 'PDF upload error')
  }
}

export async function OPTIONS() {
  const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || 'https://genpaper.app'
  
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  })
} 
