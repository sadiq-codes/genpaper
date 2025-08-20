#!/usr/bin/env tsx

/**
 * Test PDF Extraction Pipeline
 * Tests individual PDF extraction to diagnose pipeline failures
 */

// Load environment variables
try {
  require('dotenv').config({ path: '.env.local' })
} catch {}

import { extractPdfMetadataTiered } from '../lib/pdf/tiered-extractor'
import { downloadPdfBuffer } from '../lib/pdf/pdf-utils'
import { getServiceClient } from '../lib/supabase/service'
import { createChunksForPaper } from '../lib/content/ingestion'

async function testPdfExtraction() {
  console.log('🧪 Testing PDF Extraction Pipeline')
  console.log('=' .repeat(50))
  
  try {
    const supabase = getServiceClient()
    
    // 1. Get a paper with a PDF URL
    console.log('\n📄 Finding paper with PDF URL...')
    const { data: papers, error: papersError } = await supabase
      .from('papers')
      .select('id, title, pdf_url, pdf_content')
      .not('pdf_url', 'is', null)
      .limit(5)
    
    if (papersError) throw papersError
    
    if (!papers || papers.length === 0) {
      console.log('❌ No papers with PDF URLs found')
      return
    }
    
    console.log(`✅ Found ${papers.length} papers with PDF URLs`)
    papers.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.title?.slice(0, 60)}...`)
      console.log(`     PDF URL: ${p.pdf_url}`)
      console.log(`     Has content: ${p.pdf_content ? 'YES' : 'NO'}`)
    })
    
    // 2. Test PDF extraction on first paper
    const testPaper = papers[0]
    console.log(`\n🔄 Testing extraction on: ${testPaper.title?.slice(0, 60)}...`)
    
    try {
      // Step 2a: Download PDF
      console.log('📥 Downloading PDF...')
      const pdfBuffer = await downloadPdfBuffer(testPaper.pdf_url)
      console.log(`✅ Downloaded ${pdfBuffer.length} bytes`)
      
      // Step 2b: Extract content
      console.log('🔍 Extracting content...')
      const extractionResult = await extractPdfMetadataTiered(pdfBuffer, {
        enableOcr: false,
        maxTimeoutMs: 30000
      })
      
      console.log('✅ Extraction completed!')
      console.log(`   Full text length: ${extractionResult.fullText?.length || 0} chars`)
      console.log(`   Title: ${extractionResult.title || 'Not found'}`)
      console.log(`   Content preview: ${extractionResult.fullText?.slice(0, 200)}...`)
      
      // Step 2c: Save to database
      console.log('\n💾 Saving to database...')
      const { error: updateError } = await supabase
        .from('papers')
        .update({ 
          pdf_content: extractionResult.fullText,
          content_source: 'pdf_extraction'
        })
        .eq('id', testPaper.id)
      
      if (updateError) throw updateError
      console.log('✅ Saved to database')
      
      // Step 2d: Create chunks
      console.log('\n🧩 Creating chunks...')
      const chunkCount = await createChunksForPaper(testPaper.id, extractionResult.fullText || '')
      console.log(`✅ Created ${chunkCount} chunks`)
      
      console.log('\n🎉 TEST SUCCESSFUL!')
      console.log('   PDF extraction pipeline is working')
      console.log('   Issue must be with automatic processing/queue')
      
    } catch (extractionError) {
      console.error('\n❌ EXTRACTION FAILED:', extractionError)
      console.log('\n🚨 PDF extraction pipeline has issues:')
      
      if (extractionError instanceof Error) {
        console.log(`   Error: ${extractionError.message}`)
        console.log(`   Stack: ${extractionError.stack?.slice(0, 500)}...`)
      }
      
      console.log('\n🔧 Possible causes:')
      console.log('   - Network connectivity issues')
      console.log('   - PDF processing service down')
      console.log('   - Invalid PDF format/corruption')
      console.log('   - Missing dependencies (poppler, etc.)')
    }
    
  } catch (error) {
    console.error('❌ Test setup failed:', error)
  }
}

async function checkPdfProcessingLogs() {
  console.log('\n📋 Checking PDF Processing Logs...')
  console.log('-' .repeat(30))
  
  try {
    const supabase = getServiceClient()
    
    const { data: logs, error } = await supabase
      .from('pdf_processing_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (error) throw error
    
    if (!logs || logs.length === 0) {
      console.log('⚠️  No PDF processing logs found')
      console.log('   This suggests the PDF queue is not running at all')
      return
    }
    
    console.log(`📊 Found ${logs.length} recent log entries:`)
    
    const statusCounts = logs.reduce((acc: Record<string, number>, log) => {
      acc[log.status] = (acc[log.status] || 0) + 1
      return acc
    }, {})
    
    console.log('   Status distribution:', statusCounts)
    
    // Show failed entries
    const failed = logs.filter(log => log.status === 'failed')
    if (failed.length > 0) {
      console.log('\n❌ Recent failures:')
      failed.slice(0, 3).forEach((log, i) => {
        console.log(`   ${i + 1}. Paper: ${log.paper_id}`)
        console.log(`      Error: ${log.error_message}`)
        console.log(`      Attempts: ${log.attempts}`)
        console.log(`      When: ${log.created_at}`)
      })
    }
    
    // Show successful entries
    const success = logs.filter(log => log.status === 'completed')
    if (success.length > 0) {
      console.log('\n✅ Recent successes:')
      success.slice(0, 2).forEach((log, i) => {
        console.log(`   ${i + 1}. Paper: ${log.paper_id}`)
        console.log(`      When: ${log.created_at}`)
      })
    }
    
  } catch (error) {
    console.error('❌ Failed to check logs:', error)
  }
}

async function main() {
  await testPdfExtraction()
  await checkPdfProcessingLogs()
  
  console.log('\n🎯 NEXT STEPS:')
  console.log('   1. If extraction test passed: Check why queue isn\'t processing')
  console.log('   2. If extraction test failed: Fix PDF processing service')
  console.log('   3. Check PDF processing logs for patterns')
  console.log('   4. Verify papers are being queued for processing')
}

if (require.main === module) {
  main().catch(console.error)
}
