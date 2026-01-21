// Force Node.js runtime for file handling
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { addPaperToLibrary } from '@/lib/db/library'
import { sanitizeFilename } from '@/lib/utils/text'
import { info, warn, logError } from '@/lib/utils/logger'
import { generateEmbeddings } from '@/lib/utils/embedding'

/**
 * Simplified PDF Upload API
 * 
 * This API now follows a lazy processing model:
 * 1. Upload PDF to storage
 * 2. Create paper record with minimal metadata (title from filename)
 * 3. Set processing_status = 'pending'
 * 4. Add to user's library
 * 5. Return immediately (fast!)
 * 
 * Actual text extraction, chunking, and embedding happens later:
 * - When user clicks "AI Generate" (before generation)
 * - When user clicks "Write Myself" (background after editor loads)
 */
export async function POST(request: NextRequest) {
  try {
    info('PDF Upload API Started (lazy mode)')
    
    // Early size validation from content-length header
    const contentLength = request.headers.get('content-length')
    const maxSize = 20 * 1024 * 1024 // 20MB
    
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

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    
    // Step 1: Upload PDF to storage FIRST
    info('Uploading PDF to storage')
    let storedPdfUrl: string | undefined
    
    try {
      const serviceClient = createServiceClient()
      const storagePath = `${user.id}/${Date.now()}-${sanitizedFileName}`
      
      const { data: uploadData, error: uploadError } = await serviceClient
        .storage
        .from('papers')
        .upload(storagePath, fileBuffer, {
          contentType: 'application/pdf',
          upsert: false
        })
      
      if (uploadError) {
        // If bucket doesn't exist, try to create it
        if (uploadError.message?.includes('Bucket not found')) {
          warn('Storage bucket not found, attempting to create')
          
          // Try to create the bucket
          const { error: createError } = await serviceClient
            .storage
            .createBucket('papers', { 
              public: false,
              fileSizeLimit: maxSize
            })
          
          if (createError && !createError.message?.includes('already exists')) {
            throw new Error(`Failed to create storage bucket: ${createError.message}`)
          }
          
          // Retry upload
          const { data: retryData, error: retryError } = await serviceClient
            .storage
            .from('papers')
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
              .from('papers')
              .getPublicUrl(storagePath)
            storedPdfUrl = urlData.publicUrl
          }
        } else {
          throw uploadError
        }
      } else if (uploadData) {
        const { data: urlData } = serviceClient
          .storage
          .from('papers')
          .getPublicUrl(storagePath)
        storedPdfUrl = urlData.publicUrl
      }
      
      info('PDF uploaded to storage', { storedPdfUrl })
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
        authors: ['Unknown Author'],
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
    info('Paper record created', { paperId, processingStatus: 'pending' })

    // Step 3: Add to user's library
    info('Adding to user library')
    const libraryPaper = await addPaperToLibrary(user.id, paperId, `Uploaded: ${sanitizedFileName}`)
    info('Added to library successfully', { libraryPaperId: libraryPaper.id })

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
