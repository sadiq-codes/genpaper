#!/usr/bin/env tsx

/**
 * Comprehensive Database Dump Script
 * Exports all relevant data for analysis of inconsistencies and complexity issues
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

interface DatabaseDump {
  metadata: {
    timestamp: string
    version: string
    tables_analyzed: string[]
  }
  projects: any[]
  papers: any[]
  paper_chunks: any[]
  citations: any[]
  document_versions: any[]
  paper_references: any[]
  users: any[]
  generation_metrics: any[]
  analysis: {
    projects_summary: any
    papers_summary: any
    chunks_summary: any
    citations_summary: any
    data_quality_issues: string[]
    relationships_integrity: any
  }
}

async function dumpTable(tableName: string): Promise<any[]> {
  console.log(`📊 Dumping table: ${tableName}`)
  
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1000) // Prevent overwhelming output
    
    if (error) {
      console.error(`❌ Error dumping ${tableName}:`, error)
      return []
    }
    
    console.log(`✅ ${tableName}: ${data?.length || 0} records`)
    return data || []
  } catch (err) {
    console.error(`❌ Failed to dump ${tableName}:`, err)
    return []
  }
}

async function analyzeDataQuality(dump: Partial<DatabaseDump>): Promise<any> {
  const issues: string[] = []
  const analysis: any = {}
  
  // Projects Analysis
  if (dump.projects) {
    analysis.projects_summary = {
      total: dump.projects.length,
      by_status: dump.projects.reduce((acc: any, p: any) => {
        acc[p.status] = (acc[p.status] || 0) + 1
        return acc
      }, {}),
      with_content: dump.projects.filter((p: any) => p.content && p.content.length > 100).length,
      without_content: dump.projects.filter((p: any) => !p.content || p.content.length <= 100).length
    }
    
    // Check for projects without content
    const emptyProjects = dump.projects.filter((p: any) => !p.content || p.content.length <= 100)
    if (emptyProjects.length > 0) {
      issues.push(`${emptyProjects.length} projects have empty or minimal content`)
    }
  }
  
  // Papers Analysis
  if (dump.papers) {
    analysis.papers_summary = {
      total: dump.papers.length,
      with_pdf_content: dump.papers.filter((p: any) => p.pdf_content).length,
      without_pdf_content: dump.papers.filter((p: any) => !p.pdf_content).length,
      with_abstract: dump.papers.filter((p: any) => p.abstract).length,
      without_abstract: dump.papers.filter((p: any) => !p.abstract).length,
      by_status: dump.papers.reduce((acc: any, p: any) => {
        acc[p.status || 'unknown'] = (acc[p.status || 'unknown'] || 0) + 1
        return acc
      }, {})
    }
    
    // Check papers without content
    const papersWithoutContent = dump.papers.filter((p: any) => !p.pdf_content && !p.abstract)
    if (papersWithoutContent.length > 0) {
      issues.push(`${papersWithoutContent.length} papers have no content (neither PDF nor abstract)`)
    }
    
    // Check papers with missing metadata
    const papersWithoutTitle = dump.papers.filter((p: any) => !p.title)
    if (papersWithoutTitle.length > 0) {
      issues.push(`${papersWithoutTitle.length} papers missing titles`)
    }
  }
  
  // Paper Chunks Analysis
  if (dump.paper_chunks) {
    const paperIds = new Set(dump.papers?.map((p: any) => p.id) || [])
    const chunkPaperIds = new Set(dump.paper_chunks.map((c: any) => c.paper_id))
    
    analysis.chunks_summary = {
      total: dump.paper_chunks.length,
      unique_papers: chunkPaperIds.size,
      average_chunks_per_paper: dump.paper_chunks.length / chunkPaperIds.size,
      papers_with_chunks: chunkPaperIds.size,
      papers_without_chunks: paperIds.size - chunkPaperIds.size,
      chunk_distribution: Array.from(chunkPaperIds).reduce((acc: any, paperId) => {
        const count = (dump.paper_chunks || []).filter((c: any) => c.paper_id === paperId).length
        acc[count] = (acc[count] || 0) + 1
        return acc
      }, {})
    }
    
    // Check for papers without chunks
    const papersWithoutChunks = paperIds.size - chunkPaperIds.size
    if (papersWithoutChunks > 0) {
      issues.push(`${papersWithoutChunks} papers have no chunks despite having content`)
    }
    
    // Check for chunks without embedding
    const chunksWithoutEmbedding = dump.paper_chunks.filter((c: any) => !c.embedding)
    if (chunksWithoutEmbedding.length > 0) {
      issues.push(`${chunksWithoutEmbedding.length} chunks missing embeddings`)
    }
  }
  
  // Citations Analysis
  if (dump.citations) {
    analysis.citations_summary = {
      total: dump.citations.length,
      by_type: dump.citations.reduce((acc: any, c: any) => {
        acc[c.citation_type || 'unknown'] = (acc[c.citation_type || 'unknown'] || 0) + 1
        return acc
      }, {}),
      linked_to_papers: dump.citations.filter((c: any) => c.paper_id).length,
      unlinked: dump.citations.filter((c: any) => !c.paper_id).length
    }
    
    // Check for orphaned citations
    const orphanedCitations = dump.citations.filter((c: any) => !c.paper_id)
    if (orphanedCitations.length > 0) {
      issues.push(`${orphanedCitations.length} citations are not linked to papers`)
    }
  }
  
  // Relationship Integrity Checks
  analysis.relationships_integrity = {}
  
  if (dump.projects && dump.citations) {
    const projectIds = new Set(dump.projects.map((p: any) => p.id))
    const citationsWithInvalidProjects = dump.citations.filter((c: any) => 
      c.project_id && !projectIds.has(c.project_id)
    )
    if (citationsWithInvalidProjects.length > 0) {
      issues.push(`${citationsWithInvalidProjects.length} citations reference non-existent projects`)
    }
  }
  
  if (dump.papers && dump.paper_chunks) {
    const paperIds = new Set(dump.papers.map((p: any) => p.id))
    const chunksWithInvalidPapers = dump.paper_chunks.filter((c: any) => 
      c.paper_id && !paperIds.has(c.paper_id)
    )
    if (chunksWithInvalidPapers.length > 0) {
      issues.push(`${chunksWithInvalidPapers.length} chunks reference non-existent papers`)
    }
  }
  
  return {
    ...analysis,
    data_quality_issues: issues
  }
}

async function main() {
  console.log('🚀 Starting comprehensive database dump...')
  
  const dump: DatabaseDump = {
    metadata: {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      tables_analyzed: []
    },
    projects: [],
    papers: [],
    paper_chunks: [],
    citations: [],
    document_versions: [],
    paper_references: [],
    users: [],
    generation_metrics: [],
    analysis: {
      projects_summary: {},
      papers_summary: {},
      chunks_summary: {},
      citations_summary: {},
      data_quality_issues: [],
      relationships_integrity: {}
    }
  }
  
  // Dump all tables
  const tables = [
    'projects',
    'papers', 
    'paper_chunks',
    'citations',
    'document_versions',
    'paper_references',
    'users',
    'generation_metrics'
  ]
  
  for (const table of tables) {
    try {
      const data = await dumpTable(table)
      ;(dump as any)[table] = data
      dump.metadata.tables_analyzed.push(table)
    } catch (err) {
      console.error(`❌ Failed to dump ${table}:`, err)
    }
  }
  
  // Analyze data quality
  console.log('\n🔍 Analyzing data quality and relationships...')
  dump.analysis = await analyzeDataQuality(dump)
  
  // Write to file
  const outputPath = path.join(process.cwd(), 'database-dump.json')
  fs.writeFileSync(outputPath, JSON.stringify(dump, null, 2))
  
  // Print summary
  console.log('\n📋 DATABASE ANALYSIS SUMMARY')
  console.log('=' .repeat(50))
  
  if (dump.analysis.projects_summary) {
    console.log('\n📁 PROJECTS:')
    console.log(`  Total: ${dump.analysis.projects_summary.total}`)
    console.log(`  With content: ${dump.analysis.projects_summary.with_content}`)
    console.log(`  Without content: ${dump.analysis.projects_summary.without_content}`)
    console.log(`  By status:`, dump.analysis.projects_summary.by_status)
  }
  
  if (dump.analysis.papers_summary) {
    console.log('\n📄 PAPERS:')
    console.log(`  Total: ${dump.analysis.papers_summary.total}`)
    console.log(`  With PDF content: ${dump.analysis.papers_summary.with_pdf_content}`)
    console.log(`  Without PDF content: ${dump.analysis.papers_summary.without_pdf_content}`)
    console.log(`  With abstract: ${dump.analysis.papers_summary.with_abstract}`)
    console.log(`  Without abstract: ${dump.analysis.papers_summary.without_abstract}`)
  }
  
  if (dump.analysis.chunks_summary) {
    console.log('\n🧩 CHUNKS:')
    console.log(`  Total chunks: ${dump.analysis.chunks_summary.total}`)
    console.log(`  Papers with chunks: ${dump.analysis.chunks_summary.papers_with_chunks}`)
    console.log(`  Papers without chunks: ${dump.analysis.chunks_summary.papers_without_chunks}`)
    console.log(`  Average chunks per paper: ${dump.analysis.chunks_summary.average_chunks_per_paper?.toFixed(1)}`)
  }
  
  if (dump.analysis.data_quality_issues.length > 0) {
    console.log('\n⚠️  DATA QUALITY ISSUES:')
    dump.analysis.data_quality_issues.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue}`)
    })
  } else {
    console.log('\n✅ No major data quality issues detected')
  }
  
  console.log(`\n💾 Full dump saved to: ${outputPath}`)
  console.log('\n🎯 KEY INSIGHTS for troubleshooting:')
  
  // Coverage issue analysis
  if (dump.analysis.chunks_summary && dump.analysis.papers_summary) {
    const coverageRate = (dump.analysis.chunks_summary.papers_with_chunks / dump.analysis.papers_summary.total * 100).toFixed(1)
    console.log(`  📊 Content coverage: ${coverageRate}% (${dump.analysis.chunks_summary.papers_with_chunks}/${dump.analysis.papers_summary.total} papers have chunks)`)
    
    if (parseFloat(coverageRate) < 50) {
      console.log(`  🚨 LOW COVERAGE: This explains why only 7-8 papers appear in generation!`)
      console.log(`  🔧 Root cause likely: PDF processing failures or missing content ingestion`)
    }
  }
}

if (require.main === module) {
  main().catch(console.error)
}
