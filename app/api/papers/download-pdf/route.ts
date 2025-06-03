import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { downloadAndStorePDF, updatePaperWithPDF, batchDownloadPDFs } from '@/lib/services/pdf-downloader'

// Download PDF for a single paper
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { paperId, doi, batch } = body

    // Handle batch download
    if (batch && Array.isArray(batch)) {
      console.log(`🔄 Starting batch PDF download for ${batch.length} papers`)
      
      const results = await batchDownloadPDFs(batch, 3) // Process 3 at a time
      
      const successful = results.filter(r => r.result.success).length
      
      return NextResponse.json({
        success: true,
        message: `Downloaded ${successful}/${results.length} PDFs`,
        results
      })
    }

    // Handle single paper download
    if (!paperId || !doi) {
      return NextResponse.json({ 
        error: 'Paper ID and DOI are required' 
      }, { status: 400 })
    }

    console.log(`📄 Downloading PDF for paper: ${paperId}`)

    const result = await downloadAndStorePDF(doi, paperId)

    if (result.success && result.pdf_url) {
      // Update the paper record with the PDF URL
      await updatePaperWithPDF(paperId, result.pdf_url, result.file_size)
      
      return NextResponse.json({
        success: true,
        pdf_url: result.pdf_url,
        file_size: result.file_size,
        message: 'PDF downloaded and stored successfully'
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error || 'Failed to download PDF'
      }, { status: 400 })
    }

  } catch (error) {
    console.error('PDF download API error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 })
  }
}

// Get PDF download status for papers
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const paperIds = searchParams.get('paperIds')?.split(',') || []

    if (paperIds.length === 0) {
      return NextResponse.json({ 
        error: 'Paper IDs are required' 
      }, { status: 400 })
    }

    // Get PDF status for papers
    const { data: papers, error } = await supabase
      .from('papers')
      .select('id, pdf_url, doi, metadata')
      .in('id', paperIds)

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json({ 
        error: 'Failed to fetch paper data' 
      }, { status: 500 })
    }

    const pdfStatus = papers.map(paper => ({
      paperId: paper.id,
      hasPdf: !!paper.pdf_url,
      pdfUrl: paper.pdf_url,
      doi: paper.doi,
      canDownload: !!paper.doi,
      downloadedAt: paper.metadata?.pdf_downloaded_at,
      fileSize: paper.metadata?.pdf_file_size
    }))

    return NextResponse.json({
      success: true,
      pdfStatus
    })

  } catch (error) {
    console.error('PDF status API error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 })
  }
} 