import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get library papers for the authenticated user
    const { data: libraryPapers, error } = await supabase
      .from('library_papers')
      .select(`
        id,
        user_id,
        paper_id,
        notes,
        added_at,
        paper:papers (
          id,
          title,
          abstract,
          publication_date,
          venue,
          doi,
          url,
          pdf_url,
          citation_count,
          impact_score,
          created_at,
          authors:paper_authors (
            author:authors (
              id,
              name
            )
          )
        )
      `)
      .eq('user_id', user.id)
      .order('added_at', { ascending: false })

    if (error) {
      console.error('Error fetching library papers:', error)
      return NextResponse.json({ error: 'Failed to fetch library papers' }, { status: 500 })
    }

    // Transform the data to match the expected format
    const transformedPapers = libraryPapers.map(lp => ({
      ...lp,
      paper: {
        ...lp.paper,
        authors: lp.paper.authors?.map(pa => pa.author) || [],
        author_names: lp.paper.authors?.map(pa => pa.author.name) || []
      }
    }))

    return NextResponse.json({
      papers: transformedPapers,
      count: transformedPapers.length
    })

  } catch (error) {
    console.error('Error in library papers endpoint:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 