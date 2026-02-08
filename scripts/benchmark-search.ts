#!/usr/bin/env tsx

/**
 * Benchmark: pgvector vs Qdrant search performance
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { QdrantClient } from '@qdrant/js-client-rest'
import { generateEmbeddings } from '@/lib/utils/embedding'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
})

const TEST_QUERIES = [
  'machine learning neural networks deep learning',
  'CRISPR gene editing genetic modification',
  'climate change carbon emissions global warming',
  'quantum computing qubits superposition',
  'protein folding structure prediction',
]

async function benchmarkEmbedding(): Promise<{ bgeMs: number }> {
  console.log('\n📊 Benchmark: Embedding Generation (BGE-large)')
  console.log('─'.repeat(50))
  
  const texts = TEST_QUERIES.slice(0, 3)
  
  // BGE-large (self-hosted)
  const bgeStart = performance.now()
  await generateEmbeddings(texts)
  const bgeMs = performance.now() - bgeStart
  
  console.log(`  BGE-large (self-hosted): ${bgeMs.toFixed(1)}ms for ${texts.length} texts`)
  console.log(`  Per text: ${(bgeMs / texts.length).toFixed(1)}ms`)
  
  return { bgeMs }
}

async function benchmarkSearch(): Promise<{ pgvectorMs: number; qdrantMs: number }> {
  console.log('\n📊 Benchmark: Vector Search (10 queries, top 20 results each)')
  console.log('─'.repeat(50))
  
  // Generate embeddings for test queries
  const embeddings = await generateEmbeddings(TEST_QUERIES)
  
  // Benchmark pgvector (Supabase)
  console.log('\n  Testing pgvector (Supabase)...')
  const pgStart = performance.now()
  
  for (const embedding of embeddings) {
    await supabase.rpc('match_paper_chunks', {
      query_embedding: embedding,
      match_count: 20,
      min_score: 0.3,
    })
  }
  
  const pgvectorMs = performance.now() - pgStart
  console.log(`  pgvector total: ${pgvectorMs.toFixed(1)}ms`)
  console.log(`  pgvector per query: ${(pgvectorMs / embeddings.length).toFixed(1)}ms`)
  
  // Benchmark Qdrant
  console.log('\n  Testing Qdrant...')
  const qdrantStart = performance.now()
  
  for (const embedding of embeddings) {
    await qdrant.search('paper_chunks', {
      vector: embedding,
      limit: 20,
      score_threshold: 0.3,
      with_payload: true,
    })
  }
  
  const qdrantMs = performance.now() - qdrantStart
  console.log(`  Qdrant total: ${qdrantMs.toFixed(1)}ms`)
  console.log(`  Qdrant per query: ${(qdrantMs / embeddings.length).toFixed(1)}ms`)
  
  return { pgvectorMs, qdrantMs }
}

async function benchmarkBatchSearch(): Promise<{ pgvectorMs: number; qdrantMs: number }> {
  console.log('\n📊 Benchmark: Batch Search (50 sequential queries)')
  console.log('─'.repeat(50))
  
  // Use same embedding for consistent comparison
  const [embedding] = await generateEmbeddings(['machine learning artificial intelligence'])
  
  const iterations = 50
  
  // pgvector
  console.log('\n  Testing pgvector...')
  const pgStart = performance.now()
  for (let i = 0; i < iterations; i++) {
    await supabase.rpc('match_paper_chunks', {
      query_embedding: embedding,
      match_count: 10,
      min_score: 0.3,
    })
  }
  const pgvectorMs = performance.now() - pgStart
  
  // Qdrant
  console.log('  Testing Qdrant...')
  const qdrantStart = performance.now()
  for (let i = 0; i < iterations; i++) {
    await qdrant.search('paper_chunks', {
      vector: embedding,
      limit: 10,
      score_threshold: 0.3,
      with_payload: true,
    })
  }
  const qdrantMs = performance.now() - qdrantStart
  
  console.log(`\n  pgvector: ${pgvectorMs.toFixed(1)}ms total (${(pgvectorMs/iterations).toFixed(1)}ms/query)`)
  console.log(`  Qdrant:   ${qdrantMs.toFixed(1)}ms total (${(qdrantMs/iterations).toFixed(1)}ms/query)`)
  
  return { pgvectorMs, qdrantMs }
}

async function main() {
  console.log('='.repeat(60))
  console.log('🚀 GenPaper Vector Search Benchmark')
  console.log('='.repeat(60))
  
  // Check connections
  console.log('\n🔌 Checking connections...')
  
  try {
    const { count } = await supabase
      .from('paper_chunks')
      .select('*', { count: 'exact', head: true })
    console.log(`  Supabase: ✅ (${count} chunks)`)
  } catch (err) {
    console.log(`  Supabase: ❌ ${err}`)
    return
  }
  
  try {
    const info = await qdrant.getCollection('paper_chunks')
    console.log(`  Qdrant: ✅ (${info.points_count} points)`)
    
    if (info.points_count === 0) {
      console.log('\n⚠️  Qdrant has no data yet. Run migration first.')
      console.log('   Only embedding benchmark will run.\n')
      await benchmarkEmbedding()
      return
    }
  } catch (err) {
    console.log(`  Qdrant: ❌ ${err}`)
    return
  }
  
  // Run benchmarks
  const embedding = await benchmarkEmbedding()
  const search = await benchmarkSearch()
  const batch = await benchmarkBatchSearch()
  
  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 SUMMARY')
  console.log('='.repeat(60))
  
  const searchSpeedup = search.pgvectorMs / search.qdrantMs
  const batchSpeedup = batch.pgvectorMs / batch.qdrantMs
  
  console.log(`
  Embedding (BGE-large self-hosted):
    ${(embedding.bgeMs / 3).toFixed(1)}ms per text
    
  Vector Search:
    pgvector: ${(search.pgvectorMs / 5).toFixed(1)}ms/query
    Qdrant:   ${(search.qdrantMs / 5).toFixed(1)}ms/query
    Speedup:  ${searchSpeedup.toFixed(1)}x faster
    
  Batch Search (50 queries):
    pgvector: ${(batch.pgvectorMs / 50).toFixed(1)}ms/query
    Qdrant:   ${(batch.qdrantMs / 50).toFixed(1)}ms/query
    Speedup:  ${batchSpeedup.toFixed(1)}x faster
`)
  
  console.log('='.repeat(60))
}

main().catch(console.error)
