import { NextRequest, NextResponse } from 'next/server'
import { getSB } from '@/lib/supabase/server'
import { embedMany } from 'ai'
import { ai } from '@/lib/ai/vercel-client'

const EMBEDDING_CONFIG = {
  model: 'text-embedding-3-small' as const,
  dimensions: 384,
  maxTokens: 8192
} as const

async function generateEmbeddings(inputs: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: ai.embedding(EMBEDDING_CONFIG.model, {
      dimensions: EMBEDDING_CONFIG.dimensions
    }),
    values: inputs,
    maxRetries: 3
  })
  
  return embeddings
}

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 Starting embedding backfill process...')
    
    const supabase = await getSB()
    
    // Get papers without embeddings
    const { data: papers, error } = await supabase
      .from('papers')
      .select('id, title, abstract')
      .is('embedding', null)
      .not('title', 'is', null)
      .limit(100) // Limit for API route to avoid timeouts
    
    if (error) {
      console.error('❌ Error fetching papers:', error)
      return NextResponse.json({ error: 'Failed to fetch papers' }, { status: 500 })
    }
    
    if (!papers || papers.length === 0) {
      console.log('✅ No papers need embedding backfill')
      return NextResponse.json({ message: 'No papers need embedding backfill', processed: 0 })
    }
    
    console.log(`📊 Found ${papers.length} papers without embeddings`)
    
    // Process in smaller batches for API route
    const BATCH_SIZE = 5
    let processed = 0
    const results = []
    
    for (let i = 0; i < papers.length; i += BATCH_SIZE) {
      const batch = papers.slice(i, i + BATCH_SIZE)
      console.log(`📄 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(papers.length / BATCH_SIZE)}`)
      
      try {
        // Prepare text for embedding
        const texts = batch.map(paper => 
          `${paper.title || ''} ${paper.abstract || ''}`.trim()
        ).filter(text => text.length > 10)
        
        if (texts.length === 0) {
          console.log('⚠️ Skipping batch - no valid text content')
          continue
        }
        
        // Generate embeddings
        const embeddings = await generateEmbeddings(texts)
        
        // Update papers with embeddings
        const updates = batch.map((paper, idx) => ({
          id: paper.id,
          embedding: embeddings[idx]
        }))
        
        for (const update of updates) {
          const { error: updateError } = await supabase
            .from('papers')
            .update({ embedding: update.embedding })
            .eq('id', update.id)
          
          if (updateError) {
            console.error(`❌ Error updating paper ${update.id}:`, updateError)
            results.push({ id: update.id, success: false, error: updateError.message })
          } else {
            processed++
            console.log(`✅ Updated paper ${update.id} (${processed}/${papers.length})`)
            results.push({ id: update.id, success: true })
          }
        }
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100))
        
      } catch (error) {
        console.error(`❌ Error processing batch:`, error)
        // Continue with next batch
      }
    }
    
    console.log(`🎉 Embedding backfill completed! Processed ${processed}/${papers.length} papers`)
    
    // Verify the results
    const { data: verifyCount, error: verifyError } = await supabase
      .from('papers')
      .select('id', { count: 'exact' })
      .not('embedding', 'is', null)
    
    const totalWithEmbeddings = verifyError ? 'unknown' : verifyCount?.length || 0
    
    return NextResponse.json({
      message: 'Embedding backfill completed',
      processed,
      totalPapers: papers.length,
      totalWithEmbeddings,
      results
    })
    
  } catch (error) {
    console.error('❌ Backfill API error:', error)
    return NextResponse.json({ 
      error: 'Backfill failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await getSB()
    
    // Get count of papers with and without embeddings
    const { data: withEmbeddings, error: withError } = await supabase
      .from('papers')
      .select('id', { count: 'exact' })
      .not('embedding', 'is', null)
    
    const { data: withoutEmbeddings, error: withoutError } = await supabase
      .from('papers')
      .select('id', { count: 'exact' })
      .is('embedding', null)
    
    if (withError || withoutError) {
      return NextResponse.json({ error: 'Failed to check embedding status' }, { status: 500 })
    }
    
    return NextResponse.json({
      papersWithEmbeddings: withEmbeddings?.length || 0,
      papersWithoutEmbeddings: withoutEmbeddings?.length || 0,
      totalPapers: (withEmbeddings?.length || 0) + (withoutEmbeddings?.length || 0)
    })
    
  } catch (error) {
    console.error('❌ Status check error:', error)
    return NextResponse.json({ 
      error: 'Status check failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
} 