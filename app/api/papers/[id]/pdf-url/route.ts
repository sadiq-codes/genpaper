import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { handleError, requireAuth } from '@/lib/api/helpers'
import { getStoragePathFromPublicUrl, PAPER_PDFS_BUCKET } from '@/lib/supabase/storage-buckets'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth()
    const supabase = await createClient()

    const { id: paperId } = await params

    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    // Get paper to check access and get pdf_url
    const { data: paper, error: paperError } = await supabase
      .from('papers')
      .select('id, pdf_url, owner_id')
      .eq('id', paperId)
      .single()

    if (paperError || !paper) {
      return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
    }

    // Check access - either public paper (owner_id is null) or user owns it
    if (paper.owner_id && paper.owner_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (!paper.pdf_url) {
      return NextResponse.json({ error: 'No PDF available for this paper' }, { status: 404 })
    }

    // Check if it's an external URL (not from our Supabase storage)
    // Supabase storage URLs contain 'supabase' in the domain
    const isSupabaseUrl = paper.pdf_url.includes('supabase')
    
    if (!isSupabaseUrl) {
      // External URL (e.g., arxiv, publisher site) - return directly
      return NextResponse.json({ url: paper.pdf_url, isExternal: true })
    }

    // Extract storage path from pdf_url
    // URL formats:
    // - Public: https://[project].supabase.co/storage/v1/object/public/<bucket>/[path]
    // - Signed: https://[project].supabase.co/storage/v1/object/sign/<bucket>/[path]
    const storagePath = getStoragePathFromPublicUrl(paper.pdf_url, PAPER_PDFS_BUCKET)

    if (!storagePath) {
      // Can't parse URL, return as-is (it might still work as a public URL)
      console.warn('Could not parse storage path from pdf_url:', paper.pdf_url)
      return NextResponse.json({ url: paper.pdf_url, isExternal: false, fallback: true })
    }

    // Use service client to generate signed URL (bypasses RLS)
    const serviceClient = createServiceClient()
    
    // First try to create a signed URL (works for both public and private buckets)
    const { data: signedUrlData, error: signedUrlError } = await serviceClient.storage
      .from(PAPER_PDFS_BUCKET)
      .createSignedUrl(storagePath, 60 * 60) // 1 hour expiry

    if (signedUrlData?.signedUrl) {
      return NextResponse.json({ 
        url: signedUrlData.signedUrl, 
        isExternal: false,
        expiresIn: 60 * 60 // seconds
      })
    }

    // If signed URL failed, log the error and try public URL
    if (signedUrlError) {
      console.warn('Failed to create signed URL, falling back to public URL:', signedUrlError.message)
    }

    // Fallback: Try to get public URL
    const { data: publicUrlData } = serviceClient.storage
      .from(PAPER_PDFS_BUCKET)
      .getPublicUrl(storagePath)

    if (publicUrlData?.publicUrl) {
      return NextResponse.json({ 
        url: publicUrlData.publicUrl, 
        isExternal: false,
        fallback: true 
      })
    }

    // Last resort: return the original URL
    console.warn('All URL generation methods failed, returning original pdf_url')
    return NextResponse.json({ url: paper.pdf_url, isExternal: false, fallback: true })

  } catch (error) {
    return handleError(error, 'Error in papers/[id]/pdf-url GET API')
  }
}
