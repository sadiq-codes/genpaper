#!/usr/bin/env tsx

/**
 * Test that embeddings are working correctly after regeneration
 */

import { getSB } from '../lib/supabase/server'
import { generateEmbeddings } from '../lib/utils/embedding'

async function main() {
  console.log('🧪 TESTING EMBEDDING FUNCTIONALITY')
  console.log('='.repeat(50))
  
  const supabase = await getSB()
  
  // 1. Test query embedding generation
  console.log('\n🧠 1. TESTING QUERY EMBEDDING GENERATION')
  console.log('-'.repeat(40))
  
  const testQuery = 'artificial intelligence healthcare'
  const [queryEmbedding] = await generateEmbeddings([testQuery])
  
  console.log(`✅ Query: "${testQuery}"`)
  console.log(`✅ Embedding dimensions: ${queryEmbedding.length}`)
  console.log(`✅ Sample values: [${queryEmbedding.slice(0, 5).map(x => x.toFixed(3)).join(', ')}...]`)
  
  if (queryEmbedding.length !== 384) {
    console.log(`❌ WRONG DIMENSIONS! Expected 384, got ${queryEmbedding.length}`)
    return
  }
  
  // 2. Test database vector dimensions
  console.log('\n🗄️ 2. TESTING DATABASE VECTOR DIMENSIONS')
  console.log('-'.repeat(40))
  
  // Check papers
  const { data: papers, error: papersError } = await supabase
    .from('papers')
    .select('id', { count: 'exact' })
    .not('embedding', 'is', null)
    
  const { data: allPapers, error: allPapersError } = await supabase
    .from('papers')
    .select('id', { count: 'exact' })
  
  // Check chunks  
  const { data: chunks, error: chunksError } = await supabase
    .from('paper_chunks')
    .select('id', { count: 'exact' })
    .not('embedding', 'is', null)
    
  const { data: allChunks, error: allChunksError } = await supabase
    .from('paper_chunks')
    .select('id', { count: 'exact' })
  
  if (papersError || allPapersError || chunksError || allChunksError) {
    console.log(`❌ Database query failed`)
  } else {
    const papersWithEmbeddings = papers?.length || 0
    const totalPapers = allPapers?.length || 0
    const chunksWithEmbeddings = chunks?.length || 0  
    const totalChunks = allChunks?.length || 0
    
    const paperPercent = totalPapers > 0 ? Math.round((papersWithEmbeddings / totalPapers) * 100) : 0
    const chunkPercent = totalChunks > 0 ? Math.round((chunksWithEmbeddings / totalChunks) * 100) : 0
    
    console.log(`📊 papers: ${papersWithEmbeddings}/${totalPapers} with embeddings (${paperPercent}%)`)
    console.log(`📊 paper_chunks: ${chunksWithEmbeddings}/${totalChunks} with embeddings (${chunkPercent}%)`)
  }
  
  // 3. Test vector search functionality
  console.log('\n🔍 3. TESTING VECTOR SEARCH')
  console.log('-'.repeat(40))
  
  try {
    const { data: searchResults, error: searchError } = await supabase
      .rpc('match_paper_chunks', {
        query_embedding: queryEmbedding,
        match_count: 5,
        min_score: 0.1
      })
    
    if (searchError) {
      console.log(`❌ Vector search failed: ${searchError.message}`)
    } else {
      console.log(`✅ Vector search found: ${searchResults?.length || 0} results`)
      
      if (searchResults && searchResults.length > 0) {
        const scores = searchResults.map((r: any) => r.score)
        console.log(`📊 Score range: ${Math.min(...scores).toFixed(3)} - ${Math.max(...scores).toFixed(3)}`)
        
        searchResults.slice(0, 3).forEach((result: any, i: number) => {
          console.log(`   ${i + 1}. Score: ${result.score.toFixed(3)} - "${result.content.substring(0, 60)}..."`)
        })
      }
    }
  } catch (error) {
    console.log(`❌ Vector search test failed: ${error}`)
  }
  
  // 4. Test hybrid search
  console.log('\n🔀 4. TESTING HYBRID SEARCH')
  console.log('-'.repeat(40))
  
  try {
    const { data: hybridResults, error: hybridError } = await supabase
      .rpc('hybrid_search_papers', {
        query_text: testQuery,
        query_embedding: queryEmbedding,
        match_count: 5,
        min_year: 2020,
        semantic_weight: 0.7
      })
    
    if (hybridError) {
      console.log(`❌ Hybrid search failed: ${hybridError.message}`)
    } else {
      console.log(`✅ Hybrid search found: ${hybridResults?.length || 0} results`)
      
      if (hybridResults && hybridResults.length > 0) {
        const semanticScores = hybridResults.map((r: any) => r.semantic_score)
        const keywordScores = hybridResults.map((r: any) => r.keyword_score)
        const combinedScores = hybridResults.map((r: any) => r.combined_score)
        
        console.log(`📊 Semantic scores: ${Math.min(...semanticScores).toFixed(3)} - ${Math.max(...semanticScores).toFixed(3)}`)
        console.log(`📊 Keyword scores: ${Math.min(...keywordScores).toFixed(3)} - ${Math.max(...keywordScores).toFixed(3)}`)
        console.log(`📊 Combined scores: ${Math.min(...combinedScores).toFixed(3)} - ${Math.max(...combinedScores).toFixed(3)}`)
        
        const hasSemanticScores = semanticScores.some(s => s > 0)
        const hasKeywordScores = keywordScores.some(s => s > 0)
        
        console.log(`${hasSemanticScores ? '✅' : '❌'} Semantic scoring working`)
        console.log(`${hasKeywordScores ? '✅' : '❌'} Keyword scoring working`)
      }
    }
  } catch (error) {
    console.log(`❌ Hybrid search test failed: ${error}`)
  }
  
  // 5. Summary
  console.log('\n📋 5. SUMMARY')
  console.log('-'.repeat(40))
  
  console.log('✅ If all tests passed, your embedding system is working!')
  console.log('🔍 Vector search should now return meaningful results')
  console.log('🔀 Hybrid search should blend semantic + keyword scores')
  console.log('📊 Chunk search recall should be much higher')
}

main().catch(console.error)
