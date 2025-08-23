#!/usr/bin/env tsx

/**
 * Re-ingest papers that have no chunks
 */

import { getSB } from '../lib/supabase/server'
import { ingestPaper } from '../lib/db/papers'

const MISSING_PAPER_IDS = [
  'f1a81953-7b63-4dc9-baa4-27cbaeac5e99',
  '2f77016a-a8bd-4aee-93d2-5bed9bc14fc8', 
  '9006e569-f646-44b2-9b7b-bfbc4f243cec',
  'f70b3145-db45-490a-a1a0-b8cf18ca575c',
  'f34832d1-aecd-4ed1-95f2-f4692976fc28',
  '38f951d0-9b47-4a90-88af-35a4beb924ad',
  '137c3859-9fff-4ae7-a648-c490bc546fff',
  '6b78921b-dfda-492a-8aea-596eaa48aacf',
  '4a47a058-c251-4f5d-beb4-e3dc91dc0957',
  'e5274407-ac7e-4e81-b974-b58f1ff27e83'
]

async function main() {
  console.log('🔄 RE-INGESTING PAPERS WITHOUT CHUNKS')
  console.log('='.repeat(50))
  
  const supabase = await getSB()
  
  for (const paperId of MISSING_PAPER_IDS) {
    console.log(`\n📄 Processing paper: ${paperId}`)
    
    // Get paper details
    const { data: paper, error } = await supabase
      .from('papers')
      .select('id, title, pdf_url, abstract')
      .eq('id', paperId)
      .single()
    
    if (error) {
      console.log(`❌ Error fetching paper: ${error.message}`)
      continue
    }
    
    if (!paper) {
      console.log(`❌ Paper not found`)
      continue
    }
    
    console.log(`   Title: "${paper.title?.substring(0, 60)}..."`)
    console.log(`   PDF URL: ${paper.pdf_url ? '✅ Present' : '❌ Missing'}`)
    
    if (paper.pdf_url) {
      try {
        // Re-ingest with PDF processing
        const result = await ingestPaper({
          title: paper.title,
          abstract: paper.abstract,
          doi: '',
          source: 'reingest'
        }, {
          pdfUrl: paper.pdf_url,
          background: false,
          priority: 'high'
        })
        
        console.log(`   ✅ Re-ingestion ${result.status}: ${result.paperId}`)
      } catch (error) {
        console.log(`   ❌ Re-ingestion failed: ${error}`)
      }
    } else {
      console.log(`   ⚠️  No PDF URL - skipping`)
    }
  }
  
  console.log('\n✅ Re-ingestion complete')
}

main().catch(console.error)
