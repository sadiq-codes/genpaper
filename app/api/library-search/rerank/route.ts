import { NextRequest, NextResponse } from 'next/server'
import { semanticRerank } from '@/lib/search/semantic-rerank'
import { z } from 'zod'

/**
 * Semantic Rerank API (Phase 2 of two-phase search)
 * 
 * Takes papers from fast search and reranks them using semantic similarity.
 * This provides better relevance ordering but takes longer (~2-4s).
 * 
 * Called in background after fast results are shown to user.
 */

const PaperSchema = z.object({
  canonical_id: z.string(),
  title: z.string(),
  abstract: z.string().optional(),
  authors: z.array(z.string()).optional(),
  year: z.number().nullable(), // Papers may not have a year
  venue: z.string().optional(),
  doi: z.string().optional(),
  url: z.string().optional(),
  citationCount: z.number().optional(),
  bm25Score: z.number().optional(),
  source: z.string()
})

const RerankRequestSchema = z.object({
  query: z.string().min(1).max(500).trim(),
  papers: z.array(PaperSchema).min(1).max(100)
})

interface RerankResponse {
  success: boolean
  query: string
  papers: Array<{
    canonical_id: string
    title: string
    abstract?: string
    authors?: string[]
    year: number | null
    venue?: string
    doi?: string
    url?: string
    citationCount: number
    semanticScore: number
    source: string
  }>
  count: number
  rerankTimeMs: number
  phase: 'semantic'
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const body = await request.json()
    const validationResult = RerankRequestSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid request parameters',
          details: validationResult.error.errors,
          query: '',
          papers: [],
          count: 0,
          phase: 'semantic'
        },
        { status: 400 }
      )
    }

    const { query, papers } = validationResult.data

    console.log(`🧠 Semantic Rerank: "${query}" with ${papers.length} papers`)

    // Convert papers to format expected by semanticRerank
    const papersForRerank = papers.map(p => ({
      id: p.canonical_id,
      title: p.title,
      abstract: p.abstract,
      // Pass through other fields
      canonical_id: p.canonical_id,
      authors: p.authors,
      year: p.year,
      venue: p.venue,
      doi: p.doi,
      url: p.url,
      citationCount: p.citationCount || 0,
      source: p.source
    }))

    // Perform semantic reranking
    const reranked = await semanticRerank(query, papersForRerank, {
      minScore: 0.15, // Lower threshold to keep more results
      titleWeight: 0.65,
      maxResults: papers.length, // Keep all papers, just reorder
      boostExactMatch: true,
      maxItemsToEmbed: 30 // Limit embeddings for speed
    })

    const rerankTimeMs = Date.now() - startTime

    const response: RerankResponse = {
      success: true,
      query,
      papers: reranked.map(paper => ({
        canonical_id: paper.canonical_id as string,
        title: paper.title,
        abstract: paper.abstract?.substring(0, 300),
        authors: paper.authors as string[] | undefined,
        year: paper.year as number,
        venue: paper.venue as string | undefined,
        doi: paper.doi as string | undefined,
        url: paper.url as string | undefined,
        citationCount: (paper.citationCount as number) || 0,
        semanticScore: paper.semanticScore,
        source: paper.source as string
      })),
      count: reranked.length,
      rerankTimeMs,
      phase: 'semantic'
    }

    console.log(`🧠 Semantic Rerank Complete: ${response.count} papers in ${rerankTimeMs}ms`)
    console.log(`   Top 3 scores: ${response.papers.slice(0, 3).map(p => p.semanticScore.toFixed(3)).join(', ')}`)

    return NextResponse.json(response)

  } catch (error) {
    const rerankTimeMs = Date.now() - startTime
    console.error(`Semantic rerank error after ${rerankTimeMs}ms:`, error)
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Rerank failed',
        query: '',
        papers: [],
        count: 0,
        rerankTimeMs,
        phase: 'semantic'
      },
      { status: 500 }
    )
  }
}
