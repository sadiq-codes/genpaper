/**
 * Check paper ingestion progress
 * Usage: npx tsx scripts/check-progress.ts
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { getEmbeddingProviderName } from '@/lib/ai/vercel-client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkProgress() {
  console.log('==================================================')
  console.log('📊 Paper Database Status')
  console.log('==================================================')
  console.log('Embedding provider:   ', getEmbeddingProviderName())

  // Total papers
  const { count: totalPapers } = await supabase
    .from('papers')
    .select('*', { count: 'exact', head: true })
  
  console.log('Total papers:        ', (totalPapers || 0).toLocaleString())

  // Papers by source
  const { data: sourceCounts } = await supabase
    .from('papers')
    .select('source')
  
  if (sourceCounts) {
    const counts: Record<string, number> = {}
    for (const row of sourceCounts) {
      counts[row.source || 'unknown'] = (counts[row.source || 'unknown'] || 0) + 1
    }
    
    console.log('')
    console.log('By Source:')
    for (const [source, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${source.padEnd(15)} ${count.toLocaleString()}`)
    }
  }

  // Recent activity (last 24h)
  const yesterday = new Date(Date.now() - 24*60*60*1000).toISOString()
  const { count: recent24h } = await supabase
    .from('papers')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', yesterday)

  // Last hour
  const lastHour = new Date(Date.now() - 60*60*1000).toISOString()
  const { count: recentHour } = await supabase
    .from('papers')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', lastHour)

  console.log('')
  console.log('Recent Activity:')
  console.log(`  Last 24 hours:     ${(recent24h || 0).toLocaleString()}`)
  console.log(`  Last hour:         ${(recentHour || 0).toLocaleString()}`)

  // Estimate rate
  if (recentHour && recentHour > 0) {
    const rate = recentHour / 3600
    console.log(`  Current rate:      ~${rate.toFixed(1)} papers/sec`)
  }

  // Check for local progress file
  const fs = await import('fs')
  const progressFile = '.bulk-ingest-core-progress.json'
  if (fs.existsSync(progressFile)) {
    const progress = JSON.parse(fs.readFileSync(progressFile, 'utf-8'))
    console.log('')
    console.log('Local Progress File:')
    console.log(`  Offset:            ${progress.offset?.toLocaleString() || 'N/A'}`)
    console.log(`  Ingested:          ${progress.totalIngested?.toLocaleString() || 'N/A'}`)
    console.log(`  Duplicates:        ${progress.totalDuplicates?.toLocaleString() || 'N/A'}`)
    console.log(`  Errors:            ${progress.totalErrors || 0}`)
    console.log(`  Last updated:      ${progress.lastUpdated || 'N/A'}`)
  }

  console.log('==================================================')
}

checkProgress().catch(console.error)
