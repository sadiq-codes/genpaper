#!/usr/bin/env npx tsx
/**
 * Delete all paper_chunks from Supabase
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('Checking current count...')
  const { count: before } = await supabase
    .from('paper_chunks')
    .select('*', { count: 'exact', head: true })
  console.log(`Current chunks: ${before}`)
  
  if (!before || before === 0) {
    console.log('No chunks to delete')
    return
  }
  
  console.log('\nDeleting in batches of 100 (parallel deletes)...')
  let totalDeleted = 0
  
  while (true) {
    // Get small batch
    const { data: chunks } = await supabase
      .from('paper_chunks')
      .select('id')
      .limit(100)
    
    if (!chunks || chunks.length === 0) break
    
    // Delete in parallel
    const deletePromises = chunks.map(c => 
      supabase.from('paper_chunks').delete().eq('id', c.id)
    )
    
    await Promise.all(deletePromises)
    totalDeleted += chunks.length
    process.stdout.write(`\rDeleted: ${totalDeleted} / ${before}`)
  }
  
  console.log(`\n\nDone! Total deleted: ${totalDeleted}`)
  
  const { count: after } = await supabase
    .from('paper_chunks')
    .select('*', { count: 'exact', head: true })
  console.log(`Remaining: ${after}`)
}

main().catch(console.error)
