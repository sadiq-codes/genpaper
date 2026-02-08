#!/usr/bin/env tsx

/**
 * Regenerate ALL embeddings with correct 1024 dimensions
 * 
 * Uses OpenAI text-embedding-3-small with dimensions=1024
 * Run after the 20260208 migration to regenerate embeddings
 */

import { createClient } from '@supabase/supabase-js'
import { generateEmbeddings } from '../lib/utils/embedding'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('🔄 REGENERATING ALL EMBEDDINGS (1024 dimensions)')
  console.log('   Using OpenAI text-embedding-3-small')
  console.log('='.repeat(60))
  
  // 1. Check current state
  console.log('\n📊 1. CHECKING CURRENT STATE')
  console.log('-'.repeat(40))
  
  const { count: totalPapers } = await supabase
    .from('papers')
    .select('*', { count: 'exact', head: true })
  
  const { count: totalChunks } = await supabase
    .from('paper_chunks')  
    .select('*', { count: 'exact', head: true })

  const { count: papersNeedingEmbeddings } = await supabase
    .from('papers')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null)

  const { count: chunksNeedingEmbeddings } = await supabase
    .from('paper_chunks')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null)
    
  console.log(`📄 Total papers: ${totalPapers}`)
  console.log(`📄 Papers needing embeddings: ${papersNeedingEmbeddings}`)
  console.log(`📝 Total chunks: ${totalChunks}`)
  console.log(`📝 Chunks needing embeddings: ${chunksNeedingEmbeddings}`)
  
  if (papersNeedingEmbeddings === 0 && chunksNeedingEmbeddings === 0) {
    console.log('\n✅ All embeddings are already generated!')
    return
  }
  
  // 2. Regenerate paper embeddings
  console.log('\n🧠 2. REGENERATING PAPER EMBEDDINGS')
  console.log('-'.repeat(40))
  
  const BATCH_SIZE = 50
  let processed = 0
  let hasMore = true
  
  while (hasMore) {
    const { data: papers, error: papersError } = await supabase
      .from('papers')
      .select('id, title, abstract')
      .is('embedding', null)
      .limit(BATCH_SIZE)
    
    if (papersError) {
      console.log(`❌ Error fetching papers: ${papersError.message}`)
      return
    }
    
    if (!papers || papers.length === 0) {
      hasMore = false
      break
    }
    
    // Generate embeddings in batch
    const texts = papers.map(p => `${p.title}\n${p.abstract || ''}`)
    
    try {
      const embeddings = await generateEmbeddings(texts)
      
      // Update each paper
      for (let i = 0; i < papers.length; i++) {
        const { error: updateError } = await supabase
          .from('papers')
          .update({ embedding: embeddings[i] })
          .eq('id', papers[i].id)
        
        if (updateError) {
          console.log(`❌ Failed to update paper ${papers[i].id}: ${updateError.message}`)
        }
      }
      
      processed += papers.length
      console.log(`   ${processed}/${papersNeedingEmbeddings} papers (${Math.round(processed/papersNeedingEmbeddings!*100)}%)`)
      
    } catch (error) {
      console.log(`❌ Batch failed: ${error}`)
      // Small delay on error
      await new Promise(r => setTimeout(r, 2000))
    }
    
    // Small delay between batches to avoid rate limits
    await new Promise(r => setTimeout(r, 500))
  }
  
  console.log(`✅ Paper embeddings complete: ${processed} papers`)
  
  // 3. Regenerate chunk embeddings  
  console.log('\n📝 3. REGENERATING CHUNK EMBEDDINGS')
  console.log('-'.repeat(40))
  
  processed = 0
  hasMore = true
  
  while (hasMore) {
    const { data: chunks, error: chunksError } = await supabase
      .from('paper_chunks')
      .select('id, content')
      .is('embedding', null)
      .limit(BATCH_SIZE)
    
    if (chunksError) {
      console.log(`❌ Error fetching chunks: ${chunksError.message}`)
      return
    }
    
    if (!chunks || chunks.length === 0) {
      hasMore = false
      break
    }
    
    try {
      const embeddings = await generateEmbeddings(chunks.map(c => c.content))
      
      // Update each chunk
      for (let i = 0; i < chunks.length; i++) {
        const { error: updateError } = await supabase
          .from('paper_chunks')
          .update({ embedding: embeddings[i] })
          .eq('id', chunks[i].id)
        
        if (updateError) {
          console.log(`❌ Failed to update chunk ${chunks[i].id}: ${updateError.message}`)
        }
      }
      
      processed += chunks.length
      console.log(`   ${processed}/${chunksNeedingEmbeddings} chunks (${Math.round(processed/chunksNeedingEmbeddings!*100)}%)`)
      
    } catch (error) {
      console.log(`❌ Batch failed: ${error}`)
      await new Promise(r => setTimeout(r, 2000))
    }
    
    await new Promise(r => setTimeout(r, 500))
  }
  
  console.log(`✅ Chunk embeddings complete: ${processed} chunks`)
  
  // 4. Verify results
  console.log('\n✅ 4. VERIFICATION')
  console.log('-'.repeat(40))
  
  const { count: finalPapers } = await supabase
    .from('papers')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null)
  
  const { count: finalChunks } = await supabase
    .from('paper_chunks')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null)
  
  console.log(`📄 Papers with embeddings: ${finalPapers}/${totalPapers}`)
  console.log(`📝 Chunks with embeddings: ${finalChunks}/${totalChunks}`)
  
  console.log('\n🎉 EMBEDDING REGENERATION COMPLETE!')
  console.log('Vector search now uses 1024-dimension OpenAI embeddings.')
}

main().catch(console.error)
