#!/usr/bin/env tsx

/**
 * Paper Search Source Analysis Script
 * 
 * Run this script to analyze which sources are returning papers
 * and get detailed performance metrics for your search system.
 * 
 * Usage: npx tsx scripts/test-paper-sources.ts
 */

import { unifiedSearch, withSearchCache } from '@/lib/search/orchestrator'
import { searchOpenAlex, searchCrossref, searchSemanticScholar, searchArxiv, searchCore } from '@/lib/services/academic-apis'
import { collectPapers } from '@/lib/generation/discovery'
import type { EnhancedGenerationOptions } from '@/lib/generation/types'

// Test queries for different domains
const TEST_QUERIES = [
  {
    name: 'AI Healthcare',
    query: 'artificial intelligence in healthcare systems',
    color: '🏥'
  },
  {
    name: 'Machine Learning',
    query: 'machine learning algorithms',
    color: '🤖'
  },
  {
    name: 'Climate Change',
    query: 'climate change adaptation strategies',
    color: '🌍'
  },
  {
    name: 'Quantum Computing',
    query: 'quantum computing applications',
    color: '⚛️'
  }
]

interface SourceResult {
  source: string
  papers: number
  responseTime: number
  success: boolean
  error?: string
}

interface TestResult {
  query: string
  queryName: string
  totalPapers: number
  totalTime: number
  sources: SourceResult[]
  sourceDistribution: Record<string, number>
}

async function testIndividualSource(
  sourceName: string, 
  query: string, 
  searchFunction: (query: string, options?: any) => Promise<any[]>
): Promise<SourceResult> {
  const startTime = Date.now()
  
  try {
    const papers = await searchFunction(query, { limit: 15, fromYear: 2020, fastMode: true })
    const responseTime = Date.now() - startTime
    
    console.log(`   ✅ ${sourceName}: ${papers.length} papers (${responseTime}ms)`)
    
    return {
      source: sourceName,
      papers: papers.length,
      responseTime,
      success: true
    }
  } catch (error) {
    const responseTime = Date.now() - startTime
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    
    console.log(`   ❌ ${sourceName}: Failed (${responseTime}ms) - ${errorMsg}`)
    
    return {
      source: sourceName,
      papers: 0,
      responseTime,
      success: false,
      error: errorMsg
    }
  }
}

async function testUnifiedSearch(query: string, queryName: string): Promise<TestResult> {
  console.log(`\n🔍 Testing Unified Search: ${queryName}`)
  console.log(`   Query: "${query}"`)
  
  const startTime = Date.now()
  
  try {
    const result = await withSearchCache(async () => {
      return await unifiedSearch(query, {
        maxResults: 25,
        minResults: 5,
        useHybridSearch: true,
        useAcademicAPIs: true,
        sources: ['openalex', 'crossref', 'semantic_scholar', 'arxiv'],
        fastMode: false,
        timeoutMs: 15000
      })
    })
    
    const totalTime = Date.now() - startTime
    
    // Analyze source distribution
    const sourceDistribution: Record<string, number> = {}
    result.papers.forEach((paper: any) => {
      const source = paper.source || 'unknown'
      sourceDistribution[source] = (sourceDistribution[source] || 0) + 1
    })
    
    console.log(`   📊 Found ${result.papers.length} papers in ${totalTime}ms`)
    console.log(`   🔍 Strategies: ${result.metadata.searchStrategies.join(', ')}`)
    console.log(`   📈 Hybrid: ${result.metadata.hybridResults}, Academic: ${result.metadata.academicResults}`)
    
    Object.entries(sourceDistribution).forEach(([source, count]) => {
      const percentage = ((count / result.papers.length) * 100).toFixed(1)
      console.log(`   📄 ${source}: ${count} papers (${percentage}%)`)
    })
    
    return {
      query,
      queryName,
      totalPapers: result.papers.length,
      totalTime,
      sources: [], // Will be filled by individual source tests
      sourceDistribution
    }
    
  } catch (error) {
    console.log(`   ❌ Unified search failed: ${error}`)
    return {
      query,
      queryName,
      totalPapers: 0,
      totalTime: Date.now() - startTime,
      sources: [],
      sourceDistribution: {}
    }
  }
}

async function testDiscoveryPipeline(query: string, queryName: string): Promise<void> {
  console.log(`\n🎯 Testing Discovery Pipeline: ${queryName}`)
  
  const options: EnhancedGenerationOptions = {
    projectId: 'test-project',
    userId: 'test-user',
    topic: query,
    libraryPaperIds: [],
    useLibraryOnly: false,
    config: {
      search_parameters: {
        limit: 20,
        sources: ['openalex', 'crossref', 'semantic_scholar'],
        semanticWeight: 0.4,
        authorityWeight: 0.5,
        recencyWeight: 0.1
      },
      paper_settings: {
        paperType: 'researchArticle',
        length: 'medium'
      }
    }
  }
  
  try {
    const papers = await collectPapers(options)
    
    // Analyze paper sources
    const sourceDistribution: Record<string, number> = {}
    papers.forEach(paper => {
      const source = (paper as any).source || 'library'
      sourceDistribution[source] = (sourceDistribution[source] || 0) + 1
    })
    
    console.log(`   📊 Discovery found ${papers.length} papers`)
    Object.entries(sourceDistribution).forEach(([source, count]) => {
      console.log(`   📄 ${source}: ${count} papers`)
    })
    
  } catch (error) {
    console.log(`   ❌ Discovery failed: ${error}`)
  }
}

async function runSourceAnalysis(): Promise<void> {
  console.log('🚀 Starting Paper Search Source Analysis')
  console.log('=' .repeat(60))
  
  const results: TestResult[] = []
  
  // Test each query with all approaches
  for (const testQuery of TEST_QUERIES) {
    console.log(`\n${testQuery.color} ${testQuery.name.toUpperCase()}`)
    console.log('=' .repeat(40))
    
    // Test individual sources
    console.log(`\n📋 Individual Source Tests:`)
    const sourceResults: SourceResult[] = []
    
    // Test each source individually
    sourceResults.push(await testIndividualSource('OpenAlex', testQuery.query, searchOpenAlex))
    sourceResults.push(await testIndividualSource('Crossref', testQuery.query, searchCrossref))
    sourceResults.push(await testIndividualSource('Semantic Scholar', testQuery.query, searchSemanticScholar))
    
    // Only test ArXiv for tech-related queries
    if (testQuery.name.includes('AI') || testQuery.name.includes('Machine') || testQuery.name.includes('Quantum')) {
      sourceResults.push(await testIndividualSource('ArXiv', testQuery.query, searchArxiv))
    }
    
    // Only test CORE for a subset to avoid rate limits
    if (TEST_QUERIES.indexOf(testQuery) < 2) {
      sourceResults.push(await testIndividualSource('CORE', testQuery.query, searchCore))
    }
    
    // Test unified search
    const unifiedResult = await testUnifiedSearch(testQuery.query, testQuery.name)
    unifiedResult.sources = sourceResults
    results.push(unifiedResult)
    
    // Test discovery pipeline
    await testDiscoveryPipeline(testQuery.query, testQuery.name)
  }
  
  // Generate summary report
  console.log('\n\n📊 SUMMARY REPORT')
  console.log('=' .repeat(60))
  
  const sourceStats: Record<string, { total: number, successful: number, papers: number, avgTime: number }> = {}
  
  results.forEach(result => {
    result.sources.forEach(source => {
      if (!sourceStats[source.source]) {
        sourceStats[source.source] = { total: 0, successful: 0, papers: 0, avgTime: 0 }
      }
      
      const stats = sourceStats[source.source]
      stats.total++
      if (source.success) {
        stats.successful++
        stats.papers += source.papers
      }
      stats.avgTime = (stats.avgTime * (stats.total - 1) + source.responseTime) / stats.total
    })
  })
  
  console.log('\n🔍 SOURCE PERFORMANCE:')
  Object.entries(sourceStats).forEach(([source, stats]) => {
    const successRate = ((stats.successful / stats.total) * 100).toFixed(1)
    const avgPapers = stats.successful > 0 ? (stats.papers / stats.successful).toFixed(1) : '0'
    
    console.log(`   ${source}:`)
    console.log(`     Success Rate: ${successRate}%`)
    console.log(`     Avg Papers per Query: ${avgPapers}`)
    console.log(`     Avg Response Time: ${stats.avgTime.toFixed(0)}ms`)
  })
  
  console.log('\n📈 UNIFIED SEARCH PERFORMANCE:')
  results.forEach(result => {
    console.log(`   ${result.queryName}: ${result.totalPapers} papers (${result.totalTime}ms)`)
    
    const topSources = Object.entries(result.sourceDistribution)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([source, count]) => `${source}:${count}`)
      .join(', ')
    
    if (topSources) {
      console.log(`     Top sources: ${topSources}`)
    }
  })
  
  console.log('\n✅ Analysis complete!')
}

// Run the analysis
if (require.main === module) {
  runSourceAnalysis().catch(console.error)
}

export { runSourceAnalysis } 