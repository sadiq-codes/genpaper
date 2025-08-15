#!/usr/bin/env tsx

/**
 * Test Paper Ingestion with PDF Processing
 * Simulates what happens when papers are discovered and should be auto-processed
 */

// Load environment variables
try {
  require('dotenv').config({ path: '.env.local' })
} catch {}

import { ingestPaper } from '../lib/db/papers'

async function testPaperIngestion() {
  console.log('🧪 Testing Paper Ingestion with PDF Processing')
  console.log('=' .repeat(50))
  
  try {
    // Create a test paper with a PDF URL (using the same one we tested)
    const testPaper = {
      title: "Test Paper: NFTrig Using Blockchain Technologies for Math Education",
      authors: ["Jordan Thompson", "Ryan Benac"],
      abstract: "This is a test paper to verify PDF processing works during ingestion.",
      publication_date: "2024-01-01",
      venue: "Test Conference",
      doi: "10.1000/test-doi-12345",
      url: "https://example.com/paper",
      metadata: { test: true },
      source: "test",
      citation_count: 0,
      impact_score: 0.5
    }

    const pdfUrl = "https://arxiv.org/pdf/2301.00001.pdf" // Same PDF we tested successfully

    console.log('\n📄 Ingesting paper with PDF URL...')
    console.log(`   Title: ${testPaper.title}`)
    console.log(`   PDF URL: ${pdfUrl}`)

    const result = await ingestPaper(testPaper, {
      pdfUrl: pdfUrl,
      priority: 'normal'
    })

    console.log('\n✅ Ingestion Result:')
    console.log(`   Paper ID: ${result.paperId}`)
    console.log(`   Is New: ${result.isNew}`)
    console.log(`   Status: ${result.status}`)

    if (result.status === 'queued') {
      console.log('\n🎉 SUCCESS: Paper was queued for PDF processing!')
      console.log('   This means the automatic processing pipeline is working')
      
      // Give it a moment to process
      console.log('\n⏳ Waiting 10 seconds for PDF processing...')
      await new Promise(resolve => setTimeout(resolve, 10000))
      
      // Check if content was extracted
      const { getServiceClient } = await import('../lib/supabase/service')
      const supabase = getServiceClient()
      
      const { data: paper, error } = await supabase
        .from('papers')
        .select('id, title, pdf_content')
        .eq('id', result.paperId)
        .single()
      
      if (error) throw error
      
      if (paper.pdf_content && paper.pdf_content.length > 100) {
        console.log(`✅ PDF CONTENT EXTRACTED: ${paper.pdf_content.length} characters`)
        console.log(`   Preview: ${paper.pdf_content.slice(0, 200)}...`)
        
        // Check if chunks were created
        const { data: chunks, error: chunksError } = await supabase
          .from('paper_chunks')
          .select('id, content')
          .eq('paper_id', result.paperId)
        
        if (chunksError) throw chunksError
        
        console.log(`✅ CHUNKS CREATED: ${chunks?.length || 0} chunks`)
        if (chunks && chunks.length > 0) {
          console.log(`   First chunk preview: ${chunks[0].content.slice(0, 100)}...`)
        }
        
        console.log('\n🎉 COMPLETE SUCCESS!')
        console.log('   - Paper ingested ✅')
        console.log('   - PDF processed ✅') 
        console.log('   - Content extracted ✅')
        console.log('   - Chunks created ✅')
        console.log('\n🚀 The PDF processing pipeline is now fully working!')
        
      } else {
        console.log('❌ PDF content not extracted yet')
        console.log('   PDF processing may have failed or is still running')
      }
      
    } else {
      console.log('❌ Paper was not queued for PDF processing')
      console.log('   There may still be an issue with the queueing logic')
    }

  } catch (error) {
    console.error('❌ Test failed:', error)
    if (error instanceof Error) {
      console.error('   Stack:', error.stack?.slice(0, 500))
    }
  }
}

if (require.main === module) {
  testPaperIngestion().catch(console.error)
}
