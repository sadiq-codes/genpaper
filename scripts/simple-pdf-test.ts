#!/usr/bin/env tsx

/**
 * Simple PDF Processing Test
 * Tests if the PDF extraction functions work at all
 */

import { extractPdfMetadataTiered } from '../lib/pdf/tiered-extractor'
import { downloadPdfBuffer } from '../lib/pdf/pdf-utils'

async function simplePdfTest() {
  console.log('🧪 Simple PDF Processing Test')
  console.log('=' .repeat(40))
  
  // Test with a known public PDF
  const testPdfUrl = 'https://arxiv.org/pdf/2301.00001.pdf'
  
  try {
    console.log('\n📥 Step 1: Downloading test PDF...')
    console.log(`   URL: ${testPdfUrl}`)
    
    const pdfBuffer = await downloadPdfBuffer(testPdfUrl)
    console.log(`✅ Downloaded ${pdfBuffer.length} bytes`)
    
    console.log('\n🔍 Step 2: Extracting content...')
    
    const result = await extractPdfMetadataTiered(pdfBuffer, {
      enableOcr: false,
      maxTimeoutMs: 30000
    })
    
    console.log('✅ Extraction completed!')
    console.log(`   Title: ${result.title || 'Not found'}`)
    console.log(`   Full text length: ${result.fullText?.length || 0} characters`)
    console.log(`   Content preview: ${result.fullText?.slice(0, 300)}...`)
    
    if (result.fullText && result.fullText.length > 100) {
      console.log('\n🎉 SUCCESS: PDF extraction is working!')
      console.log('   The issue is likely with:')
      console.log('   - Papers not being queued for processing')
      console.log('   - PDF queue not running')
      console.log('   - Database not being updated after extraction')
    } else {
      console.log('\n⚠️  WARNING: Extraction returned minimal content')
      console.log('   PDF processing may have issues')
    }
    
  } catch (error) {
    console.error('\n❌ PDF processing failed:')
    console.error('   Error:', error instanceof Error ? error.message : error)
    
    if (error instanceof Error && error.stack) {
      console.error('   Stack (first 500 chars):', error.stack.slice(0, 500))
    }
    
    console.log('\n🚨 PDF processing pipeline is broken!')
    console.log('   Possible causes:')
    console.log('   - Missing PDF processing dependencies')
    console.log('   - Network connectivity issues')
    console.log('   - PDF extraction service configuration problems')
    console.log('   - Logger function issues (already fixed)')
  }
}

if (require.main === module) {
  simplePdfTest().catch(console.error)
}
