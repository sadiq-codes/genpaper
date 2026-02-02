import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

    // Extract storage path from pdf_url
    // The pdf_url format is typically the full public URL from Supabase Storage
    // We need to extract just the path portion
    const storagePathMatch = paper.pdf_url.match(/\/papers\/(.+)$/)
    
    if (!storagePathMatch) {
      // If it's an external URL (not from our storage), just return it directly
      return NextResponse.json({ url: paper.pdf_url, isExternal: true })
    }

    const storagePath = storagePathMatch[1]

    // Use service client to generate signed URL (bypasses RLS)
    const serviceClient = createServiceClient()
    
    const { data: signedUrlData, error: signedUrlError } = await serviceClient.storage
      .from('papers')
      .createSignedUrl(storagePath, 60 * 60) // 1 hour expiry

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error('Failed to create signed URL:', signedUrlError)
      // Fallback to public URL
      return NextResponse.json({ url: paper.pdf_url, isExternal: false })
    }

    return NextResponse.json({ 
      url: signedUrlData.signedUrl, 
      isExternal: false,
      expiresIn: 60 * 60 // seconds
    })

  } catch (error) {
    console.error('Error in papers/[id]/pdf-url GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}
