import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { unifiedSearch } from '@/lib/services/search-orchestrator'
import type { SearchPapersRequest, SearchPapersResponse, PaperSources } from '@/types/simplified'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const query = url.searchParams.get('q')
    const limitParam = url.searchParams.get('limit')
    const sourcesParam = url.searchParams.get('sources')
    const useSemanticParam = url.searchParams.get('semantic')

    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 })
    }

    const limit = limitParam ? parseInt(limitParam) : 20
    const sources = sourcesParam ? sourcesParam.split(',') as PaperSources : undefined
    const useSemanticSearch = useSemanticParam !== 'false' // Default to true

    // Use unified search for consistency and simplicity
    const searchResult = await unifiedSearch(query.trim(), {
      maxResults: limit,
      minResults: Math.min(5, limit),
      useHybridSearch: useSemanticSearch,
      useKeywordSearch: true,
      useAcademicAPIs: true,
      combineResults: true,
      sources: sources,
      fastMode: true // Enable fast mode for manual search
    })

    const response: SearchPapersResponse = {
      papers: searchResult.papers,
      total: searchResult.papers.length,
      query: query.trim()
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Error in search-papers API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: SearchPapersRequest = await request.json()
    const { query, limit, sources, useSemanticSearch } = body

    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    // Use unified search for consistency and simplicity
    const searchResult = await unifiedSearch(query.trim(), {
      maxResults: limit || 20,
      minResults: Math.min(5, limit || 20),
      useHybridSearch: useSemanticSearch !== false, // Default to true
      useKeywordSearch: true,
      useAcademicAPIs: true,
      combineResults: true,
      sources: sources,
      fastMode: true // Enable fast mode for manual search
    })

    const response: SearchPapersResponse = {
      papers: searchResult.papers,
      total: searchResult.papers.length,
      query: query.trim()
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Error in search-papers POST API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 