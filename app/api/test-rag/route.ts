import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hybridSearchPapers } from '@/lib/db/papers'

// GET - Test RAG components
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const topic = url.searchParams.get('topic') || 'machine learning'

    // Test semantic search
    console.log('Testing semantic search for topic:', topic)
    
    let searchResults = []
    let error_message = null
    
    try {
      searchResults = await hybridSearchPapers(topic, {
        limit: 5,
        minYear: 2018,
        semanticWeight: 0.7
      })
    } catch (error) {
      error_message = error instanceof Error ? error.message : 'Unknown error'
      console.log('Semantic search failed:', error_message)
    }

    return NextResponse.json({
      message: 'RAG system test',
      topic,
      semantic_search_results: searchResults.length,
      papers: searchResults.slice(0, 3), // Show first 3 for demo
      error: error_message,
      status: searchResults.length > 0 ? 'working' : 'no_papers_in_db'
    })

  } catch (error) {
    console.error('Error in RAG test:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' }, 
      { status: 500 }
    )
  }
} 