#!/usr/bin/env tsx

/**
 * Regenerate ALL embeddings with correct 384 dimensions
 * 
 * This fixes the corrupted embeddings caused by dimension truncation during migration
 */

import { getSB } from '../lib/supabase/server'
import { generateEmbeddings } from '../lib/utils/embedding'

async function main() {
  console.log('🔄 REGENERATING ALL EMBEDDINGS (384 dimensions)')
  console.log('='.repeat(60))
  
  const supabase = await getSB()
  
  // 1. Check current state
  console.log('\n📊 1. CHECKING CURRENT STATE')
  console.log('-'.repeat(40))
  
  const { data: paperStats } = await supabase
    .from('papers')
    .select('id', { count: 'exact' })
  
  const { data: chunkStats } = await supabase
    .from('paper_chunks')  
    .select('id', { count: 'exact' })
    
  console.log(`📄 Total papers: ${paperStats?.length || 0}`)
  console.log(`📄 Total chunks: ${chunkStats?.length || 0}`)
  
  // 2. Note about clearing embeddings
  console.log('\n🧹 2. EMBEDDINGS SHOULD BE CLEARED VIA SQL')
  console.log('-'.repeat(40))
  console.log('⚠️  Run the fix-embeddings-with-constraints.sql script first!')
  console.log('    This handles NOT NULL constraints properly.')
  console.log('    Then run this script to regenerate embeddings.')
  
  // Check if embeddings are already cleared
  const { data: existingEmbeddings } = await supabase
    .from('papers')
    .select('id', { count: 'exact' })
    .not('embedding', 'is', null)
    
  if (existingEmbeddings && existingEmbeddings.length > 0) {
    console.log(`❌ Found ${existingEmbeddings.length} papers with existing embeddings`)
    console.log('   Please run fix-embeddings-with-constraints.sql first to clear them.')
    return
  }
  
  console.log('✅ Embeddings are cleared, proceeding with regeneration')
  
  // 3. Regenerate paper embeddings
  console.log('\n🧠 3. REGENERATING PAPER EMBEDDINGS')
  console.log('-'.repeat(40))
  
  const { data: papers, error: papersError } = await supabase
    .from('papers')
    .select('id, title, abstract')
    .is('embedding', null)
    .limit(100) // Process in larger batches
  
  if (papersError) {
    console.log(`❌ Error fetching papers: ${papersError.message}`)
    return
  }
  
  if (!papers || papers.length === 0) {
    console.log('✅ No papers need embedding regeneration')
  } else {
    console.log(`📄 Processing ${papers.length} papers...`)
    
    for (let i = 0; i < papers.length; i++) {
      const paper = papers[i]
      const text = `${paper.title}\n${paper.abstract || ''}`
      
      try {
        const [embedding] = await generateEmbeddings([text])
        
        const { error: updateError } = await supabase
          .from('papers')
          .update({ embedding })
          .eq('id', paper.id)
        
        if (updateError) {
          console.log(`❌ Failed to update paper ${paper.id}: ${updateError.message}`)
        } else {
          const progress = Math.round(((i + 1) / papers.length) * 100)
          console.log(`   ${i + 1}/${papers.length} (${progress}%) - ${paper.title?.substring(0, 50)}...`)
        }
      } catch (error) {
        console.log(`❌ Failed to generate embedding for ${paper.id}: ${error}`)
      }
    }
    
    console.log('✅ Paper embeddings regenerated')
  }
  
  // 4. Regenerate chunk embeddings  
  console.log('\n📝 4. REGENERATING CHUNK EMBEDDINGS')
  console.log('-'.repeat(40))
  
  const { data: chunks, error: chunksError } = await supabase
    .from('paper_chunks')
    .select('id, paper_id, content')
    .is('embedding', null)
    .limit(100) // Process in smaller batches for chunks
  
  if (chunksError) {
    console.log(`❌ Error fetching chunks: ${chunksError.message}`)
    return
  }
  
  if (!chunks || chunks.length === 0) {
    console.log('✅ No chunks need embedding regeneration')
  } else {
    console.log(`📝 Processing ${chunks.length} chunks...`)
    
    // Process chunks in batches of 10
    const batchSize = 10
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize)
      const contents = batch.map(chunk => chunk.content)
      
      try {
        const embeddings = await generateEmbeddings(contents)
        
        // Update each chunk in the batch
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j]
          const embedding = embeddings[j]
          
          const { error: updateError } = await supabase
            .from('paper_chunks')
            .update({ embedding })
            .eq('id', chunk.id)
          
          if (updateError) {
            console.log(`❌ Failed to update chunk ${chunk.id}: ${updateError.message}`)
          }
        }
        
        const progress = Math.round(((i + batch.length) / chunks.length) * 100)
        console.log(`   ${Math.min(i + batchSize, chunks.length)}/${chunks.length} (${progress}%) chunks processed`)
        
      } catch (error) {
        console.log(`❌ Failed to generate embeddings for batch: ${error}`)
      }
    }
    
    console.log('✅ Chunk embeddings regenerated')
  }
  
  // 5. Verify results
  console.log('\n✅ 5. VERIFICATION')
  console.log('-'.repeat(40))
  
  const { data: finalPaperStats } = await supabase
    .from('papers')
    .select('id', { count: 'exact' })
    .not('embedding', 'is', null)
  
  const { data: finalChunkStats } = await supabase
    .from('paper_chunks')
    .select('id', { count: 'exact' })
    .not('embedding', 'is', null)
  
  console.log(`📄 Papers with embeddings: ${finalPaperStats?.length || 0}`)
  console.log(`📝 Chunks with embeddings: ${finalChunkStats?.length || 0}`)
  
  console.log('\n🎉 EMBEDDING REGENERATION COMPLETE!')
  console.log('Your vector search should now work properly with 384-dimension embeddings.')
  console.log('\nNext steps:')
  console.log('1. Run restore-constraints.sql to restore NOT NULL constraints')
  console.log('2. Run test-embeddings.ts to verify functionality')
  console.log('3. Test your chunk search - it should have much better recall now!')
}

main().catch(console.error)
