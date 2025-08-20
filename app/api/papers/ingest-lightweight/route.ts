import { NextRequest, NextResponse } from 'next/server'
import { ingestPaper } from '@/lib/db/papers'
import { createClient } from '@/lib/supabase/server'
import { PaperDTO } from '@/lib/schemas/paper'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { paper } = body

    if (!paper || !paper.title) {
      return NextResponse.json({ error: 'Paper data is required' }, { status: 400 })
    }

    // Convert to PaperDTO format
    const paperDTO: PaperDTO = {
      title: paper.title,
      abstract: paper.abstract || undefined,
      publication_date: paper.publication_date || undefined,
      venue: paper.venue || undefined,
      doi: paper.doi || undefined,
      url: paper.url || undefined,
      pdf_url: paper.pdf_url || undefined,
      metadata: {
        ...paper.metadata,
        ingested_via: 'library_manager',
        ingested_at: new Date().toISOString()
      },
      source: paper.source || 'library_search',
      citation_count: paper.citation_count || 0,
      authors: paper.authors || []
    }

    // Use unified ingestion with abstract-only processing
    const result = await ingestPaper(paperDTO, {
      // No options needed - will process abstract automatically if available
    })

    return NextResponse.json({ 
      success: true, 
      paperId: result.paperId,
      isNewPaper: result.isNew,
      message: `Paper ${result.isNew ? 'ingested' : 'already exists'} - ready for library`
    })

  } catch (error) {
    console.error('Lightweight ingestion error:', error)
    return NextResponse.json(
      { error: 'Failed to ingest paper' }, 
      { status: 500 }
    )
  }
} 