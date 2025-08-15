#!/usr/bin/env tsx

/**
 * Quick Database Analysis Script
 * Run this to check for data inconsistencies causing low content coverage
 */

// Load environment variables
try {
  require('dotenv').config({ path: '.env.local' })
} catch {}

import { getServiceClient } from '../lib/supabase/service'

async function quickAnalysis() {
  console.log('🔍 Quick Database Analysis')
  console.log('=' .repeat(40))
  
  try {
    const supabase = getServiceClient()
    
    // 1. Check Projects
    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select('id, topic, status, content, created_at')
      .limit(10)
    
    if (projectsError) throw projectsError
    
    console.log('\n📁 PROJECTS (sample):')
    console.log(`Total: ${projects?.length || 0}`)
    projects?.forEach(p => {
      console.log(`  ${p.id}: "${p.topic}" [${p.status}] - ${p.content ? `${p.content.length} chars` : 'NO CONTENT'}`)
    })
    
    // 2. Check Papers
    const { data: papers, error: papersError } = await supabase
      .from('papers')
      .select('id, title, pdf_content, abstract, status')
      .limit(20)
    
    if (papersError) throw papersError
    
    console.log('\n📄 PAPERS (sample):')
    console.log(`Total: ${papers?.length || 0}`)
    let withContent = 0, withoutContent = 0
    papers?.forEach(p => {
      const hasContent = p.pdf_content || p.abstract
      if (hasContent) withContent++
      else withoutContent++
      console.log(`  ${p.id.slice(0,8)}: "${p.title?.slice(0,40)}..." - ${hasContent ? 'HAS CONTENT' : 'NO CONTENT'}`)
    })
    console.log(`  Summary: ${withContent} with content, ${withoutContent} without content`)
    
    // 3. Check Paper Chunks
    const { data: chunks, error: chunksError } = await supabase
      .from('paper_chunks')
      .select('id, paper_id, content, embedding')
      .limit(30)
    
    if (chunksError) throw chunksError
    
    console.log('\n🧩 PAPER CHUNKS (sample):')
    console.log(`Total: ${chunks?.length || 0}`)
    const chunksByPaper = chunks?.reduce((acc: any, chunk) => {
      acc[chunk.paper_id] = (acc[chunk.paper_id] || 0) + 1
      return acc
    }, {}) || {}
    
    console.log(`  Unique papers with chunks: ${Object.keys(chunksByPaper).length}`)
    Object.entries(chunksByPaper).slice(0, 10).forEach(([paperId, count]) => {
      console.log(`  ${paperId.slice(0,8)}: ${count} chunks`)
    })
    
    const chunksWithoutEmbedding = chunks?.filter(c => !c.embedding).length || 0
    console.log(`  Chunks without embeddings: ${chunksWithoutEmbedding}`)
    
    // 4. Coverage Analysis
    console.log('\n📊 COVERAGE ANALYSIS:')
    const totalPapers = papers?.length || 0
    const papersWithChunks = Object.keys(chunksByPaper).length
    const coverageRate = totalPapers > 0 ? (papersWithChunks / totalPapers * 100).toFixed(1) : '0'
    
    console.log(`  Papers in DB: ${totalPapers}`)
    console.log(`  Papers with chunks: ${papersWithChunks}`)
    console.log(`  Coverage rate: ${coverageRate}%`)
    
    if (parseFloat(coverageRate) < 30) {
      console.log('\n🚨 CRITICAL ISSUE: Very low content coverage!')
      console.log('  This explains why only 7-8 papers appear in generation.')
      console.log('  Root causes likely:')
      console.log('    - PDF processing failures')
      console.log('    - Missing content ingestion')
      console.log('    - Broken chunk creation pipeline')
    }
    
    // 5. Check recent activity
    const { data: recentChunks } = await supabase
      .from('paper_chunks')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    
    console.log('\n⏰ RECENT ACTIVITY:')
    if (recentChunks && recentChunks.length > 0) {
      console.log(`  Last chunk created: ${recentChunks[0].created_at}`)
    } else {
      console.log('  No recent chunks found - ingestion may be broken!')
    }
    
  } catch (error) {
    console.error('❌ Analysis failed:', error)
  }
}

if (require.main === module) {
  quickAnalysis().catch(console.error)
}

export { quickAnalysis }
