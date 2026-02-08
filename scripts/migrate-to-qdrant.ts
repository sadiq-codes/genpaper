#!/usr/bin/env tsx

/**
 * Migrate existing embeddings from Supabase pgvector to Qdrant
 * 
 * Usage:
 *   npx tsx scripts/migrate-to-qdrant.ts
 *   npx tsx scripts/migrate-to-qdrant.ts --batch-size 500
 *   npx tsx scripts/migrate-to-qdrant.ts --dry-run
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { QdrantClient } from '@qdrant/js-client-rest'

const BATCH_SIZE = 500

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
})

/**
 * Parse pgvector string format to number array
 * pgvector returns embeddings as strings like "[0.1,0.2,0.3,...]"
 */
function parseEmbedding(embedding: unknown): number[] | null {
  if (!embedding) return null
  
  // Already an array
  if (Array.isArray(embedding)) {
    return embedding as number[]
  }
  
  // Parse string format "[0.1,0.2,...]"
  if (typeof embedding === 'string') {
    try {
      const parsed = JSON.parse(embedding)
      if (Array.isArray(parsed)) {
        return parsed as number[]
      }
    } catch {
      // Try without JSON.parse for format like "[0.1,0.2,...]"
      const match = embedding.match(/\[(.*)\]/)
      if (match) {
        return match[1].split(',').map(s => parseFloat(s.trim()))
      }
    }
  }
  
  return null
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
  console.log('📦 Migrate Embeddings to Qdrant')
  console.log('='.repeat(60))
  console.log(`Qdrant URL:    ${process.env.QDRANT_URL}`)
  console.log(`Batch size:    ${batchSize}`)
  console.log(`Dry run:       ${dryRun}`)
  console.log('='.repeat(60))
  
  // Check Qdrant connection
  try {
    const collections = await qdrant.getCollections()
    console.log(`\n✅ Qdrant connected. Collections: ${collections.collections.map(c => c.name).join(', ')}`)
  } catch (err) {
    console.error('❌ Failed to connect to Qdrant:', err)
    process.exit(1)
  }
  
  // Get counts
  const { count: totalPapers } = await supabase
    .from('papers')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null)
  
  const { count: totalChunks } = await supabase
    .from('paper_chunks')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null)
  
  console.log(`\n📊 Found ${totalPapers} papers and ${totalChunks} chunks with embeddings`)
  
  if (dryRun) {
    console.log('\n🔍 Dry run - no data will be migrated')
    return
  }
  
  // Migrate papers
  console.log('\n📄 Migrating papers...')
  let papersMigrated = 0
  let papersOffset = 0
  
  while (true) {
    const { data: papers, error } = await supabase
      .from('papers')
      .select('id, title, doi, embedding')
      .not('embedding', 'is', null)
      .range(papersOffset, papersOffset + batchSize - 1)
    
    if (error) {
      console.error('Error fetching papers:', error)
      break
    }
    
    if (!papers || papers.length === 0) break
    
    const points = papers
      .map(p => {
        const vector = parseEmbedding(p.embedding)
        if (!vector || vector.length !== 1024) return null
        return {
          id: p.id,
          vector,
          payload: {
            title: p.title,
            doi: p.doi || undefined,
          },
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
    
    try {
      await qdrant.upsert('papers', { wait: true, points })
      papersMigrated += papers.length
      console.log(`  Papers: ${papersMigrated}/${totalPapers}`)
    } catch (err) {
      console.error(`  ❌ Failed to upsert papers batch:`, err)
    }
    
    papersOffset += batchSize
    if (papers.length < batchSize) break
  }
  
  // Migrate chunks
  console.log('\n📝 Migrating chunks...')
  let chunksMigrated = 0
  let chunksOffset = 0
  
  while (true) {
    const { data: chunks, error } = await supabase
      .from('paper_chunks')
      .select('id, paper_id, chunk_index, content, embedding')
      .not('embedding', 'is', null)
      .range(chunksOffset, chunksOffset + batchSize - 1)
    
    if (error) {
      console.error('Error fetching chunks:', error)
      break
    }
    
    if (!chunks || chunks.length === 0) break
    
    const points = chunks
      .map(c => {
        const vector = parseEmbedding(c.embedding)
        if (!vector || vector.length !== 1024) return null
        return {
          id: c.id,
          vector,
          payload: {
            paper_id: c.paper_id,
            chunk_index: c.chunk_index,
            content: c.content,
          },
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
    
    try {
      await qdrant.upsert('paper_chunks', { wait: true, points })
      chunksMigrated += chunks.length
      console.log(`  Chunks: ${chunksMigrated}/${totalChunks}`)
    } catch (err) {
      console.error(`  ❌ Failed to upsert chunks batch:`, err)
    }
    
    chunksOffset += batchSize
    if (chunks.length < batchSize) break
  }
  
  // Verify
  console.log('\n✅ Migration complete!')
  
  const papersInfo = await qdrant.getCollection('papers')
  const chunksInfo = await qdrant.getCollection('paper_chunks')
  
  console.log(`\n📊 Qdrant collections:`)
  console.log(`  papers:       ${papersInfo.points_count} points`)
  console.log(`  paper_chunks: ${chunksInfo.points_count} points`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
