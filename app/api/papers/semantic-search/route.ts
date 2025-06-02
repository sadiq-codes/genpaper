import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { semanticSearchPapers, hybridSearchPapers } from '@/lib/db/papers'

// POST - Semantic search for papers
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { 
      query, 
      searchType = 'semantic',
      limit = 8,
      minYear = 2018,
      sources,
      semanticWeight = 0.7
    } = await request.json()

    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    let papers
    if (searchType === 'hybrid') {
      papers = await hybridSearchPapers(query, {
        limit,
        minYear,
        sources,
        semanticWeight
      })
    } else {
      papers = await semanticSearchPapers(query, {
        limit,
        minYear,
        sources
      })
    }

    return NextResponse.json({
      papers,
      query,
      searchType,
      total: papers.length
    })

  } catch (error) {
    console.error('Error in semantic search API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 