import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { retrieveEditorContext } from '@/lib/rag'

/**
 * Pre-warm the RAG cache for editor autocomplete
 * 
 * Called when editor loads to populate the cache with likely queries.
 * This makes subsequent autocomplete requests much faster (cache hits).
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { projectId, paperIds, sections } = body as {
      projectId: string
      paperIds: string[]
      sections?: string[]  // Optional section titles to pre-warm
    }

    if (!projectId || !paperIds || paperIds.length === 0) {
      return NextResponse.json({ error: 'Missing projectId or paperIds' }, { status: 400 })
    }

    // Limit papers to avoid overloading
    const effectivePaperIds = paperIds.slice(0, 10)
    
    // Build queries for common contexts
    const queries: string[] = []
    
    // General queries that are commonly used
    queries.push('introduction background context')
    queries.push('methodology methods approach')
    queries.push('results findings analysis')
    queries.push('discussion implications')
    queries.push('conclusion summary')
    
    // Add section-specific queries if provided
    if (sections && sections.length > 0) {
      for (const section of sections.slice(0, 5)) {
        queries.push(section.toLowerCase())
      }
    }

    // Pre-warm cache with parallel requests (limit concurrency)
    const BATCH_SIZE = 3
    let prewarmed = 0
    
    for (let i = 0; i < queries.length; i += BATCH_SIZE) {
      const batch = queries.slice(i, i + BATCH_SIZE)
      
      await Promise.all(batch.map(async (query) => {
        try {
          // This will populate the RAG cache
          await retrieveEditorContext(query, effectivePaperIds, {
            maxChunks: 4,
            maxClaims: 0,
            minChunkScore: 0.25,
            minClaimScore: 0.25
          })
          prewarmed++
        } catch (err) {
          console.warn(`[Prewarm] Failed to prewarm query "${query}":`, err)
        }
      }))
    }

    const duration = Date.now() - startTime
    console.log(`[Prewarm] Completed: ${prewarmed}/${queries.length} queries in ${duration}ms`)

    return NextResponse.json({
      success: true,
      prewarmed,
      totalQueries: queries.length,
      duration
    })

  } catch (error) {
    console.error('[Prewarm] Error:', error)
    return NextResponse.json(
      { error: 'Failed to prewarm cache' },
      { status: 500 }
    )
  }
}
