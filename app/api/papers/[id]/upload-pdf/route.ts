export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ensureStorageBucket, PAPER_PDFS_BUCKET } from '@/lib/supabase/storage-buckets'
import { sanitizeFilename } from '@/lib/utils/text'

/**
 * POST /api/papers/[id]/upload-pdf
 * 
 * Upload a PDF and attach it to an existing paper.
 * The paper must exist and the user must be authenticated.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: paperId } = await params
    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    // Verify paper exists and user has access
    const serviceClient = createServiceClient()
    const { data: paper, error: paperError } = await serviceClient
      .from('papers')
      .select('id, title, pdf_url, owner_id')
      .eq('id', paperId)
      .single()

    if (paperError || !paper) {
      return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
    }

    // Check ownership - only allow upload if user owns the paper
    // Public papers (owner_id = null) can only be modified by the system, not users
    if (paper.owner_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 })
    }

    // Validate file size (20MB max)
    const maxSize = 20 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File too large. Maximum size is 20MB' }, { status: 413 })
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const sanitizedFileName = sanitizeFilename(file.name)
    const storagePath = `${user.id}/${Date.now()}-${sanitizedFileName}`

    // Upload to storage
    let uploadError: { message?: string } | null = null
    const attemptUpload = async () => {
      const result = await serviceClient
        .storage
        .from(PAPER_PDFS_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: 'application/pdf',
          upsert: false,
        })
      uploadError = result.error
    }

    await attemptUpload()

    if (uploadError?.message?.includes('Bucket not found')) {
      await ensureStorageBucket(serviceClient, PAPER_PDFS_BUCKET, {
        public: true,
        fileSizeLimit: maxSize,
      })
      await attemptUpload()
    }

    if (uploadError) {
      console.error('PDF upload error:', uploadError)
      return NextResponse.json({ error: uploadError.message || 'Failed to upload PDF' }, { status: 500 })
    }

    const { data: urlData } = serviceClient
      .storage
      .from(PAPER_PDFS_BUCKET)
      .getPublicUrl(storagePath)

    const pdfUrl = urlData.publicUrl

    // Update paper record with the PDF URL
    const { error: updateError } = await serviceClient
      .from('papers')
      .update({ pdf_url: pdfUrl })
      .eq('id', paperId)

    if (updateError) {
      console.error('Paper update error:', updateError)
      return NextResponse.json({ error: 'Failed to update paper' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      pdfUrl,
    })
  } catch (error) {
    console.error('Error uploading PDF:', error)
    return NextResponse.json(
      { error: 'Failed to upload PDF' },
      { status: 500 }
    )
  }
}
