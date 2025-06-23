import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pdfQueue } from '@/lib/services/pdf-queue'

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
    const { paperId, doi, batch, directPdfUrl, directTitle, fastTrack = false } = body

    // Handle batch download via queue
    if (batch && Array.isArray(batch)) {
      console.log(`🔄 Starting batch PDF download for ${batch.length} papers`)
      
      const jobIds: string[] = []
      const results: Array<{ paperId: string; jobId?: string; error?: string }> = []
      
      for (const paper of batch) {
        try {
          if (!paper.id || !paper.pdf_url || !paper.title) {
            results.push({ 
              paperId: paper.id || 'unknown', 
              error: 'Missing required fields' 
            })
            continue
          }
          
          const jobId = await pdfQueue.addJob(
            paper.id,
            paper.pdf_url,
            paper.title,
            user.id,
            'low' // Use low priority for batch jobs
          )
          
          jobIds.push(jobId)
          results.push({ paperId: paper.id, jobId })
          
        } catch (error) {
          results.push({ 
            paperId: paper.id || 'unknown', 
            error: error instanceof Error ? error.message : 'Failed to queue job'
          })
        }
      }
      
      const successful = results.filter(r => r.jobId).length
      
      return NextResponse.json({
        success: true,
        message: `Queued ${successful}/${batch.length} PDFs for processing`,
        jobIds,
        results
      })
    }

    // Handle direct PDF URL case (from LibraryManager)
    if (directPdfUrl && directTitle) {
      console.log(`📄 Queueing direct PDF processing for: ${directTitle}`)
      
              try {
          const jobId = await pdfQueue.addJob(
            paperId,
            directPdfUrl,
            directTitle,
            user.id,
            'normal',
            { fastTrack }
          )
        
        return NextResponse.json({
          success: true,
          jobId,
          message: 'PDF processing queued successfully'
        })
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

    console.log(`📄 Queueing PDF processing for paper: ${paperId}`)

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
      const jobId = await pdfQueue.addJob(
        paperId,
        pdfUrl,
        paper.title,
        user.id,
        'normal', // Normal priority for single downloads
        { fastTrack }
      )
      
      return NextResponse.json({
        success: true,
        jobId,
        message: 'PDF processing queued successfully'
      })
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