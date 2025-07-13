import { getSB } from '@/lib/supabase/server'
import { generateEmbeddings } from '@/lib/utils/embedding'

async function backfillEmbeddings() {
  console.log('🚀 Starting embedding backfill process...')
  
  const supabase = await getSB()
  
  // Get papers without embeddings
  const { data: papers, error } = await supabase
    .from('papers')
    .select('id, title, abstract')
    .is('embedding', null)
    .not('title', 'is', null)
  
  if (error) {
    console.error('❌ Error fetching papers:', error)
    return
  }
  
  if (!papers || papers.length === 0) {
    console.log('✅ No papers need embedding backfill')
    return
  }
  
  console.log(`📊 Found ${papers.length} papers without embeddings`)
  
  // Process in batches to avoid rate limits
  const BATCH_SIZE = 10
  let processed = 0
  
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
      
      // Generate embeddings using centralized function
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
        } else {
          processed++
          console.log(`✅ Updated paper ${update.id} (${processed}/${papers.length})`)
        }
      }
      
      // Rate limiting - wait between batches
      if (i + BATCH_SIZE < papers.length) {
        console.log('⏳ Waiting 1 second before next batch...')
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      
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
  
  if (!verifyError && verifyCount) {
    console.log(`✅ Verification: ${verifyCount.length} papers now have embeddings`)
  }
}

// Run the backfill if this script is executed directly
if (require.main === module) {
  backfillEmbeddings()
    .then(() => {
      console.log('✅ Backfill script completed')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Backfill script failed:', error)
      process.exit(1)
    })
}

export { backfillEmbeddings } 