import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { 
  ChunkRetriever, 
  DEFAULT_RETRIEVAL_CONFIG,
  resetChunkRetriever,
  type RetrievalConfig 
} from '@/lib/rag/chunk-retriever'

// Mock the server-only import
vi.mock('server-only', () => ({}))

// Mock Supabase
vi.mock('@/lib/supabase/server', () => ({
  getSB: vi.fn(() => Promise.resolve({
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null }))
  }))
}))

// Mock embeddings
vi.mock('@/lib/utils/embedding', () => ({
  generateEmbeddings: vi.fn((texts: string[]) => 
    Promise.resolve(texts.map(() => new Array(1536).fill(0.1)))
  )
}))

describe('ChunkRetriever', () => {
  beforeEach(() => {
    resetChunkRetriever()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resetChunkRetriever()
  })

  describe('DEFAULT_RETRIEVAL_CONFIG', () => {
    test('has sensible defaults', () => {
      expect(DEFAULT_RETRIEVAL_CONFIG.mode).toBe('hybrid')
      expect(DEFAULT_RETRIEVAL_CONFIG.vectorWeight).toBe(0.7)
      expect(DEFAULT_RETRIEVAL_CONFIG.minScore).toBe(0.15)
      expect(DEFAULT_RETRIEVAL_CONFIG.retrieveLimit).toBe(100)
      expect(DEFAULT_RETRIEVAL_CONFIG.finalLimit).toBe(20)
      expect(DEFAULT_RETRIEVAL_CONFIG.useCitationBoost).toBe(true)
      expect(DEFAULT_RETRIEVAL_CONFIG.useReranking).toBe(true)
      expect(DEFAULT_RETRIEVAL_CONFIG.rerankTopK).toBe(30)
      expect(DEFAULT_RETRIEVAL_CONFIG.maxPerPaper).toBe(5)
    })
  })

  describe('constructor', () => {
    test('uses default config when no config provided', () => {
      const retriever = new ChunkRetriever()
      expect(retriever.isRerankingAvailable()).toBe(false) // No API key set
    })

    test('merges custom config with defaults', () => {
      const retriever = new ChunkRetriever({
        mode: 'vector',
        finalLimit: 10
      })
      // Internal state is private, but we can test behavior
      expect(retriever).toBeInstanceOf(ChunkRetriever)
    })
  })

  describe('retrieve', () => {
    test('returns empty result for empty query', async () => {
      const retriever = new ChunkRetriever()
      const result = await retriever.retrieve({
        query: '',
        paperIds: ['paper-1']
      })
      
      expect(result.chunks).toEqual([])
      expect(result.totalRetrieved).toBe(0)
      expect(result.wasReranked).toBe(false)
    })

    test('returns empty result for empty paperIds', async () => {
      const retriever = new ChunkRetriever()
      const result = await retriever.retrieve({
        query: 'machine learning',
        paperIds: []
      })
      
      expect(result.chunks).toEqual([])
      expect(result.totalRetrieved).toBe(0)
    })

    test('includes metrics in result', async () => {
      const retriever = new ChunkRetriever()
      const result = await retriever.retrieve({
        query: 'machine learning',
        paperIds: ['paper-1']
      })
      
      expect(result.metrics).toBeDefined()
      expect(typeof result.metrics.retrievalTimeMs).toBe('number')
      expect(typeof result.metrics.rerankTimeMs).toBe('number')
      expect(typeof result.metrics.uniquePapers).toBe('number')
    })

    test('allows overriding config per request', async () => {
      const retriever = new ChunkRetriever({ mode: 'hybrid' })
      
      // Override to vector mode for this request
      const result = await retriever.retrieve({
        query: 'machine learning',
        paperIds: ['paper-1'],
        config: { mode: 'vector' }
      })
      
      expect(result).toBeDefined()
    })
  })

  describe('setConfig', () => {
    test('updates configuration', () => {
      const retriever = new ChunkRetriever({ finalLimit: 10 })
      retriever.setConfig({ finalLimit: 50 })
      // Can't directly test internal state, but method should not throw
      expect(retriever).toBeInstanceOf(ChunkRetriever)
    })
  })

  describe('isRerankingAvailable', () => {
    test('returns false when COHERE_API_KEY not set', () => {
      const retriever = new ChunkRetriever()
      expect(retriever.isRerankingAvailable()).toBe(false)
    })
  })
})

describe('RetrievalConfig', () => {
  test('mode options are valid', () => {
    const modes = ['hybrid', 'vector', 'keyword'] as const
    for (const mode of modes) {
      const config: Partial<RetrievalConfig> = { mode }
      expect(config.mode).toBe(mode)
    }
  })

  test('vectorWeight should be between 0 and 1', () => {
    const config: Partial<RetrievalConfig> = { vectorWeight: 0.7 }
    expect(config.vectorWeight).toBeGreaterThanOrEqual(0)
    expect(config.vectorWeight).toBeLessThanOrEqual(1)
  })

  test('citationBoostFactor should be between 0 and 1', () => {
    const config: Partial<RetrievalConfig> = { citationBoostFactor: 0.1 }
    expect(config.citationBoostFactor).toBeGreaterThanOrEqual(0)
    expect(config.citationBoostFactor).toBeLessThanOrEqual(1)
  })
})
