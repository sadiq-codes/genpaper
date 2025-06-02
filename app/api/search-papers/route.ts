import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchPapers } from '@/lib/db/papers'
import { searchOnlinePapers, expandSearchQuery } from '@/lib/ai/search-papers'
import type { SearchPapersRequest, SearchPapersResponse, Paper } from '@/types/simplified'

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    
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
    const searchOnlineParam = url.searchParams.get('online')

    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 })
    }

    const searchParams: SearchPapersRequest = {
      query: query.trim(),
      limit: limitParam ? parseInt(limitParam) : 20,
      sources: sourcesParam ? sourcesParam.split(',') : undefined,
      useSemanticSearch: useSemanticParam === 'true'
    }

    let allPapers: Paper[] = []

    // Search local database first
    const localPapers = await searchPapers(searchParams)
    allPapers = [...localPapers]

    // Search online if requested
    if (searchOnlineParam === 'true') {
      try {
        const onlinePapers = await searchOnlinePapers(
          searchParams.query,
          searchParams.sources,
          Math.min(searchParams.limit || 10, 10) // Limit online search
        )
        
        // Filter out duplicates (by DOI or title)
        const existingDOIs = new Set(allPapers.map(p => p.doi).filter(Boolean))
        const existingTitles = new Set(allPapers.map(p => p.title.toLowerCase()))
        
        const newPapers = onlinePapers.filter(paper => 
          (!paper.doi || !existingDOIs.has(paper.doi)) &&
          !existingTitles.has(paper.title.toLowerCase())
        )
        
        allPapers = [...allPapers, ...newPapers]
      } catch (error) {
        console.error('Online search error:', error)
        // Continue with local results only
      }
    }

    // Sort by relevance/citation count
    allPapers.sort((a, b) => {
      const scoreA = (a.citation_count || 0) + (a.impact_score || 0) * 100
      const scoreB = (b.citation_count || 0) + (b.impact_score || 0) * 100
      return scoreB - scoreA
    })

    // Limit results
    const limitedPapers = allPapers.slice(0, searchParams.limit || 20)

    const response: SearchPapersResponse = {
      papers: limitedPapers,
      total: limitedPapers.length,
      query: searchParams.query
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
    const supabase = createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: SearchPapersRequest & { expandQuery?: boolean } = await request.json()
    const { query, limit, sources, useSemanticSearch, expandQuery } = body

    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    let searchQueries = [query.trim()]

    // Expand query if requested
    if (expandQuery) {
      try {
        const expandedQueries = await expandSearchQuery(query.trim())
        searchQueries = expandedQueries
      } catch (error) {
        console.error('Query expansion error:', error)
        // Continue with original query
      }
    }

    let allPapers: Paper[] = []
    const seenPapers = new Set<string>()

    // Search with each query
    for (const searchQuery of searchQueries) {
      // Search local database
      const localPapers = await searchPapers({
        query: searchQuery,
        limit: Math.ceil((limit || 20) / searchQueries.length),
        sources,
        useSemanticSearch
      })

      // Add unique papers
      for (const paper of localPapers) {
        const key = paper.doi || paper.title.toLowerCase()
        if (!seenPapers.has(key)) {
          seenPapers.add(key)
          allPapers.push(paper)
        }
      }

      // Search online for the first query only to avoid rate limits
      if (searchQuery === searchQueries[0]) {
        try {
          const onlinePapers = await searchOnlinePapers(
            searchQuery,
            sources,
            Math.min(limit || 10, 10)
          )
          
          for (const paper of onlinePapers) {
            const key = paper.doi || paper.title.toLowerCase()
            if (!seenPapers.has(key)) {
              seenPapers.add(key)
              allPapers.push(paper)
            }
          }
        } catch (error) {
          console.error('Online search error:', error)
        }
      }
    }

    // Sort by relevance and citation count
    allPapers.sort((a, b) => {
      const scoreA = (a.citation_count || 0) * 0.6 + (a.impact_score || 0) * 100 * 0.4
      const scoreB = (b.citation_count || 0) * 0.6 + (b.impact_score || 0) * 100 * 0.4
      return scoreB - scoreA
    })

    // Limit results
    const limitedPapers = allPapers.slice(0, limit || 20)

    const response: SearchPapersResponse = {
      papers: limitedPapers,
      total: limitedPapers.length,
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