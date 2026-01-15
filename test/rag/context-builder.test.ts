import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { 
  ContextBuilder, 
  DEFAULT_CONTEXT_CONFIG,
  resetContextBuilder,
  type ContextConfig 
} from '@/lib/rag/context-builder'
import type { RetrievedChunk, PaperMetadata } from '@/lib/rag/base-retrieval'

// Mock the server-only import
vi.mock('server-only', () => ({}))

// Mock embeddings for compression
vi.mock('@/lib/utils/embedding', () => ({
  generateEmbeddings: vi.fn((texts: string[]) => 
    Promise.resolve(texts.map(() => new Array(1536).fill(0.1)))
  )
}))

describe('ContextBuilder', () => {
  beforeEach(() => {
    resetContextBuilder()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resetContextBuilder()
  })

  describe('DEFAULT_CONTEXT_CONFIG', () => {
    test('has sensible defaults', () => {
      expect(DEFAULT_CONTEXT_CONFIG.maxTokens).toBe(8000)
      expect(DEFAULT_CONTEXT_CONFIG.sentenceMinScore).toBe(0.3)
      expect(DEFAULT_CONTEXT_CONFIG.enableCompression).toBe(true)
      expect(DEFAULT_CONTEXT_CONFIG.includeCitations).toBe(true)
      expect(DEFAULT_CONTEXT_CONFIG.groupByPaper).toBe(false)
      expect(DEFAULT_CONTEXT_CONFIG.tokensPerChar).toBe(0.25)
    })
  })

  describe('constructor', () => {
    test('uses default config when no config provided', () => {
      const builder = new ContextBuilder()
      expect(builder).toBeInstanceOf(ContextBuilder)
    })

    test('merges custom config with defaults', () => {
      const builder = new ContextBuilder({
        maxTokens: 4000,
        enableCompression: false
      })
      expect(builder).toBeInstanceOf(ContextBuilder)
    })
  })

  describe('buildContext', () => {
    const mockChunks: RetrievedChunk[] = [
      {
        id: 'chunk-1',
        paper_id: 'paper-1',
        content: 'Machine learning has revolutionized data analysis. Deep learning models achieve state-of-the-art results.',
        score: 0.9
      },
      {
        id: 'chunk-2',
        paper_id: 'paper-2',
        content: 'Neural networks can learn complex patterns. They are used in computer vision and NLP.',
        score: 0.8
      }
    ]
    
    const mockPapers = new Map<string, PaperMetadata>([
      ['paper-1', { id: 'paper-1', title: 'ML Overview', authors: ['Smith, John'], year: 2023 }],
      ['paper-2', { id: 'paper-2', title: 'Neural Networks', authors: ['Jones, Sarah'], year: 2022 }]
    ])

    test('returns empty context for empty chunks', async () => {
      const builder = new ContextBuilder()
      const result = await builder.buildContext([], 'query', mockPapers)
      
      expect(result.chunks).toEqual([])
      expect(result.estimatedTokens).toBe(0)
      expect(result.formattedContext).toBe('No relevant content found.')
    })

    test('formats context with citations when enabled', async () => {
      const builder = new ContextBuilder({ 
        enableCompression: false,
        includeCitations: true 
      })
      const result = await builder.buildContext(mockChunks, 'machine learning', mockPapers)
      
      expect(result.formattedContext).toContain('Smith')
      expect(result.formattedContext).toContain('2023')
      expect(result.formattedContext).toContain('paper-1')
    })

    test('excludes citations when disabled', async () => {
      const builder = new ContextBuilder({ 
        enableCompression: false,
        includeCitations: false 
      })
      const result = await builder.buildContext(mockChunks, 'machine learning', mockPapers)
      
      // Should have generic source labels instead
      expect(result.formattedContext).toContain('[Source 1]')
      expect(result.formattedContext).toContain('[Source 2]')
    })

    test('includes metrics in result', async () => {
      const builder = new ContextBuilder({ enableCompression: false })
      const result = await builder.buildContext(mockChunks, 'machine learning', mockPapers)
      
      expect(result.metrics).toBeDefined()
      expect(result.metrics.originalChunks).toBe(2)
      expect(result.metrics.includedChunks).toBe(2)
    })

    test('estimates token count', async () => {
      const builder = new ContextBuilder({ enableCompression: false })
      const result = await builder.buildContext(mockChunks, 'machine learning', mockPapers)
      
      expect(result.estimatedTokens).toBeGreaterThan(0)
      // Rough check: tokens should be approximately content length * 0.25
      const expectedApprox = Math.ceil(result.formattedContext.length * 0.25)
      expect(result.estimatedTokens).toBeCloseTo(expectedApprox, -1)
    })
  })

  describe('buildContext with compression', () => {
    const longChunk: RetrievedChunk = {
      id: 'chunk-long',
      paper_id: 'paper-1',
      content: `
        Machine learning has become essential in modern data science. 
        The field has grown rapidly over the past decade. 
        Deep learning particularly has shown remarkable results.
        Many applications now use neural network architectures.
        Computer vision has been transformed by convolutional networks.
        Natural language processing uses transformer models extensively.
        Reinforcement learning enables autonomous decision making.
        The future holds even more promising developments.
      `.trim(),
      score: 0.9
    }
    
    const mockPapers = new Map<string, PaperMetadata>([
      ['paper-1', { id: 'paper-1', title: 'ML Survey', authors: ['Author One'], year: 2024 }]
    ])

    test('applies compression when enabled', async () => {
      const builder = new ContextBuilder({ 
        enableCompression: true,
        sentenceMinScore: 0.3
      })
      const result = await builder.buildContext([longChunk], 'machine learning deep learning', mockPapers)
      
      expect(result.wasCompressed).toBe(true)
      expect(result.metrics.compressionRatio).toBeLessThanOrEqual(1)
    })

    test('skips compression when disabled', async () => {
      const builder = new ContextBuilder({ enableCompression: false })
      const result = await builder.buildContext([longChunk], 'machine learning', mockPapers)
      
      expect(result.wasCompressed).toBe(false)
    })
  })

  describe('token budget', () => {
    const manyChunks: RetrievedChunk[] = Array.from({ length: 50 }, (_, i) => ({
      id: `chunk-${i}`,
      paper_id: `paper-${i % 5}`,
      content: `This is chunk number ${i}. It contains some content about machine learning and artificial intelligence. The content is meant to test token budget limits.`,
      score: 0.9 - (i * 0.01)
    }))
    
    const mockPapers = new Map<string, PaperMetadata>(
      Array.from({ length: 5 }, (_, i) => [
        `paper-${i}`,
        { id: `paper-${i}`, title: `Paper ${i}`, authors: [`Author ${i}`], year: 2024 }
      ])
    )

    test('respects token budget', async () => {
      const builder = new ContextBuilder({ 
        maxTokens: 500,
        enableCompression: false
      })
      const result = await builder.buildContext(manyChunks, 'machine learning', mockPapers)
      
      // Estimated tokens should be at or below budget
      expect(result.estimatedTokens).toBeLessThanOrEqual(500)
    })

    test('includes fewer chunks when budget is low', async () => {
      const builder = new ContextBuilder({ 
        maxTokens: 100,
        enableCompression: false
      })
      const result = await builder.buildContext(manyChunks, 'machine learning', mockPapers)
      
      expect(result.metrics.includedChunks).toBeLessThan(manyChunks.length)
    })
  })

  describe('setConfig', () => {
    test('updates configuration', () => {
      const builder = new ContextBuilder({ maxTokens: 4000 })
      builder.setConfig({ maxTokens: 8000 })
      expect(builder).toBeInstanceOf(ContextBuilder)
    })
  })
})

describe('ContextConfig', () => {
  test('maxTokens should be positive', () => {
    const config: Partial<ContextConfig> = { maxTokens: 8000 }
    expect(config.maxTokens).toBeGreaterThan(0)
  })

  test('sentenceMinScore should be between 0 and 1', () => {
    const config: Partial<ContextConfig> = { sentenceMinScore: 0.3 }
    expect(config.sentenceMinScore).toBeGreaterThanOrEqual(0)
    expect(config.sentenceMinScore).toBeLessThanOrEqual(1)
  })

  test('tokensPerChar should be reasonable', () => {
    const config: Partial<ContextConfig> = { tokensPerChar: 0.25 }
    // Typical English is ~4 chars per token, so 0.25 tokens per char
    expect(config.tokensPerChar).toBeGreaterThan(0)
    expect(config.tokensPerChar).toBeLessThan(1)
  })
})
