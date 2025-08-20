import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrExtractFullText } from '@/lib/services/pdf-processor'
import { createChunksForPaper } from '@/lib/content/ingestion'

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
    const { paperId, doi, batch, directPdfUrl, directTitle, fastTrack: _fastTrack = false } = body

    // Handle batch download via queue
    if (batch && Array.isArray(batch)) {
      console.log(`🔄 Starting batch PDF download for ${batch.length} papers`)
      
      const results: Array<{ paperId: string; status: 'completed' | 'skipped'; error?: string }> = []
      
      for (const paper of batch) {
        try {
          if (!paper.id || !paper.pdf_url || !paper.title) {
            results.push({ 
              paperId: paper.id || 'unknown', 
              status: 'skipped',
              error: 'Missing required fields' 
            })
            continue
          }
          
          const text = await getOrExtractFullText({ pdfUrl: paper.pdf_url, paperId: paper.id, ocr: true, timeoutMs: 60000 })
          if (text && text.length > 100) {
            await createChunksForPaper(paper.id, text)
            results.push({ paperId: paper.id, status: 'completed' })
          } else {
            results.push({ paperId: paper.id, status: 'skipped' })
          }
          
        } catch (error) {
          results.push({ 
            paperId: paper.id || 'unknown', 
            status: 'skipped',
            error: error instanceof Error ? error.message : 'Failed to process PDF'
          })
        }
      }
      
      const successful = results.filter(r => r.status === 'completed').length
      
      return NextResponse.json({
        success: true,
        message: `Processed ${successful}/${batch.length} PDFs`,
        results
      })
    }

    // Handle direct PDF URL case (from LibraryManager)
    if (directPdfUrl && directTitle) {
      console.log(`📄 Processing direct PDF for: ${directTitle}`)
      
              try {
        const text = await getOrExtractFullText({ pdfUrl: directPdfUrl, paperId, ocr: true, timeoutMs: 60000 })
        if (text && text.length > 100) {
          await createChunksForPaper(paperId, text)
          return NextResponse.json({ success: true, status: 'completed' })
        }
        return NextResponse.json({ success: true, status: 'skipped' })
      } catch (error) {
        return NextResponse.json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to queue PDF processing'
        }, { status: 500 })
      }
    }

    // Handle single paper download via queue
    if (!paperId || !doi) {
      return NextResponse.json({ 
        error: 'Paper ID and DOI are required (or provide directPdfUrl and directTitle)' 
      }, { status: 400 })
    }

    console.log(`📄 Processing PDF for paper: ${paperId}`)

    // First, get paper details for the job
    const { data: paper, error: paperError } = await supabase
      .from('papers')
      .select('title, pdf_url')
      .eq('id', paperId)
      .single()

    if (paperError || !paper) {
      return NextResponse.json({
        success: false,
        error: 'Paper not found'
      }, { status: 404 })
    }

    // Use existing PDF URL or construct from DOI
    const pdfUrl = paper.pdf_url || `https://www.unpaywall.org/pdf/${doi}`

    try {
      const text = await getOrExtractFullText({ pdfUrl, paperId, ocr: true, timeoutMs: 60000 })
      if (text && text.length > 100) {
        await createChunksForPaper(paperId, text)
        return NextResponse.json({ success: true, status: 'completed' })
      }
      return NextResponse.json({ success: true, status: 'skipped' })
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to queue PDF processing'
      }, { status: 500 })
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
      .select('id, pdf_url, doi')
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
      canDownload: !!paper.doi
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