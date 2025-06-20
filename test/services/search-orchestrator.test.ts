import { describe, it, expect, vi, beforeEach } from 'vitest'
import { unifiedSearch, clearSearchCache, type UnifiedSearchOptions } from '@/lib/services/search-orchestrator'
import type { PaperWithAuthors } from '@/types/simplified'
import type { RankedPaper } from '@/lib/services/paper-aggregation'

// Mock dependencies
vi.mock('@/lib/db/papers', () => ({
  hybridSearchPapers: vi.fn(() => Promise.resolve([]))
}))

vi.mock('@/lib/services/paper-aggregation', () => ({
  parallelSearch: vi.fn(() => Promise.resolve([]))
}))

vi.mock('@/lib/supabase/server', () => ({
  getSB: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        textSearch: vi.fn(() => ({
          not: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve({ data: [], error: null }))
            }))
          }))
        }))
      }))
    }))
  }))
}))

describe('Search Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSearchCache()
  })

  it('should perform unified search with caching', async () => {
    const { hybridSearchPapers } = await import('@/lib/db/papers')
    const mockPapers: PaperWithAuthors[] = [
      {
        id: '1',
        title: 'Test Paper 1',
        abstract: 'Test abstract',
        publication_date: '2023-01-01',
        venue: 'Test Venue',
        doi: '10.1000/test1',
        url: 'https://example.com/1',
        metadata: {},
        created_at: '2023-01-01T00:00:00Z',
        authors: [{ id: '1', name: 'Test Author' }],
        author_names: ['Test Author']
      }
    ]

    vi.mocked(hybridSearchPapers).mockResolvedValueOnce(mockPapers)

    const options: UnifiedSearchOptions = {
      maxResults: 10,
      useHybridSearch: true,
      useKeywordSearch: false,
      useAcademicAPIs: false
    }

    const result = await unifiedSearch('test query', options)

    expect(result.papers).toHaveLength(1)
    expect(result.metadata.searchStrategies).toContain('hybrid')
    expect(result.metadata.hybridResults).toBe(1)
    expect(hybridSearchPapers).toHaveBeenCalledTimes(1)
  })

  it('should cache results and avoid redundant calls', async () => {
    const { hybridSearchPapers } = await import('@/lib/db/papers')
    const mockPapers: PaperWithAuthors[] = [
      {
        id: '1',
        title: 'Cached Paper',
        abstract: 'Cached abstract',
        publication_date: '2023-01-01',
        venue: 'Test Venue',
        doi: '10.1000/cached',
        url: 'https://example.com/cached',
        metadata: {},
        created_at: '2023-01-01T00:00:00Z',
        authors: [{ id: '1', name: 'Cached Author' }],
        author_names: ['Cached Author']
      }
    ]

    vi.mocked(hybridSearchPapers).mockResolvedValueOnce(mockPapers)

    const options: UnifiedSearchOptions = {
      maxResults: 10,
      useHybridSearch: true,
      useKeywordSearch: false,
      useAcademicAPIs: false
    }

    // First call
    const result1 = await unifiedSearch('cache test', options)
    expect(result1.metadata.cacheHits).toBe(0)
    expect(hybridSearchPapers).toHaveBeenCalledTimes(1)

    // Second call with same parameters should use cache
    const result2 = await unifiedSearch('cache test', options)
    expect(result2.metadata.cacheHits).toBe(1)
    expect(hybridSearchPapers).toHaveBeenCalledTimes(1) // No additional call

    expect(result1.papers).toEqual(result2.papers)
  })

  it('should apply regional boosting correctly', async () => {
    const { hybridSearchPapers } = await import('@/lib/db/papers')
    const mockPapers: PaperWithAuthors[] = [
      {
        id: '1',
        title: 'US Paper',
        abstract: 'US research',
        publication_date: '2023-01-01',
        venue: 'US Journal',
        doi: '10.1000/us',
        url: 'https://example.com/us',
        metadata: { region: 'United States' },
        created_at: '2023-01-01T00:00:00Z',
        authors: [{ id: '1', name: 'US Author' }],
        author_names: ['US Author']
      },
      {
        id: '2',
        title: 'UK Paper',
        abstract: 'UK research',
        publication_date: '2023-01-01',
        venue: 'UK Journal',
        doi: '10.1000/uk',
        url: 'https://example.com/uk',
        metadata: { region: 'United Kingdom' },
        created_at: '2023-01-01T00:00:00Z',
        authors: [{ id: '2', name: 'UK Author' }],
        author_names: ['UK Author']
      }
    ]

    vi.mocked(hybridSearchPapers).mockResolvedValueOnce(mockPapers)

    const options: UnifiedSearchOptions = {
      maxResults: 10,
      localRegion: 'United Kingdom',
      useHybridSearch: true,
      useKeywordSearch: false,
      useAcademicAPIs: false
    }

    const result = await unifiedSearch('regional test', options)

    expect(result.metadata.localRegionBoost).toBe(true)
    expect(result.metadata.localPapersCount).toBe(1)
    expect(result.papers[0].id).toBe('2') // UK paper should be first
    expect(result.papers[1].id).toBe('1') // US paper should be second
  })

  it('should fall back through search strategies correctly', async () => {
    const { hybridSearchPapers } = await import('@/lib/db/papers')
    const { parallelSearch } = await import('@/lib/services/paper-aggregation')

    // Mock hybrid search to return insufficient results
    vi.mocked(hybridSearchPapers).mockResolvedValueOnce([])

    // Mock academic search to return results
    const mockAcademicPapers: RankedPaper[] = [
      {
        canonical_id: 'academic-1',
        title: 'Academic Paper',
        abstract: 'Academic abstract',
        year: 2023,
        venue: 'Academic Venue',
        doi: '10.1000/academic',
        url: 'https://example.com/academic',
        citationCount: 10,
        relevanceScore: 0.8,
        combinedScore: 0.85,
        authorityScore: 0.7,
        recencyScore: 0.9,
        source: 'openalex',
        authors: ['Academic Author'],
        bm25Score: 0.75
      }
    ]

    vi.mocked(parallelSearch).mockResolvedValueOnce(mockAcademicPapers)

    const options: UnifiedSearchOptions = {
      maxResults: 10,
      minResults: 5,
      useHybridSearch: true,
      useKeywordSearch: true,
      useAcademicAPIs: true
    }

    const result = await unifiedSearch('fallback test', options)

    expect(result.metadata.searchStrategies).toContain('academic_apis')
    expect(result.metadata.academicResults).toBe(1)
    expect(hybridSearchPapers).toHaveBeenCalledTimes(1)
    expect(parallelSearch).toHaveBeenCalledTimes(1)
  })
}) 