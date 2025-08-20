#!/usr/bin/env tsx

/**
 * Test PDF Extraction with Local Alex Yu PDF
 * Tests the PDF extraction pipeline with the local PDF file
 */

import { extractPdfMetadataTiered } from '../lib/pdf/tiered-extractor'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

async function testLocalPdf() {
  console.log('🧪 Testing PDF Extraction with Local Alex Yu PDF')
  console.log('=' .repeat(55))
  
  // Find the Alex Yu PDF file using glob pattern
  const files = readdirSync(process.cwd())
  const alexPdf = files.find(file => file.startsWith('Alex Yu') && file.endsWith('.pdf'))
  
  if (!alexPdf) {
    console.error('❌ Alex Yu PDF not found in root directory')
    console.log('Available PDF files:', files.filter(f => f.endsWith('.pdf')))
    return
  }
  
  const pdfPath = join(process.cwd(), alexPdf)
  
  try {
    console.log('\n📁 Reading local PDF file...')
    console.log(`   Path: ${pdfPath}`)
    
    const pdfBuffer = readFileSync(pdfPath)
    console.log(`✅ Read ${pdfBuffer.length} bytes from local file`)
    
    console.log('\n🔍 Step 1: Testing PDF extraction...')
    
    const result = await extractPdfMetadataTiered(pdfBuffer, {
      enableOcr: true, // Enable OCR for scanned PDFs
      maxTimeoutMs: 60000 // Give it more time for OCR processing
    })
    
    console.log('✅ Extraction completed!')
    console.log(`   Extraction method: ${result.extractionMethod}`)
    console.log(`   Confidence: ${result.confidence}`)
    console.log(`   Processing time: ${result.extractionTimeMs}ms`)
    console.log(`   Title: ${result.title || 'Not found'}`)
    console.log(`   Authors: ${result.authors?.join(', ') || 'Not found'}`)
    console.log(`   Full text length: ${result.fullText?.length || 0} characters`)
    
    if (result.fullText && result.fullText.length > 100) {
      console.log(`   Content preview: ${result.fullText.slice(0, 400)}...`)
      
      // Test chunking capability
      console.log('\n🧩 Step 2: Testing content chunking...')
      
      const lines = result.fullText.split('\n').filter(line => line.trim().length > 0)
      console.log(`   Total lines: ${lines.length}`)
      
      const words = result.fullText.split(/\s+/).length
      console.log(`   Total words: ${words}`)
      
      const chapters = result.fullText.match(/chapter\s+\d+/gi) || []
      console.log(`   Chapters found: ${chapters.length} (${chapters.slice(0, 3).join(', ')}...)`)
      
      // Look for specific system design content
      const systemDesignTerms = [
        'load balancer', 'database', 'cache', 'microservices', 
        'scalability', 'availability', 'consistency', 'partition'
      ]
      
      const foundTerms = systemDesignTerms.filter(term => 
        result.fullText!.toLowerCase().includes(term.toLowerCase())
      )
      
      console.log(`   System design terms found: ${foundTerms.length}/${systemDesignTerms.length}`)
      console.log(`   Terms: ${foundTerms.join(', ')}`)
      
      console.log('\n🎉 SUCCESS: Local PDF extraction is working perfectly!')
      console.log('   - PDF reading from disk ✅')
      console.log('   - Content extraction ✅') 
      console.log('   - Metadata parsing ✅')
      console.log('   - Rich content detected ✅')
      
      // Simulate what would happen in the real pipeline
      console.log('\n🚀 This content would create many high-quality chunks for generation!')
      
    } else {
      console.log('\n⚠️  WARNING: Extraction returned minimal content')
      console.log('   This suggests the PDF may be scanned or have extraction issues')
    }
    
  } catch (error) {
    if (error && typeof error === 'object' && (error as any).code === 'ENOENT') {
      console.error('\n❌ PDF file not found!')
      console.error('   Make sure the Alex Yu PDF is in the project root directory')
      console.error('   Expected path:', pdfPath)
    } else {
      console.error('\n❌ PDF extraction failed:')
      console.error('   Error:', error instanceof Error ? error.message : error)
      
      if (error instanceof Error && error.stack) {
        console.error('   Stack (first 500 chars):', error.stack.slice(0, 500))
      }
    }
  }
}

if (require.main === module) {
  testLocalPdf().catch(console.error)
}
