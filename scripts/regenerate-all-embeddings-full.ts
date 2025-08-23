#!/usr/bin/env tsx

/**
 * Regenerate ALL embeddings in batches
 * This processes every single paper and chunk until complete
 */

import { getSB } from '../lib/supabase/server'
import { generateEmbeddings } from '../lib/utils/embedding'

async function main() {
  console.log('🔄 FULL EMBEDDING REGENERATION (384 dimensions)')
  console.log('='.repeat(60))
  
  const supabase = await getSB()
  
  // 1. Process ALL papers in batches
  console.log('\n🧠 1. REGENERATING ALL PAPER EMBEDDINGS')
  console.log('-'.repeat(40))
  
  let totalPapersProcessed = 0
  let paperBatch = 0
  const paperBatchSize = 50
  
  while (true) {
    paperBatch++
    console.log(`\n📄 Processing paper batch ${paperBatch}...`)
    
    const { data: papers, error: papersError } = await supabase
      .from('papers')
      .select('id, title, abstract')
      .is('embedding', null)
      .limit(paperBatchSize)
    
    if (papersError) {
      console.log(`❌ Error fetching papers: ${papersError.message}`)
      break
    }
    
    if (!papers || papers.length === 0) {
      console.log(`✅ No more papers to process`)
      break
    }
    
    console.log(`   Processing ${papers.length} papers...`)
    
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
          totalPapersProcessed++
          if (i % 10 === 0 || i === papers.length - 1) {
            console.log(`     ${i + 1}/${papers.length} in batch - Total: ${totalPapersProcessed}`)
          }
        }
      } catch (error) {
        console.log(`❌ Failed to generate embedding for ${paper.id}: ${error}`)
      }
    }
  }
  
  console.log(`✅ Completed ${totalPapersProcessed} paper embeddings`)
  
  // 2. Process ALL chunks in batches
  console.log('\n📝 2. REGENERATING ALL CHUNK EMBEDDINGS')
  console.log('-'.repeat(40))
  
  let totalChunksProcessed = 0
  let chunkBatch = 0
  const chunkBatchSize = 20 // Smaller batches for chunks
  
  while (true) {
    chunkBatch++
    console.log(`\n📝 Processing chunk batch ${chunkBatch}...`)
    
    const { data: chunks, error: chunksError } = await supabase
      .from('paper_chunks')
      .select('id, paper_id, content')
      .is('embedding', null)
      .limit(chunkBatchSize)
    
    if (chunksError) {
      console.log(`❌ Error fetching chunks: ${chunksError.message}`)
      break
    }
    
    if (!chunks || chunks.length === 0) {
      console.log(`✅ No more chunks to process`)
      break
    }
    
    console.log(`   Processing ${chunks.length} chunks...`)
    
    // Process chunks in smaller sub-batches for embedding generation
    const embeddingBatchSize = 10
    for (let i = 0; i < chunks.length; i += embeddingBatchSize) {
      const subBatch = chunks.slice(i, i + embeddingBatchSize)
      const contents = subBatch.map(chunk => chunk.content)
      
      try {
        const embeddings = await generateEmbeddings(contents)
        
        // Update each chunk in the sub-batch
        for (let j = 0; j < subBatch.length; j++) {
          const chunk = subBatch[j]
          const embedding = embeddings[j]
          
          const { error: updateError } = await supabase
            .from('paper_chunks')
            .update({ embedding })
            .eq('id', chunk.id)
          
          if (updateError) {
            console.log(`❌ Failed to update chunk ${chunk.id}: ${updateError.message}`)
          } else {
            totalChunksProcessed++
          }
        }
        
        console.log(`     ${Math.min(i + embeddingBatchSize, chunks.length)}/${chunks.length} in batch - Total: ${totalChunksProcessed}`)
        
      } catch (error) {
        console.log(`❌ Failed to generate embeddings for sub-batch: ${error}`)
      }
    }
  }
  
  console.log(`✅ Completed ${totalChunksProcessed} chunk embeddings`)
  
  // 3. Final verification
  console.log('\n✅ 3. FINAL VERIFICATION')
  console.log('-'.repeat(40))
  
  const { data: finalPaperStats } = await supabase
    .from('papers')
    .select('id', { count: 'exact' })
    .not('embedding', 'is', null)
  
  const { data: finalChunkStats } = await supabase
    .from('paper_chunks')
    .select('id', { count: 'exact' })
    .not('embedding', 'is', null)
    
  const { data: allPapers } = await supabase
    .from('papers')
    .select('id', { count: 'exact' })
    
  const { data: allChunks } = await supabase
    .from('paper_chunks')
    .select('id', { count: 'exact' })
  
  const papersComplete = (finalPaperStats?.length || 0)
  const chunksComplete = (finalChunkStats?.length || 0)
  const totalPapers = (allPapers?.length || 0)
  const totalChunks = (allChunks?.length || 0)
  
  console.log(`📄 Papers: ${papersComplete}/${totalPapers} with embeddings (${Math.round((papersComplete/totalPapers)*100)}%)`)
  console.log(`📝 Chunks: ${chunksComplete}/${totalChunks} with embeddings (${Math.round((chunksComplete/totalChunks)*100)}%)`)
  
  if (papersComplete === totalPapers && chunksComplete === totalChunks) {
    console.log('\n🎉 ALL EMBEDDINGS COMPLETE!')
    console.log('✅ Ready to restore NOT NULL constraints')
    console.log('✅ Ready to test vector search functionality')
  } else {
    console.log('\n⚠️  Some embeddings still missing - run script again or check errors above')
  }
}

main().catch(console.error)
