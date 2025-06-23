import { describe, test, expect, vi, beforeEach } from 'vitest'
import { unifiedSearch } from '@/lib/search'
import type { PaperWithAuthors } from '@/types/simplified'

// Mock the dependencies
vi.mock('@/lib/services/paper-aggregation', () => ({
  parallelSearch: vi.fn(() => Promise.resolve([]))
}))

vi.mock('@/lib/db/papers', () => ({
  hybridSearchPapers: vi.fn(() => Promise.resolve([]))
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

describe('Unified Search Regional Boosting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('should boost local papers to appear first when localRegion is specified', async () => {
    // Mock the hybridSearchPapers to return papers with different regions
    const mockPapers: PaperWithAuthors[] = [
      {
        id: 'paper1',
        title: 'Test Study from USA',
        abstract: 'Research test query analysis from USA',
        publication_date: '2023-01-01',
        venue: 'American Journal',
        doi: '',
        url: '',
        metadata: { region: 'USA' },
        created_at: '2023-01-01T00:00:00Z',
        authors: [],
        author_names: []
      },
      {
        id: 'paper2', 
        title: 'Brazilian Test Study 1',
        abstract: 'Research test query from Brazil',
        publication_date: '2023-01-01',
        venue: 'Brazilian Journal',
        doi: '',
        url: '',
        metadata: { region: 'Brazil' },
        created_at: '2023-01-01T00:00:00Z',
        authors: [],
        author_names: []
      },
      {
        id: 'paper3',
        title: 'Brazilian Test Study 2', 
        abstract: 'Another test query research from Brazil',
        publication_date: '2023-01-01',
        venue: 'Universidade de São Paulo',
        doi: '',
        url: '',
        metadata: { region: 'Brazil' },
        created_at: '2023-01-01T00:00:00Z',
        authors: [],
        author_names: []
      }
    ]

    // Mock hybridSearchPapers to return our mock papers
    const { hybridSearchPapers } = await import('@/lib/db/papers')
    vi.mocked(hybridSearchPapers).mockResolvedValueOnce(mockPapers)

    // Call unifiedSearch with localRegion='Brazil'
    const result = await unifiedSearch('test query', {
      localRegion: 'Brazil',
      useHybridSearch: true,
      useKeywordSearch: false,
      useAcademicAPIs: false,
      maxResults: 10
    })

    // Verify that Brazilian papers appear first
    expect(result.papers).toHaveLength(3)
    expect(result.papers[0].metadata).toEqual({ region: 'Brazil' })
    expect(result.papers[1].metadata).toEqual({ region: 'Brazil' })
    expect(result.papers[2].metadata).toEqual({ region: 'USA' })
    
    // Verify the Brazilian papers are the ones we expect
    expect(result.papers[0].title).toBe('Brazilian Test Study 1')
    expect(result.papers[1].title).toBe('Brazilian Test Study 2')
    expect(result.papers[2].title).toBe('Test Study from USA')

    // Verify regional boost metadata
    expect(result.metadata.localRegionBoost).toBe(true)
    expect(result.metadata.localPapersCount).toBe(2)
  })

  test('should maintain original order when no papers match localRegion', async () => {
    const mockPapers: PaperWithAuthors[] = [
      {
        id: 'paper1',
        title: 'US Test Study',
        abstract: 'Test query research from USA',
        publication_date: '2023-01-01',
        venue: '',
        doi: '',
        url: '',
        metadata: { region: 'USA' },
        created_at: '2023-01-01T00:00:00Z',
        authors: [],
        author_names: []
      },
      {
        id: 'paper2',
        title: 'UK Test Study',
        abstract: 'Test query research from UK',
        publication_date: '2023-01-01',
        venue: '',
        doi: '',
        url: '',
        metadata: { region: 'UK' },
        created_at: '2023-01-01T00:00:00Z',
        authors: [],
        author_names: []
      }
    ]

    const { hybridSearchPapers } = await import('@/lib/db/papers')
    vi.mocked(hybridSearchPapers).mockResolvedValueOnce(mockPapers)

    const result = await unifiedSearch('test query', {
      localRegion: 'Japan', // No papers match this region
      useHybridSearch: true,
      useKeywordSearch: false,
      useAcademicAPIs: false,
      maxResults: 10
    })

    // Order should remain unchanged
    expect(result.papers).toHaveLength(2)
    expect(result.papers[0].title).toBe('US Test Study')
    expect(result.papers[1].title).toBe('UK Test Study')

    // Verify regional boost metadata
    expect(result.metadata.localRegionBoost).toBe(false)
    expect(result.metadata.localPapersCount).toBe(0)
  })

  test('should work correctly when no localRegion is specified', async () => {
    const mockPapers: PaperWithAuthors[] = [
      {
        id: 'paper1',
        title: 'First Test Study',
        abstract: 'Test query research first paper',
        publication_date: '2023-01-01',
        venue: '',
        doi: '',
        url: '',
        metadata: { region: 'Brazil' },
        created_at: '2023-01-01T00:00:00Z',
        authors: [],
        author_names: []
      },
      {
        id: 'paper2', 
        title: 'Second Test Study',
        abstract: 'Test query research second paper',
        publication_date: '2023-01-01',
        venue: '',
        doi: '',
        url: '',
        metadata: { region: 'USA' },
        created_at: '2023-01-01T00:00:00Z',
        authors: [],
        author_names: []
      }
    ]

    const { hybridSearchPapers } = await import('@/lib/db/papers')
    vi.mocked(hybridSearchPapers).mockResolvedValueOnce(mockPapers)

    const result = await unifiedSearch('test query', {
      // No localRegion specified
      useHybridSearch: true,
      useKeywordSearch: false,
      useAcademicAPIs: false,
      maxResults: 10
    })

    // Order should remain unchanged
    expect(result.papers).toHaveLength(2)
    expect(result.papers[0].title).toBe('First Test Study')
    expect(result.papers[1].title).toBe('Second Test Study')

    // Verify regional boost metadata
    expect(result.metadata.localRegionBoost).toBe(false)
    expect(result.metadata.localPapersCount).toBe(0)
  })
}) 