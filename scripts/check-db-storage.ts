#!/usr/bin/env npx tsx
/**
 * Check database storage usage for embeddings
 * 
 * Usage:
 *   npx tsx scripts/check-db-storage.ts
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// Load .env.local
config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function getTableStats(table: string) {
  // Get row count
  const { count } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
  
  // Try to get a sample row to check if embeddings exist
  const { data: sample } = await supabase
    .from(table)
    .select('id, embedding')
    .limit(1)
  
  const hasEmbedding = sample?.[0]?.embedding !== null
  
  return { count: count || 0, hasEmbedding }
}

async function getDbSize() {
  // This requires executing SQL directly
  const { data, error } = await supabase.rpc('get_db_size')
  if (error) {
    // Function might not exist, return null
    return null
  }
  return data
}

async function main() {
  console.log('📊 Supabase Storage Check\n')
  console.log(`URL: ${supabaseUrl}\n`)
  
  // Check each table
  const tables = ['papers', 'paper_chunks', 'paper_claims']
  
  console.log('Table Statistics:')
  console.log('─'.repeat(60))
  
  let totalRows = 0
  let totalEmbeddingMB = 0
  
  for (const table of tables) {
    try {
      const stats = await getTableStats(table)
      totalRows += stats.count
      
      // Estimate embedding storage: vector(1024) = 4KB per row
      const embeddingMB = stats.hasEmbedding ? (stats.count * 4 / 1024) : 0
      totalEmbeddingMB += embeddingMB
      
      console.log(`${table.padEnd(20)} ${stats.count.toLocaleString().padStart(10)} rows  ${stats.hasEmbedding ? `~${embeddingMB.toFixed(1)} MB embeddings` : 'no embeddings'}`)
    } catch (e) {
      console.log(`${table.padEnd(20)} Error: ${e}`)
    }
  }
  
  console.log('─'.repeat(60))
  console.log(`${'TOTAL'.padEnd(20)} ${totalRows.toLocaleString().padStart(10)} rows  ~${totalEmbeddingMB.toFixed(1)} MB embeddings`)
  
  console.log('\n📌 Notes:')
  console.log('  - Embedding size estimate: vector(1024) = 4KB per row')
  console.log('  - Actual storage varies with PostgreSQL overhead')
  console.log('  - Run VACUUM FULL to reclaim space after NULLing embeddings')
  
  console.log('\n🔧 To clean up embeddings, run:')
  console.log('  npx supabase db push')
  console.log('  # or apply migration manually in Supabase dashboard')
}

main().catch(console.error)
