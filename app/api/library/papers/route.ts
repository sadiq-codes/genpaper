import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface PaperWithAuthors {
  id: string
  title: string
  abstract: string | null
  publication_date: string | null
  venue: string | null
  doi: string | null
  url: string | null
  pdf_url: string | null
  citation_count: number | null
  impact_score: number | null
  created_at: string
  authors?: string[]
}

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
          authors
        )
      `)
      .eq('user_id', user.id)
      .order('added_at', { ascending: false })

    if (error) {
      console.error('Error fetching library papers:', error)
      return NextResponse.json({ error: 'Failed to fetch library papers' }, { status: 500 })
    }

    // Transform the data to match the expected format
    const transformedPapers = libraryPapers.map(lp => {
      const paper = lp.paper as unknown as PaperWithAuthors
      const authors = Array.isArray(paper.authors) ? paper.authors : []
      return {
        ...lp,
        paper: {
          ...paper,
          authors: authors,
          author_names: authors
        }
      }
    })

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