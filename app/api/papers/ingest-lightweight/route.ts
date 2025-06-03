import { NextRequest, NextResponse } from 'next/server'
import { ingestPaperLightweight } from '@/lib/db/papers'
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
      impact_score: paper.impact_score || 0,
      authors: paper.authors || []
    }

    // Ingest paper without chunks for fast library addition
    const paperId = await ingestPaperLightweight(paperDTO)

    return NextResponse.json({ 
      success: true, 
      paperId,
      message: 'Paper ingested without chunks for library'
    })

  } catch (error) {
    console.error('Lightweight ingestion error:', error)
    return NextResponse.json(
      { error: 'Failed to ingest paper' }, 
      { status: 500 }
    )
  }
} 