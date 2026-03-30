#!/usr/bin/env tsx

/**
 * Embed all chunks from Supabase to Qdrant.
 *
 * Reads chunk text from Supabase, generates embeddings using the shared app
 * embedding configuration, and stores them in Qdrant.
 *
 * Usage:
 *   npx tsx scripts/embed-chunks-to-qdrant.ts
 *   npx tsx scripts/embed-chunks-to-qdrant.ts --batch-size 16 --concurrency 4
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { QdrantClient } from '@qdrant/js-client-rest'
import { getEmbeddingProviderName } from '@/lib/ai/vercel-client'
import { generateEmbeddings as generateSharedEmbeddings } from '@/lib/utils/embedding'

const COLLECTION = 'paper_chunks'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
})

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  return generateSharedEmbeddings(texts)
}

/**
 * Process a batch of chunks
 */
async function processBatch(
  chunks: Array<{ id: string; paper_id: string; chunk_index: number; content: string }>
): Promise<number> {
  if (chunks.length === 0) return 0
  
  try {
    // Generate embeddings
    const texts = chunks.map(c => c.content || '')
    const embeddings = await generateEmbeddings(texts)
    
    // Prepare points for Qdrant
    const points = chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: embeddings[i],
      payload: {
        paper_id: chunk.paper_id,
        chunk_index: chunk.chunk_index,
        content: chunk.content,
      },
    }))
    
    // Upsert to Qdrant
    await qdrant.upsert(COLLECTION, {
      wait: true,
      points,
    })
    
    return chunks.length
  } catch (err) {
    console.error(`  Batch error: ${err}`)
    // Fallback to one-at-a-time retries so a single bad chunk does not stop the run.
    let success = 0
    for (const chunk of chunks) {
      try {
        const [embedding] = await generateEmbeddings([chunk.content || ''])
        await qdrant.upsert(COLLECTION, {
          wait: true,
          points: [{
            id: chunk.id,
            vector: embedding,
            payload: {
              paper_id: chunk.paper_id,
              chunk_index: chunk.chunk_index,
              content: chunk.content,
            },
          }],
        })
        success++
      } catch (innerErr) {
        console.error(`  Failed chunk ${chunk.id}: ${innerErr}`)
      }
    }
    return success
  }
}

async function main() {
  const args = process.argv.slice(2)
  let batchSize = 8
  let concurrency = 4
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size') {
      batchSize = parseInt(args[++i], 10)
    } else if (args[i] === '--concurrency') {
      concurrency = parseInt(args[++i], 10)
    }
  }
  
  console.log('='.repeat(60))
  console.log('📦 Embed Chunks from Supabase to Qdrant')
  console.log('='.repeat(60))
  console.log(`Supabase URL:  ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(`Qdrant URL:    ${process.env.QDRANT_URL}`)
  console.log(`Embeddings:    ${getEmbeddingProviderName()}`)
  console.log(`Batch size:    ${batchSize}`)
  console.log(`Concurrency:   ${concurrency}`)
  console.log('='.repeat(60))
  
  // Check connections
  console.log('\n🔌 Checking connections...')
  
  // Check Supabase - count total chunks
  const { count: totalChunks, error: countError } = await supabase
    .from('paper_chunks')
    .select('*', { count: 'exact', head: true })
  
  if (countError) {
    console.error(`  Supabase: ❌ ${countError.message}`)
    process.exit(1)
  }
  console.log(`  Supabase: ✅ (${totalChunks} chunks)`)
  
  // Check Qdrant
  const collectionInfo = await qdrant.getCollection(COLLECTION)
  console.log(`  Qdrant: ✅ (${collectionInfo.points_count} existing points)`)
  
  // Test embedding
  const testEmbed = await generateEmbeddings(['test'])
  console.log(`  Embedding dims: ${testEmbed[0].length}`)
  
  // Process all chunks
  console.log(`\n📝 Processing ${totalChunks} chunks...`)
  
  let processed = 0
  let offset = 0
  const startTime = Date.now()
  const effectiveBatchSize = batchSize * concurrency
  
  while (offset < totalChunks!) {
    // Fetch batch from Supabase
    const { data: chunks, error } = await supabase
      .from('paper_chunks')
      .select('id, paper_id, chunk_index, content')
      .range(offset, offset + effectiveBatchSize - 1)
      .order('id')
    
    if (error) {
      console.error(`  Fetch error at offset ${offset}: ${error.message}`)
      break
    }
    
    if (!chunks || chunks.length === 0) break
    
    // Split into concurrent batches
    const batches: typeof chunks[] = []
    for (let i = 0; i < chunks.length; i += batchSize) {
      batches.push(chunks.slice(i, i + batchSize))
    }
    
    // Process batches concurrently
    const results = await Promise.all(batches.map(batch => processBatch(batch)))
    const batchProcessed = results.reduce((a, b) => a + b, 0)
    
    processed += batchProcessed
    offset += chunks.length
    
    const elapsed = (Date.now() - startTime) / 1000
    const rate = processed / elapsed
    const eta = (totalChunks! - processed) / rate
    
    console.log(`  Progress: ${processed}/${totalChunks} (${(processed/totalChunks!*100).toFixed(1)}%) - ${rate.toFixed(1)} chunks/s - ETA: ${(eta/60).toFixed(1)} min`)
  }
  
  const totalTime = (Date.now() - startTime) / 1000
  console.log(`\n✅ Embedding complete!`)
  console.log(`  Total chunks: ${processed}`)
  console.log(`  Total time: ${(totalTime/60).toFixed(1)} minutes`)
  console.log(`  Average rate: ${(processed/totalTime).toFixed(1)} chunks/second`)
  
  // Verify with a test search
  console.log('\n🔍 Verifying with test search...')
  const testQuery = 'machine learning neural networks deep learning'
  const [queryEmbed] = await generateEmbeddings([testQuery])
  
  const results = await qdrant.search(COLLECTION, {
    vector: queryEmbed,
    limit: 5,
    with_payload: true,
  })
  
  console.log(`  Query: "${testQuery}"`)
  console.log(`  Results:`)
  for (const r of results) {
    console.log(`    Score: ${r.score.toFixed(4)} - ${((r.payload as any).content as string).slice(0, 60)}...`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
