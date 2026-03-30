#!/usr/bin/env tsx

/**
 * Re-embed all chunks in Qdrant using the shared app embedding configuration.
 *
 * This script:
 * 1. Scrolls through all chunks in Qdrant
 * 2. Re-generates embeddings using the configured provider
 * 3. Updates the vectors in place (keeps same IDs and payloads)
 *
 * Usage:
 *   npx tsx scripts/reembed-qdrant-chunks.ts
 *   npx tsx scripts/reembed-qdrant-chunks.ts --batch-size 50
 *   npx tsx scripts/reembed-qdrant-chunks.ts --dry-run
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { QdrantClient } from '@qdrant/js-client-rest'
import { getEmbeddingProviderName } from '@/lib/ai/vercel-client'
import { generateEmbeddings as generateSharedEmbeddings } from '@/lib/utils/embedding'

const BATCH_SIZE = 8
const COLLECTION = 'paper_chunks'

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
})
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  return generateSharedEmbeddings(texts)
}

async function main() {
  const args = process.argv.slice(2)
  let batchSize = BATCH_SIZE
  let dryRun = false
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size') {
      batchSize = parseInt(args[++i], 10)
    } else if (args[i] === '--dry-run') {
      dryRun = true
    }
  }
  
  console.log('='.repeat(60))
  console.log('🔄 Re-embed Qdrant Chunks')
  console.log('='.repeat(60))
  console.log(`Qdrant URL:    ${process.env.QDRANT_URL}`)
  console.log(`Embeddings:    ${getEmbeddingProviderName()}`)
  console.log(`Batch size:    ${batchSize}`)
  console.log(`Dry run:       ${dryRun}`)
  console.log('='.repeat(60))
  
  // Check connections
  console.log('\n🔌 Checking connections...')
  
  // Check Qdrant
  const collectionInfo = await qdrant.getCollection(COLLECTION)
  const totalChunks = collectionInfo.points_count || 0
  console.log(`  Qdrant: ✅ (${totalChunks} chunks in ${COLLECTION})`)
  
  // Test embedding dimensions
  const testEmbed = await generateEmbeddings(['test'])
  console.log(`  Embedding dims: ${testEmbed[0].length}`)
  
  if (dryRun) {
    console.log('\n🔍 Dry run - no changes will be made')
    
    // Sample a few chunks to show what would happen
    const sample = await qdrant.scroll(COLLECTION, {
      limit: 3,
      with_payload: true,
      with_vector: true,
    })
    
    console.log('\nSample chunks:')
    for (const point of sample.points) {
      const content = (point.payload as any).content as string
      console.log(`  ID: ${point.id}`)
      console.log(`  Content: ${content.slice(0, 80)}...`)
      console.log(`  Old vector[0:3]: [${(point.vector as number[]).slice(0, 3).map(v => v.toFixed(4)).join(', ')}...]`)
      
      const [newEmbed] = await generateEmbeddings([content])
      console.log(`  New vector[0:3]: [${newEmbed.slice(0, 3).map(v => v.toFixed(4)).join(', ')}...]`)
      console.log('')
    }
    return
  }
  
  // Process all chunks
  console.log(`\n📝 Re-embedding ${totalChunks} chunks...`)
  
  let processed = 0
  let offset: string | undefined = undefined
  const startTime = Date.now()
  
  while (true) {
    // Scroll through chunks
    const scroll = await qdrant.scroll(COLLECTION, {
      limit: batchSize,
      offset,
      with_payload: true,
      with_vector: false, // Don't need old vectors
    })
    
    if (scroll.points.length === 0) break
    
    // Extract texts (truncation handled in generateEmbeddings)
    const texts = scroll.points.map(p => {
      const content = (p.payload as any).content as string
      return content || ''
    })
    
    // Generate new embeddings
    const embeddings = await generateEmbeddings(texts)
    
    // Update vectors in Qdrant
    const points = scroll.points.map((p, i) => ({
      id: p.id,
      vector: embeddings[i],
      payload: p.payload,
    }))
    
    await qdrant.upsert(COLLECTION, {
      wait: true,
      points,
    })
    
    processed += scroll.points.length
    const elapsed = (Date.now() - startTime) / 1000
    const rate = processed / elapsed
    const eta = (totalChunks - processed) / rate
    
    console.log(`  Progress: ${processed}/${totalChunks} (${(processed/totalChunks*100).toFixed(1)}%) - ${rate.toFixed(1)} chunks/s - ETA: ${(eta/60).toFixed(1)} min`)
    
    // Update offset for next scroll
    offset = scroll.next_page_offset as string | undefined
    if (!offset) break
  }
  
  const totalTime = (Date.now() - startTime) / 1000
  console.log(`\n✅ Re-embedding complete!`)
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
