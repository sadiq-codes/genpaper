#!/usr/bin/env tsx

/**
 * Academic APIs Source Analysis Script
 * 
 * Tests external academic APIs to see which sources are returning papers
 * without requiring database connections.
 * 
 * Usage: npx tsx scripts/test-academic-apis.ts
 */

import { searchOpenAlex, searchCrossref, searchSemanticScholar, searchArxiv, searchCore, searchAllSources } from '@/lib/services/academic-apis'

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
  sampleTitles: string[]
}

interface QueryResult {
  queryName: string
  query: string
  sources: SourceResult[]
  totalPapers: number
  bestSource: string
  sourceDistribution: Record<string, number>
}

async function testSource(
  sourceName: string, 
  query: string, 
  searchFunction: (query: string, options?: any) => Promise<any[]>
): Promise<SourceResult> {
  const startTime = Date.now()
  
  try {
    console.log(`   🔍 Testing ${sourceName}...`)
    const papers = await searchFunction(query, { 
      limit: 15, 
      fromYear: 2020, 
      fastMode: true 
    })
    
    const responseTime = Date.now() - startTime
    const sampleTitles = papers.slice(0, 3).map(p => p.title)
    
    console.log(`   ✅ ${sourceName}: ${papers.length} papers (${responseTime}ms)`)
    if (sampleTitles.length > 0) {
      console.log(`      Sample: "${sampleTitles[0].substring(0, 60)}..."`)
    }
    
    return {
      source: sourceName,
      papers: papers.length,
      responseTime,
      success: true,
      sampleTitles
    }
  } catch (error) {
    const responseTime = Date.now() - startTime
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    
    console.log(`   ❌ ${sourceName}: Failed (${responseTime}ms)`)
    console.log(`      Error: ${errorMsg.substring(0, 100)}`)
    
    return {
      source: sourceName,
      papers: 0,
      responseTime,
      success: false,
      error: errorMsg,
      sampleTitles: []
    }
  }
}

async function testAllSourcesAggregated(query: string): Promise<SourceResult> {
  const startTime = Date.now()
  
  try {
    console.log(`   🔍 Testing All Sources (Aggregated)...`)
    const papers = await searchAllSources(query, { 
      limit: 30, 
      fromYear: 2020, 
      fastMode: true 
    })
    
    const responseTime = Date.now() - startTime
    
    // Count papers by source
    const sourceCount: Record<string, number> = {}
    papers.forEach(paper => {
      sourceCount[paper.source] = (sourceCount[paper.source] || 0) + 1
    })
    
    console.log(`   ✅ All Sources: ${papers.length} papers (${responseTime}ms)`)
    Object.entries(sourceCount).forEach(([source, count]) => {
      console.log(`      ${source}: ${count} papers`)
    })
    
    return {
      source: 'all_sources',
      papers: papers.length,
      responseTime,
      success: true,
      sampleTitles: papers.slice(0, 3).map(p => p.title)
    }
  } catch (error) {
    const responseTime = Date.now() - startTime
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    
    console.log(`   ❌ All Sources: Failed (${responseTime}ms)`)
    console.log(`      Error: ${errorMsg.substring(0, 100)}`)
    
    return {
      source: 'all_sources',
      papers: 0,
      responseTime,
      success: false,
      error: errorMsg,
      sampleTitles: []
    }
  }
}

async function runAnalysis(): Promise<void> {
  console.log('🚀 Academic APIs Source Analysis')
  console.log('=' .repeat(50))
  console.log('Testing which external sources return papers for different queries\n')
  
  const results: QueryResult[] = []
  
  for (const testQuery of TEST_QUERIES) {
    console.log(`${testQuery.color} ${testQuery.name.toUpperCase()}`)
    console.log(`Query: "${testQuery.query}"`)
    console.log('-' .repeat(40))
    
    const sources: SourceResult[] = []
    
    // Test individual sources
    sources.push(await testSource('OpenAlex', testQuery.query, searchOpenAlex))
    sources.push(await testSource('Crossref', testQuery.query, searchCrossref))
    sources.push(await testSource('Semantic Scholar', testQuery.query, searchSemanticScholar))
    
    // Test ArXiv for tech-related queries
    if (testQuery.name.includes('AI') || testQuery.name.includes('Machine') || testQuery.name.includes('Quantum')) {
      sources.push(await testSource('ArXiv', testQuery.query, searchArxiv))
    }
    
    // Test CORE for first two queries to avoid rate limits
    if (TEST_QUERIES.indexOf(testQuery) < 2) {
      sources.push(await testSource('CORE', testQuery.query, searchCore))
    }
    
    // Test aggregated search
    sources.push(await testAllSourcesAggregated(testQuery.query))
    
    // Calculate results
    const successfulSources = sources.filter(s => s.success)
    const totalPapers = successfulSources.reduce((sum, s) => sum + s.papers, 0)
    const bestSource = successfulSources.reduce((best, current) => 
      current.papers > best.papers ? current : best, 
      { papers: 0, source: 'none' }
    ).source
    
    const sourceDistribution: Record<string, number> = {}
    successfulSources.forEach(s => {
      sourceDistribution[s.source] = s.papers
    })
    
    results.push({
      queryName: testQuery.name,
      query: testQuery.query,
      sources,
      totalPapers,
      bestSource,
      sourceDistribution
    })
    
    console.log(`\n📊 Query Summary:`)
    console.log(`   Best Source: ${bestSource}`)
    console.log(`   Total Papers Found: ${totalPapers}`)
    console.log(`   Successful Sources: ${successfulSources.length}/${sources.length}`)
    console.log('')
  }
  
  // Generate comprehensive report
  console.log('\n📊 COMPREHENSIVE ANALYSIS REPORT')
  console.log('=' .repeat(50))
  
  // Source performance across all queries
  const sourceStats: Record<string, {
    queries: number
    successes: number
    totalPapers: number
    avgResponseTime: number
    avgPapersPerQuery: number
  }> = {}
  
  results.forEach(result => {
    result.sources.forEach(source => {
      if (!sourceStats[source.source]) {
        sourceStats[source.source] = {
          queries: 0,
          successes: 0,
          totalPapers: 0,
          avgResponseTime: 0,
          avgPapersPerQuery: 0
        }
      }
      
      const stats = sourceStats[source.source]
      stats.queries++
      
      if (source.success) {
        stats.successes++
        stats.totalPapers += source.papers
      }
      
      // Update average response time
      stats.avgResponseTime = (stats.avgResponseTime * (stats.queries - 1) + source.responseTime) / stats.queries
    })
  })
  
  // Calculate averages
  Object.values(sourceStats).forEach(stats => {
    stats.avgPapersPerQuery = stats.successes > 0 ? stats.totalPapers / stats.successes : 0
  })
  
  console.log('\n🏆 SOURCE RANKINGS:')
  const rankedSources = Object.entries(sourceStats)
    .sort(([,a], [,b]) => b.avgPapersPerQuery - a.avgPapersPerQuery)
  
  rankedSources.forEach(([source, stats], index) => {
    const successRate = ((stats.successes / stats.queries) * 100).toFixed(1)
    
    console.log(`${index + 1}. ${source}`)
    console.log(`   📈 Success Rate: ${successRate}%`)
    console.log(`   📄 Avg Papers/Query: ${stats.avgPapersPerQuery.toFixed(1)}`)
    console.log(`   ⏱️  Avg Response: ${stats.avgResponseTime.toFixed(0)}ms`)
    console.log(`   📊 Total Papers: ${stats.totalPapers}`)
    console.log('')
  })
  
  console.log('📋 QUERY-SPECIFIC RESULTS:')
  results.forEach(result => {
    console.log(`\n${result.queryName}:`)
    console.log(`   🥇 Best Source: ${result.bestSource}`)
    
    const sortedSources = result.sources
      .filter(s => s.success)
      .sort((a, b) => b.papers - a.papers)
    
    sortedSources.forEach(source => {
      console.log(`   📄 ${source.source}: ${source.papers} papers (${source.responseTime}ms)`)
    })
  })
  
  console.log('\n🎯 RECOMMENDATIONS:')
  
  const topSource = rankedSources[0]
  if (topSource) {
    console.log(`• Primary source: ${topSource[0]} (${topSource[1].avgPapersPerQuery.toFixed(1)} papers/query avg)`)
  }
  
  const reliableSources = rankedSources
    .filter(([, stats]) => (stats.successes / stats.queries) >= 0.8)
    .slice(0, 3)
  
  if (reliableSources.length > 0) {
    console.log(`• Most reliable sources: ${reliableSources.map(([name]) => name).join(', ')}`)
  }
  
  const fastestSources = rankedSources
    .filter(([, stats]) => stats.successes > 0)
    .sort(([,a], [,b]) => a.avgResponseTime - b.avgResponseTime)
    .slice(0, 2)
  
  if (fastestSources.length > 0) {
    console.log(`• Fastest sources: ${fastestSources.map(([name]) => name).join(', ')}`)
  }
  
  console.log('\n✅ Analysis complete!')
}

// Run the analysis
if (require.main === module) {
  runAnalysis().catch(console.error)
}

export { runAnalysis } 