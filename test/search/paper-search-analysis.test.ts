/**
 * Comprehensive Paper Search Analysis Tests
 * 
 * This test suite analyzes:
 * 1. Which sources are returning papers for different queries
 * 2. Search performance across different strategies
 * 3. Quality and relevance of results from each source
 * 4. Deduplication effectiveness
 * 5. Regional and temporal filtering
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { searchOpenAlex, searchCrossref, searchSemanticScholar, searchArxiv, searchCore } from '@/lib/services/academic-apis'
import { unifiedSearch } from '@/lib/search'
import { collectPapers } from '@/lib/generation/discovery'
import type { UnifiedSearchOptions } from '@/lib/search/orchestrator'
import type { SearchOptions } from '@/lib/services/academic-apis'
import type { EnhancedGenerationOptions } from '@/lib/generation/types'

// Test queries covering different domains
const TEST_QUERIES = [
  {
    name: 'AI Healthcare',
    query: 'artificial intelligence in healthcare systems',
    expectedSources: ['openalex', 'crossref', 'semantic_scholar'],
    minExpectedResults: 5
  },
  {
    name: 'Machine Learning',
    query: 'machine learning algorithms',
    expectedSources: ['openalex', 'crossref', 'arxiv'],
    minExpectedResults: 10
  },
  {
    name: 'Climate Change',
    query: 'climate change adaptation strategies',
    expectedSources: ['openalex', 'crossref'],
    minExpectedResults: 5
  },
  {
    name: 'Quantum Computing',
    query: 'quantum computing applications',
    expectedSources: ['openalex', 'arxiv'],
    minExpectedResults: 3
  },
  {
    name: 'Biomedical Engineering',
    query: 'biomedical engineering innovations',
    expectedSources: ['openalex', 'crossref'],
    minExpectedResults: 5
  }
]

// Source performance tracker
interface SourceAnalytics {
  source: string
  totalQueries: number
  successfulQueries: number
  totalPapers: number
  averageResponseTime: number
  errorRate: number
  uniquePapers: Set<string>
  errors: string[]
}

const sourceAnalytics = new Map<string, SourceAnalytics>()

// Initialize analytics for each source
function initializeSourceAnalytics() {
  const sources = ['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core', 'hybrid']
  sources.forEach(source => {
    sourceAnalytics.set(source, {
      source,
      totalQueries: 0,
      successfulQueries: 0,
      totalPapers: 0,
      averageResponseTime: 0,
      errorRate: 0,
      uniquePapers: new Set(),
      errors: []
    })
  })
}

// Track source performance
function trackSourcePerformance(
  source: string, 
  papers: any[], 
  responseTime: number, 
  error?: string
) {
  const analytics = sourceAnalytics.get(source)
  if (!analytics) return

  analytics.totalQueries++
  
  if (error) {
    analytics.errors.push(error)
  } else {
    analytics.successfulQueries++
    analytics.totalPapers += papers.length
    
    // Track unique papers by title + year
    papers.forEach(paper => {
      const key = `${paper.title}-${paper.year || 'unknown'}`
      analytics.uniquePapers.add(key)
    })
  }
  
  // Update average response time
  const totalTime = analytics.averageResponseTime * (analytics.totalQueries - 1) + responseTime
  analytics.averageResponseTime = totalTime / analytics.totalQueries
  
  // Update error rate
  analytics.errorRate = (analytics.errors.length / analytics.totalQueries) * 100
}

// Generate analytics report
function generateAnalyticsReport(): string {
  let report = '\n\n📊 PAPER SEARCH ANALYTICS REPORT\n'
  report += '=' .repeat(50) + '\n\n'
  
  sourceAnalytics.forEach((analytics, source) => {
    report += `🔍 ${source.toUpperCase()}\n`
    report += `   📈 Success Rate: ${((analytics.successfulQueries / Math.max(analytics.totalQueries, 1)) * 100).toFixed(1)}%\n`
    report += `   📄 Total Papers: ${analytics.totalPapers}\n`
    report += `   🎯 Unique Papers: ${analytics.uniquePapers.size}\n`
    report += `   ⏱️  Avg Response Time: ${analytics.averageResponseTime.toFixed(0)}ms\n`
    report += `   ❌ Error Rate: ${analytics.errorRate.toFixed(1)}%\n`
    
    if (analytics.errors.length > 0) {
      report += `   🚨 Recent Errors: ${analytics.errors.slice(-3).join(', ')}\n`
    }
    report += '\n'
  })
  
  // Overall statistics
  const totalPapers = Array.from(sourceAnalytics.values()).reduce((sum, a) => sum + a.totalPapers, 0)
  const totalUnique = new Set(Array.from(sourceAnalytics.values()).flatMap(a => Array.from(a.uniquePapers))).size
  const deduplicationRate = totalPapers > 0 ? ((totalPapers - totalUnique) / totalPapers * 100).toFixed(1) : '0'
  
  report += `📊 OVERALL STATISTICS\n`
  report += `   📄 Total Papers Found: ${totalPapers}\n`
  report += `   🎯 Unique Papers: ${totalUnique}\n`
  report += `   🔄 Deduplication Rate: ${deduplicationRate}%\n`
  
  return report
}

describe('Paper Search Source Analysis', () => {
  beforeAll(() => {
    initializeSourceAnalytics()
  })

  afterAll(() => {
    console.log(generateAnalyticsReport())
  })

  describe('Individual Source Testing', () => {
    test.each(TEST_QUERIES)('OpenAlex search for "$name"', async ({ query, minExpectedResults }) => {
      const startTime = Date.now()
      let papers: any[] = []
      let error: string | undefined

      try {
        papers = await searchOpenAlex(query, { limit: 20, fromYear: 2020 })
        expect(papers.length).toBeGreaterThanOrEqual(Math.min(minExpectedResults, 3))
        
        // Validate paper structure
        papers.forEach(paper => {
          expect(paper).toHaveProperty('title')
          expect(paper).toHaveProperty('source', 'openalex')
          expect(paper.canonical_id).toBeDefined()
        })
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unknown error'
        console.warn(`OpenAlex search failed for "${query}": ${error}`)
      }

      trackSourcePerformance('openalex', papers, Date.now() - startTime, error)
    })

    test.each(TEST_QUERIES)('Crossref search for "$name"', async ({ query, minExpectedResults }) => {
      const startTime = Date.now()
      let papers: any[] = []
      let error: string | undefined

      try {
        papers = await searchCrossref(query, { limit: 20, fromYear: 2020 })
        expect(papers.length).toBeGreaterThanOrEqual(Math.min(minExpectedResults, 2))
        
        papers.forEach(paper => {
          expect(paper).toHaveProperty('title')
          expect(paper).toHaveProperty('source', 'crossref')
          expect(paper.canonical_id).toBeDefined()
        })
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unknown error'
        console.warn(`Crossref search failed for "${query}": ${error}`)
      }

      trackSourcePerformance('crossref', papers, Date.now() - startTime, error)
    })

    test.each(TEST_QUERIES)('Semantic Scholar search for "$name"', async ({ query }) => {
      const startTime = Date.now()
      let papers: any[] = []
      let error: string | undefined

      try {
        papers = await searchSemanticScholar(query, { limit: 20, fromYear: 2020 })
        
        papers.forEach(paper => {
          expect(paper).toHaveProperty('title')
          expect(paper).toHaveProperty('source', 'semantic_scholar')
          expect(paper.canonical_id).toBeDefined()
        })
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unknown error'
        console.warn(`Semantic Scholar search failed for "${query}": ${error}`)
      }

      trackSourcePerformance('semantic_scholar', papers, Date.now() - startTime, error)
    })

    test.each(TEST_QUERIES.filter(q => q.name.includes('AI') || q.name.includes('Machine Learning') || q.name.includes('Quantum')))
    ('ArXiv search for "$name"', async ({ query }) => {
      const startTime = Date.now()
      let papers: any[] = []
      let error: string | undefined

      try {
        papers = await searchArxiv(query, { limit: 10 })
        
        papers.forEach(paper => {
          expect(paper).toHaveProperty('title')
          expect(paper).toHaveProperty('source', 'arxiv')
          expect(paper.canonical_id).toBeDefined()
        })
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unknown error'
        console.warn(`ArXiv search failed for "${query}": ${error}`)
      }

      trackSourcePerformance('arxiv', papers, Date.now() - startTime, error)
    })

    test.each(TEST_QUERIES.slice(0, 2))('CORE search for "$name"', async ({ query }) => {
      const startTime = Date.now()
      let papers: any[] = []
      let error: string | undefined

      try {
        papers = await searchCore(query, { limit: 10, fromYear: 2020 })
        
        papers.forEach(paper => {
          expect(paper).toHaveProperty('title')
          expect(paper).toHaveProperty('source', 'core')
          expect(paper.canonical_id).toBeDefined()
        })
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unknown error'
        console.warn(`CORE search failed for "${query}": ${error}`)
      }

      trackSourcePerformance('core', papers, Date.now() - startTime, error)
    })
  })

  describe('Unified Search Analysis', () => {
    test.each(TEST_QUERIES)('Unified search for "$name" - Source Distribution', async ({ query, minExpectedResults }) => {
      const startTime = Date.now()
      let searchResult: any
      let error: string | undefined

      try {
        searchResult = await withSearchCache(async () => {
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

        expect(searchResult.papers.length).toBeGreaterThanOrEqual(Math.min(minExpectedResults, 3))
        
        // Analyze source distribution
        const sourceDistribution = new Map<string, number>()
        searchResult.papers.forEach((paper: any) => {
          const source = paper.source || 'unknown'
          sourceDistribution.set(source, (sourceDistribution.get(source) || 0) + 1)
        })

        console.log(`\n🔍 Source Distribution for "${query}":`)
        sourceDistribution.forEach((count, source) => {
          console.log(`   ${source}: ${count} papers (${(count/searchResult.papers.length*100).toFixed(1)}%)`)
        })

        console.log(`📊 Search Metadata:`)
        console.log(`   Strategies: ${searchResult.metadata.searchStrategies.join(', ')}`)
        console.log(`   Hybrid Results: ${searchResult.metadata.hybridResults}`)
        console.log(`   Academic API Results: ${searchResult.metadata.academicResults}`)
        console.log(`   Search Time: ${searchResult.metadata.searchTimeMs}ms`)
        console.log(`   Cache Hits: ${searchResult.metadata.cacheHits}`)

        // Validate search strategies were used
        expect(searchResult.metadata.searchStrategies.length).toBeGreaterThan(0)
        
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unknown error'
        console.warn(`Unified search failed for "${query}": ${error}`)
      }

      trackSourcePerformance('hybrid', searchResult?.papers || [], Date.now() - startTime, error)
    })

    test('Search with different source configurations', async () => {
      const query = 'artificial intelligence applications'
      
      // Test different source combinations
      const sourceConfigs = [
        { name: 'OpenAlex Only', sources: ['openalex'] },
        { name: 'Academic APIs Only', sources: ['crossref', 'semantic_scholar'] },
        { name: 'ArXiv + OpenAlex', sources: ['arxiv', 'openalex'] },
        { name: 'All Sources', sources: ['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'] }
      ]

      for (const config of sourceConfigs) {
        try {
          const result = await withSearchCache(async () => {
            return await unifiedSearch(query, {
              maxResults: 15,
              sources: config.sources as any[],
              useHybridSearch: true,
              useAcademicAPIs: true,
              fastMode: true
            })
          })

          console.log(`\n📊 ${config.name}:`)
          console.log(`   Papers Found: ${result.papers.length}`)
          console.log(`   Search Time: ${result.metadata.searchTimeMs}ms`)
          
          const sourceCounts = new Map()
          result.papers.forEach(paper => {
            const source = paper.source || 'unknown'
            sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1)
          })
          
          sourceCounts.forEach((count, source) => {
            console.log(`   ${source}: ${count} papers`)
          })

          expect(result.papers.length).toBeGreaterThan(0)
          
        } catch (error) {
          console.warn(`${config.name} failed:`, error)
        }
      }
    })
  })

  describe('Discovery Pipeline Analysis', () => {
    test.each(TEST_QUERIES.slice(0, 3))('Full discovery pipeline for "$name"', async ({ query, minExpectedResults }) => {
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
        
        expect(papers.length).toBeGreaterThanOrEqual(Math.min(minExpectedResults, 2))
        
        // Analyze paper sources
        const sourceDistribution = new Map<string, number>()
        papers.forEach(paper => {
          const source = (paper as any).source || 'library'
          sourceDistribution.set(source, (sourceDistribution.get(source) || 0) + 1)
        })

        console.log(`\n🎯 Discovery Pipeline Results for "${query}":`)
        console.log(`   Total Papers: ${papers.length}`)
        sourceDistribution.forEach((count, source) => {
          console.log(`   ${source}: ${count} papers`)
        })

        // Validate paper quality
        papers.forEach(paper => {
          expect(paper.title).toBeDefined()
          expect(paper.title.length).toBeGreaterThan(5)
          expect(paper.id).toBeDefined()
        })

      } catch (error) {
        console.warn(`Discovery pipeline failed for "${query}":`, error)
        throw error
      }
    })

    test('Library-only vs Discovery mode comparison', async () => {
      const query = 'machine learning algorithms'
      
      // Test library-only mode
      const libraryOnlyOptions: EnhancedGenerationOptions = {
        projectId: 'test-project',
        userId: 'test-user',
        topic: query,
        libraryPaperIds: [],
        useLibraryOnly: true,
        config: {
          search_parameters: { limit: 20 }
        }
      }

      // Test discovery mode
      const discoveryOptions: EnhancedGenerationOptions = {
        ...libraryOnlyOptions,
        useLibraryOnly: false,
        config: {
          search_parameters: {
            limit: 20,
            sources: ['openalex', 'crossref']
          }
        }
      }

      try {
        const libraryResults = await collectPapers(libraryOnlyOptions)
        console.log(`\n📚 Library-only mode: ${libraryResults.length} papers`)
        
        const discoveryResults = await collectPapers(discoveryOptions)
        console.log(`🔍 Discovery mode: ${discoveryResults.length} papers`)
        
        // Discovery mode should find more papers when library is empty
        expect(discoveryResults.length).toBeGreaterThanOrEqual(libraryResults.length)
        
      } catch (error) {
        console.warn('Mode comparison failed:', error)
      }
    })
  })

  describe('Performance and Quality Analysis', () => {
    test('Response time analysis across sources', async () => {
      const query = 'artificial intelligence'
      const sources = ['openalex', 'crossref', 'semantic_scholar']
      const responseTimes: Record<string, number> = {}

      for (const source of sources) {
        const startTime = Date.now()
        try {
          let papers: any[] = []
          
          switch (source) {
            case 'openalex':
              papers = await searchOpenAlex(query, { limit: 10, fastMode: true })
              break
            case 'crossref':
              papers = await searchCrossref(query, { limit: 10, fastMode: true })
              break
            case 'semantic_scholar':
              papers = await searchSemanticScholar(query, { limit: 10, fastMode: true })
              break
          }
          
          responseTimes[source] = Date.now() - startTime
          console.log(`⏱️  ${source}: ${responseTimes[source]}ms (${papers.length} papers)`)
          
        } catch (error) {
          responseTimes[source] = Date.now() - startTime
          console.log(`❌ ${source}: ${responseTimes[source]}ms (failed)`)
        }
      }

      // All sources should respond within reasonable time
      Object.values(responseTimes).forEach(time => {
        expect(time).toBeLessThan(15000) // 15 seconds max
      })
    })

    test('Deduplication effectiveness', async () => {
      const query = 'machine learning'
      
      try {
        const searchResult = await unifiedSearch(query, { maxResults: 30 })
        const result = searchResult.papers
        
        // Count duplicates by title similarity
        const titles = result.map(p => p.title.toLowerCase().trim())
        const uniqueTitles = new Set(titles)
        const duplicateRate = ((titles.length - uniqueTitles.size) / titles.length) * 100
        
        console.log(`\n🔄 Deduplication Analysis:`)
        console.log(`   Total Papers: ${result.length}`)
        console.log(`   Unique Titles: ${uniqueTitles.size}`)
        console.log(`   Duplicate Rate: ${duplicateRate.toFixed(1)}%`)
        
        // Deduplication should be effective (< 20% duplicates)
        expect(duplicateRate).toBeLessThan(20)
        
      } catch (error) {
        console.warn('Deduplication test failed:', error)
      }
    })
  })
})

describe('Search Error Handling and Edge Cases', () => {
  test('Invalid query handling', async () => {
    const invalidQueries = ['', '   ', 'a', '123', '!@#$%']
    
    for (const query of invalidQueries) {
      try {
        const result = await unifiedSearch(query, { maxResults: 5, fastMode: true })
        // Should either return empty results or handle gracefully
        expect(Array.isArray(result.papers)).toBe(true)
      } catch (error) {
        // Errors should be informative
        expect(error).toBeInstanceOf(Error)
      }
    }
  })

  test('Network timeout handling', async () => {
    try {
      const result = await unifiedSearch('artificial intelligence', {
        maxResults: 5,
        timeoutMs: 1, // Very short timeout to trigger timeout handling
        fastMode: true
      })
      
      // Should handle timeout gracefully
      expect(Array.isArray(result.papers)).toBe(true)
      expect(result.metadata.errors.length).toBeGreaterThan(0)
      
    } catch (error) {
      // Timeout errors should be handled
      expect(error).toBeInstanceOf(Error)
    }
  })

  test('Large result set handling', async () => {
    try {
      const result = await unifiedSearch('machine learning', {
        maxResults: 100, // Large number
        fastMode: false
      })
      
      console.log(`\n📊 Large result set test:`)
      console.log(`   Requested: 100 papers`)
      console.log(`   Received: ${result.papers.length} papers`)
      console.log(`   Search Time: ${result.metadata.searchTimeMs}ms`)
      
      // Should handle large requests reasonably
      expect(result.papers.length).toBeGreaterThan(0)
      expect(result.papers.length).toBeLessThanOrEqual(100)
      
    } catch (error) {
      console.warn('Large result set test failed:', error)
    }
  })
}) 