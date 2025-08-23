#!/usr/bin/env tsx

/**
 * Diagnostic script for chunk search issues
 * 
 * Checks:
 * 1. Chunk counts per paper
 * 2. Embedding dimensions
 * 3. search_vector population 
 * 4. Sample chunk search with relaxed parameters
 */

import { getSB } from '../lib/supabase/server'

const EXPECTED_PAPER_IDS = [
  'f1a81953-7b63-4dc9-baa4-27cbaeac5e99',
  '2f77016a-a8bd-4aee-93d2-5bed9bc14fc8', 
  '1c2ab16f-1808-4f15-a3f8-4da8fb880751',
  '9006e569-f646-44b2-9b7b-bfbc4f243cec',
  'f70b3145-db45-490a-a1a0-b8cf18ca575c',
  'c5013ea5-7e26-4401-a512-1e474415081d',
  'f34832d1-aecd-4ed1-95f2-f4692976fc28',
  '8962e87e-80e9-4659-9e35-81cda14958bf',
  '63d285b4-6230-4c2e-af25-131bdc4a5ba1',
  '1d450795-dc20-41e8-bd79-676d033715ca',
  '38f951d0-9b47-4a90-88af-35a4beb924ad',
  '00204e90-85e4-424b-8179-554a45f9e1a5',
  '137c3859-9fff-4ae7-a648-c490bc546fff',
  '6b78921b-dfda-492a-8aea-596eaa48aacf',
  '601ae36f-9350-4a57-adce-daeec5a52000',
  'f128e141-0016-4887-bf52-54c32dde0cd6',
  '750cc52e-da08-4e36-a3b8-8c0aa3943ff7',
  '752f520a-b97d-4404-8506-da5c14743623',
  '50eb0440-ea5c-428c-b96b-01388efcf53a',
  'ecf407e0-ab44-4ddd-838e-0aeb60e0d27a',
  '4dd603eb-dffd-4e1a-8acb-30e7732d3d0e',
  '4a47a058-c251-4f5d-beb4-e3dc91dc0957',
  '034afbeb-401c-49c6-817f-4863f86fa977',
  '9cd5d65c-9f93-4008-aaf5-eaeddfa54e00',
  'e5274407-ac7e-4e81-b974-b58f1ff27e83'
]

async function main() {
  console.log('🔍 CHUNK SEARCH DIAGNOSTIC SCRIPT')
  console.log('='.repeat(50))
  
  const supabase = await getSB()
  
  // 1. Check chunk counts per expected paper
  console.log('\n📊 1. CHUNK COUNTS PER EXPECTED PAPER')
  console.log('-'.repeat(40))
  
  const chunkCounts = await Promise.all(
    EXPECTED_PAPER_IDS.map(async (paperId) => {
      const { count, error } = await supabase
        .from('paper_chunks')
        .select('*', { count: 'exact' })
        .eq('paper_id', paperId)
      
      if (error) {
        console.log(`❌ ${paperId}: Error - ${error.message}`)
        return { paperId, count: 0, error: error.message }
      }
      
      return { paperId, count: count || 0 }
    })
  )
  
  const withChunks = chunkCounts.filter(p => p.count > 0)
  const withoutChunks = chunkCounts.filter(p => p.count === 0)
  
  console.log(`✅ Papers WITH chunks: ${withChunks.length}`)
  withChunks.forEach(p => console.log(`   📄 ${p.paperId}: ${p.count} chunks`))
  
  console.log(`❌ Papers WITHOUT chunks: ${withoutChunks.length}`)
  withoutChunks.slice(0, 5).forEach(p => console.log(`   📄 ${p.paperId}: 0 chunks`))
  if (withoutChunks.length > 5) {
    console.log(`   ... and ${withoutChunks.length - 5} more`)
  }
  
  // 2. Check paper metadata and embeddings
  console.log('\n🧠 2. PAPER METADATA & EMBEDDING CHECK')
  console.log('-'.repeat(40))
  
  const { data: papers, error: papersError } = await supabase
    .from('papers')
    .select('id, title, embedding')
    .in('id', EXPECTED_PAPER_IDS.slice(0, 5)) // Sample first 5
  
  if (papersError) {
    console.log(`❌ Error fetching papers: ${papersError.message}`)
  } else {
    papers?.forEach(paper => {
      const hasEmbedding = paper.embedding && paper.embedding.length > 0
      const embeddingDims = hasEmbedding ? paper.embedding.length : 0
      
      console.log(`📄 "${paper.title?.substring(0, 50)}..."`)
      console.log(`   ID: ${paper.id}`)
      console.log(`   Embedding: ${hasEmbedding ? `✅ ${embeddingDims} dims` : '❌ Missing'}`)
    })
  }
  
  // 3. Check paper_chunks schema and embedding dimensions using SQL
  console.log('\n🔧 3. CHUNK SCHEMA & EMBEDDING CHECK')
  console.log('-'.repeat(40))
  
  const { data: sampleChunks, error: chunksError } = await supabase
    .from('paper_chunks')
    .select('paper_id, content')
    .not('embedding', 'is', null)
    .limit(5)
  
  if (chunksError) {
    console.log(`❌ Error fetching chunks: ${chunksError.message}`)
  } else if (!sampleChunks || sampleChunks.length === 0) {
    console.log(`❌ No chunks with embeddings found`)
  } else {
    console.log(`✅ Found ${sampleChunks.length} chunks with embeddings`)
    sampleChunks.forEach((chunk, i) => {
      console.log(`   ${i + 1}. Paper: ${chunk.paper_id}`)
      console.log(`      Content: "${chunk.content.substring(0, 60)}..."`)
    })
    
    console.log(`\n🔍 To check vector dimensions, run this SQL in Supabase:`)
    console.log(`   SELECT vector_dims(embedding), COUNT(*) FROM paper_chunks WHERE embedding IS NOT NULL GROUP BY vector_dims(embedding);`)
  }
  
  // 4. Test relaxed chunk search
  console.log('\n🔍 4. RELAXED CHUNK SEARCH TEST')
  console.log('-'.repeat(40))
  
  try {
    const { generateEmbeddings } = await import('../lib/utils/embedding')
    const query = 'artificial intelligence healthcare'
    const [queryEmbedding] = await generateEmbeddings([query])
    
    console.log(`🎯 Query: "${query}"`)
    console.log(`🧠 Query embedding: ${queryEmbedding.length} dimensions`)
    
    // Test with very relaxed parameters
    const { data: relaxedResults, error: searchError } = await supabase
      .rpc('match_paper_chunks', {
        query_embedding: queryEmbedding,
        match_count: 50, // Higher count
        min_score: 0.1,  // Much lower threshold
        paper_ids: EXPECTED_PAPER_IDS // Constrain to expected papers
      })
    
    if (searchError) {
      console.log(`❌ Relaxed search failed: ${searchError.message}`)
    } else {
      console.log(`✅ Relaxed search found: ${relaxedResults?.length || 0} chunks`)
      
      if (relaxedResults && relaxedResults.length > 0) {
        const scores = relaxedResults.map((r: any) => r.score)
        const paperIds = [...new Set(relaxedResults.map((r: any) => r.paper_id))]
        
        console.log(`   📊 Score range: ${Math.min(...scores).toFixed(3)} - ${Math.max(...scores).toFixed(3)}`)
        console.log(`   📄 Unique papers: ${paperIds.length}`)
        console.log(`   🎯 Expected papers found: ${paperIds.filter(id => EXPECTED_PAPER_IDS.includes(id)).length}`)
        
        // Show top 3 results
        relaxedResults.slice(0, 3).forEach((result: any, i: number) => {
          console.log(`   ${i + 1}. Paper: ${result.paper_id}, Score: ${result.score.toFixed(3)}`)
          console.log(`      Content: "${result.content.substring(0, 80)}..."`)
        })
      }
    }
    
  } catch (error) {
    console.log(`❌ Embedding generation failed: ${error}`)
  }
  
  // 5. Overall recommendations
  console.log('\n💡 5. RECOMMENDATIONS')
  console.log('-'.repeat(40))
  
  const totalWithoutChunks = withoutChunks.length
  const totalWithChunks = withChunks.length
  
  if (totalWithoutChunks > totalWithChunks) {
    console.log(`🚨 CRITICAL: ${totalWithoutChunks}/${EXPECTED_PAPER_IDS.length} papers have no chunks`)
    console.log(`   → Run ingestion for papers without chunks`)
    console.log(`   → Check PDF processing status for these papers`)
  }
  
  if (totalWithChunks > 0 && totalWithChunks < 5) {
    console.log(`⚠️  WARNING: Only ${totalWithChunks} papers have chunks`)
    console.log(`   → Ingestion may be incomplete`)
    console.log(`   → Consider re-running PDF processing`)
  }
  
  if (totalWithChunks >= 5) {
    console.log(`✅ GOOD: ${totalWithChunks} papers have chunks`)
    console.log(`   → Try relaxed search parameters:`)
    console.log(`     - Lower minScore (0.1 instead of 0.6)`)
    console.log(`     - Higher match_count (100+ instead of 20)`)
    console.log(`     - Broader query terms`)
  }
  
  console.log('\n🔍 Next steps:')
  console.log('1. For papers without chunks: re-ingest with PDF/full text')
  console.log('2. For existing chunks: adjust search thresholds')
  console.log('3. Verify chunk search paper ID filtering is correct')
}

main().catch(console.error)
