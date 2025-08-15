#!/usr/bin/env tsx

/**
 * Check Recent PDF Processing Activity
 * Examines database for signs of PDF processing activity
 */

// Load environment variables
try {
  require('dotenv').config({ path: '.env.local' })
} catch {}

import { getServiceClient } from '../lib/supabase/service'

async function checkRecentActivity() {
  console.log('🔍 Checking Recent PDF Processing Activity')
  console.log('=' .repeat(45))
  
  try {
    const supabase = getServiceClient()
    
    // 1. Check recent papers
    console.log('\n📄 Recent Papers (last 10):')
    const { data: recentPapers, error: papersError } = await supabase
      .from('papers')
      .select('id, title, pdf_content, created_at, pdf_url')
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (papersError) throw papersError
    
    let withContent = 0, withPdfUrl = 0, withoutContent = 0
    
    recentPapers?.forEach((paper, i) => {
      const hasContent = paper.pdf_content && paper.pdf_content.length > 100
      const hasPdfUrl = !!paper.pdf_url
      if (hasContent) withContent++
      else if (hasPdfUrl) withPdfUrl++
      else withoutContent++
      
      console.log(`   ${i + 1}. ${paper.title?.slice(0, 50)}...`)
      console.log(`      ID: ${paper.id}`)
      console.log(`      Content: ${hasContent ? `YES (${paper.pdf_content?.length} chars)` : 'NO'}`)
      console.log(`      PDF URL: ${hasPdfUrl ? 'YES' : 'NO'}`)
      console.log(`      Created: ${paper.created_at}`)
    })
    
    console.log(`\n   Summary: ${withContent} with content, ${withPdfUrl} with PDF URLs, ${withoutContent} neither`)
    
    // 2. Check PDF processing logs
    console.log('\n📋 PDF Processing Logs (last 10):')
    const { data: logs, error: logsError } = await supabase
      .from('pdf_processing_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (logsError) {
      console.log('   No pdf_processing_logs table or access denied')
    } else if (!logs || logs.length === 0) {
      console.log('   ❌ No PDF processing logs found!')
      console.log('      This suggests PDF queue is not running or not logging')
    } else {
      logs.forEach((log, i) => {
        console.log(`   ${i + 1}. Paper: ${log.paper_id}`)
        console.log(`      Status: ${log.status}`)
        console.log(`      Attempts: ${log.attempts}`)
        console.log(`      Error: ${log.error_message || 'None'}`)
        console.log(`      Created: ${log.created_at}`)
      })
    }
    
    // 3. Check recent chunks
    console.log('\n🧩 Recent Chunks (last 10):')
    const { data: recentChunks, error: chunksError } = await supabase
      .from('paper_chunks')
      .select('id, paper_id, content, created_at')
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (chunksError) throw chunksError
    
    if (!recentChunks || recentChunks.length === 0) {
      console.log('   ❌ No recent chunks found!')
    } else {
      recentChunks.forEach((chunk, i) => {
        console.log(`   ${i + 1}. Paper: ${chunk.paper_id}`)
        console.log(`      Content: ${chunk.content.slice(0, 80)}...`)
        console.log(`      Created: ${chunk.created_at}`)
      })
    }
    
    // 4. Analysis
    console.log('\n📊 ANALYSIS:')
    
    if (withContent > 0) {
      console.log(`   ✅ ${withContent} recent papers have PDF content - pipeline may be working!`)
    } else {
      console.log(`   ❌ 0 recent papers have PDF content - pipeline is not working`)
    }
    
    if (logs && logs.length > 0) {
      const successCount = logs.filter(l => l.status === 'completed').length
      const failCount = logs.filter(l => l.status === 'failed').length
      console.log(`   📋 Processing logs: ${successCount} success, ${failCount} failed`)
    } else {
      console.log(`   📋 No processing logs - queue may not be running`)
    }
    
    if (recentChunks && recentChunks.length > 0) {
      console.log(`   🧩 ${recentChunks.length} recent chunks created`)
    } else {
      console.log(`   🧩 No recent chunks - content processing not working`)
    }
    
    // 5. Recommendations
    console.log('\n🎯 RECOMMENDATIONS:')
    
    if (withContent === 0 && withPdfUrl > 0) {
      console.log('   1. Papers have PDF URLs but no content - PDF processing failing')
      console.log('   2. Check if SimplePDFProcessor.processPDF is being called')
      console.log('   3. Verify PDF extraction is working (we already tested this)')
      console.log('   4. Check if database updates are happening after extraction')
    }
    
    if (!logs || logs.length === 0) {
      console.log('   1. PDF processing queue is not logging activities')
      console.log('   2. Papers may not be getting queued at all')
      console.log('   3. Need to verify queuePdfProcessing function is being called')
    }
    
  } catch (error) {
    console.error('❌ Analysis failed:', error)
  }
}

if (require.main === module) {
  checkRecentActivity().catch(console.error)
}
